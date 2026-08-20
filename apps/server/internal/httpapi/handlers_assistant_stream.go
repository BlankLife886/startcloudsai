package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const assistantToolResultMaxBytes = 64 << 10

var (
	assistantStreamOnce   sync.Once
	assistantStreamClient *redis.Client
)

func (s *Server) assistantStreamRedis() *redis.Client {
	assistantStreamOnce.Do(func() {
		assistantStreamClient = assistantstream.NewClient(s.Cfg.RedisURL)
	})
	return assistantStreamClient
}

func writeAssistantStreamEvent(c *gin.Context, event assistantstream.Event) bool {
	payload, err := json.Marshal(event)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", payload); err != nil {
		return false
	}
	c.Writer.Flush()
	return true
}

func assistantRunIsTerminal(status string) bool {
	switch status {
	case "succeeded", "failed", "canceled":
		return true
	default:
		return false
	}
}

// postAssistantRunToolResult 收下浏览器执行画布工具后的观察结果，交给正在
// 等待的 Worker。这是把单次问答变成多轮工具循环的回边。
func (s *Server) postAssistantRunToolResult(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	runID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "run id 无效", 422))
		return
	}
	var body struct {
		RequestID string          `json:"requestId"`
		Result    json.RawMessage `json:"result"`
		Error     string          `json:"error"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, apperr.E("validation_error", "请求体无效", 422))
		return
	}
	requestID := strings.TrimSpace(body.RequestID)
	if requestID == "" || len(requestID) > 64 {
		fail(c, apperr.E("validation_error", "requestId 无效", 422))
		return
	}
	run, err := store.GetAssistantRun(c.Request.Context(), s.St.Pool, runID)
	if err != nil {
		fail(c, err)
		return
	}
	if run == nil || run.UserID != user.ID {
		fail(c, apperr.E("not_found", "任务不存在", 404))
		return
	}
	if assistantRunIsTerminal(run.Status) {
		fail(c, apperr.E("conflict", "任务已结束", 409))
		return
	}
	if len(body.Result) > assistantToolResultMaxBytes {
		body.Result = nil
		body.Error = "工具结果过大，已丢弃"
	}
	payload, err := json.Marshal(map[string]any{
		"requestId": requestID,
		"result":    body.Result,
		"error":     strings.TrimSpace(body.Error),
	})
	if err != nil {
		fail(c, apperr.E("validation_error", "请求体无效", 422))
		return
	}
	client := s.assistantStreamRedis()
	if client == nil {
		fail(c, apperr.E("unavailable", "流式后端不可用", 503))
		return
	}
	if err := assistantstream.PublishToolResult(c.Request.Context(), client, runID.String(), requestID, payload); err != nil {
		fail(c, apperr.E("unavailable", "工具结果投递失败", 503))
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// assistantRunStream 把 Worker 经 Redis 发布的增量回答以 SSE 推给客户端。
// 轮询接口仍是状态机的权威来源，本端点只负责“打字机”体验。
func (s *Server) assistantRunStream(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	runID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "run id 无效", 422))
		return
	}
	run, err := store.GetAssistantRun(c.Request.Context(), s.St.Pool, runID)
	if err != nil {
		fail(c, err)
		return
	}
	if run == nil || run.UserID != user.ID {
		fail(c, apperr.E("not_found", "任务不存在", 404))
		return
	}

	terminal := assistantRunIsTerminal(run.Status)
	ctx := c.Request.Context()
	var pubsub *redis.PubSub
	if !terminal {
		if client := s.assistantStreamRedis(); client != nil {
			candidate := client.Subscribe(ctx, assistantstream.Channel(runID.String()))
			// Receive 确认服务端已经订阅成功，再读取持久化快照，关闭
			// “先读快照、后订阅”造成首批增量丢失的竞态窗口。
			subscribeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			_, subscribeErr := candidate.Receive(subscribeCtx)
			cancel()
			if subscribeErr == nil {
				pubsub = candidate
			} else {
				_ = candidate.Close()
			}
		}
	}

	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	// 让 nginx 网关不缓冲 SSE
	header.Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	// 补发当前已生成内容，断线重连/迟到订阅都能立即对齐
	if message, gerr := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, run.AssistantMessageID); gerr == nil && message != nil {
		reasoning, _ := message.Metadata["reasoning"].(string)
		if message.Content != "" || reasoning != "" {
			writeAssistantStreamEvent(c, assistantstream.Event{Content: message.Content, Reasoning: reasoning, Kind: message.Kind})
		}
	}
	if terminal {
		writeAssistantStreamEvent(c, assistantstream.Event{Done: true, Status: run.Status})
		return
	}

	if pubsub == nil {
		// Redis 不可用时关闭连接，让客户端回退轮询。运行态绝不能伪装成
		// done，否则界面会在模型真正回答前显示“回答已完成”。
		return
	}
	defer pubsub.Close()
	events := pubsub.Channel()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	// 兜底：订阅前任务恰好终结时，done 事件可能已错过
	terminalCheck := time.NewTicker(3 * time.Second)
	defer terminalCheck.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-events:
			if !ok {
				return
			}
			var event assistantstream.Event
			if err := json.Unmarshal([]byte(message.Payload), &event); err != nil {
				continue
			}
			if !writeAssistantStreamEvent(c, event) {
				return
			}
			if event.Done && assistantRunIsTerminal(event.Status) {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		case <-terminalCheck.C:
			current, gerr := store.GetAssistantRun(ctx, s.St.Pool, runID)
			if gerr != nil || current == nil {
				continue
			}
			if assistantRunIsTerminal(current.Status) {
				if message, gerr := store.GetAssistantMessage(ctx, s.St.Pool, run.AssistantMessageID); gerr == nil && message != nil {
					reasoning, _ := message.Metadata["reasoning"].(string)
					if message.Content != "" || reasoning != "" {
						writeAssistantStreamEvent(c, assistantstream.Event{Content: message.Content, Reasoning: reasoning, Kind: message.Kind})
					}
				}
				writeAssistantStreamEvent(c, assistantstream.Event{Done: true, Status: current.Status})
				return
			}
		}
	}
}
