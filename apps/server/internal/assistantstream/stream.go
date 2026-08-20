// Package assistantstream 通过 Redis Pub/Sub 把助手回答的增量文本
// 从 Worker 推给 API 层的 SSE 端点，实现真流式（轮询仅兜底状态机）。
package assistantstream

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	channelPrefix    = "assistant:stream:"
	toolResultPrefix = "assistant:tool:"
	toolResultTTL    = 5 * time.Minute
)

// Event 是发布到频道的载荷：content 为累计全文（幂等，乱序安全，
// 客户端只在长度增加时应用）；done=true 表示任务终结，SSE 应关闭。
type Event struct {
	Content    string         `json:"content,omitempty"`
	Reasoning  string         `json:"reasoning,omitempty"`
	Kind       string         `json:"kind,omitempty"`
	Stage      string         `json:"stage,omitempty"`
	Image      *ImageEvent    `json:"image,omitempty"`
	ImageTotal int            `json:"imageTotal,omitempty"`
	Tool       *ToolCallEvent `json:"tool,omitempty"`
	Done       bool           `json:"done,omitempty"`
	Status     string         `json:"status,omitempty"`
}

// ToolCallEvent asks the browser that owns the canvas to run one agent tool and
// post the observation back, which is what turns a single response into a loop.
type ToolCallEvent struct {
	RequestID string `json:"requestId"`
	Name      string `json:"name"`
	Arguments string `json:"arguments,omitempty"`
	Title     string `json:"title,omitempty"`
}

type ImageEvent struct {
	ID            string `json:"id"`
	Index         int    `json:"index"`
	DataURL       string `json:"dataUrl"`
	FileKey       string `json:"fileKey,omitempty"`
	ThumbURL      string `json:"thumbUrl,omitempty"`
	DisplayURL    string `json:"displayUrl,omitempty"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
}

func Channel(runID string) string {
	return channelPrefix + runID
}

// ToolResultKey is the rendezvous list where the API process hands a browser
// tool result to the worker that is blocked waiting for it.
func ToolResultKey(runID, requestID string) string {
	return toolResultPrefix + runID + ":" + requestID
}

// PublishToolResult stores one observation for the waiting worker. The TTL
// keeps abandoned runs from leaking keys.
func PublishToolResult(ctx context.Context, client *redis.Client, runID, requestID string, payload []byte) error {
	if client == nil {
		return errors.New("stream backend unavailable")
	}
	key := ToolResultKey(runID, requestID)
	pushCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.RPush(pushCtx, key, payload).Err(); err != nil {
		return err
	}
	return client.Expire(pushCtx, key, toolResultTTL).Err()
}

// WaitToolResult blocks until the browser answers, the deadline passes, or the
// context is canceled. A miss returns an empty payload without an error so the
// caller can fall back instead of failing the whole run.
func WaitToolResult(ctx context.Context, client *redis.Client, runID, requestID string, timeout time.Duration) ([]byte, error) {
	if client == nil {
		return nil, errors.New("stream backend unavailable")
	}
	deadline := time.Now().Add(timeout)
	key := ToolResultKey(runID, requestID)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, nil
		}
		// One-second slices are the finest BLPOP granularity and keep run
		// cancellation responsive without busy-looping.
		values, err := client.BLPop(ctx, time.Second, key).Result()
		if err == redis.Nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		if len(values) == 2 {
			return []byte(values[1]), nil
		}
	}
}

// Publish 尽力而为：Redis 不可用不影响任务执行（轮询路径仍然完整）。
func Publish(ctx context.Context, client *redis.Client, runID string, event Event) {
	if client == nil || runID == "" {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_ = client.Publish(publishCtx, Channel(runID), payload).Err()
}

// NewClient 从 RedisURL 建客户端；失败返回 nil（调用方按无流式降级）。
func NewClient(redisURL string) *redis.Client {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil
	}
	return redis.NewClient(opts)
}
