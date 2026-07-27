package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

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

	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	// 让 nginx 网关不缓冲 SSE
	header.Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	terminal := run.Status != "queued" && run.Status != "running"
	// 补发当前已生成内容，断线重连/迟到订阅都能立即对齐
	if message, gerr := store.GetAssistantMessage(c.Request.Context(), s.St.Pool, run.AssistantMessageID); gerr == nil && message != nil && message.Content != "" {
		writeAssistantStreamEvent(c, assistantstream.Event{Content: message.Content, Kind: message.Kind})
	}
	if terminal {
		writeAssistantStreamEvent(c, assistantstream.Event{Done: true, Status: run.Status})
		return
	}

	client := s.assistantStreamRedis()
	if client == nil {
		// Redis 不可用：直接结束，客户端回退纯轮询
		writeAssistantStreamEvent(c, assistantstream.Event{Done: true, Status: run.Status})
		return
	}

	ctx := c.Request.Context()
	pubsub := client.Subscribe(ctx, assistantstream.Channel(runID.String()))
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
			if event.Done {
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
			if current.Status != "queued" && current.Status != "running" {
				if message, gerr := store.GetAssistantMessage(ctx, s.St.Pool, run.AssistantMessageID); gerr == nil && message != nil && message.Content != "" {
					writeAssistantStreamEvent(c, assistantstream.Event{Content: message.Content, Kind: message.Kind})
				}
				writeAssistantStreamEvent(c, assistantstream.Event{Done: true, Status: current.Status})
				return
			}
		}
	}
}
