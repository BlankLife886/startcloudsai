// Package assistantstream 通过 Redis Pub/Sub 把助手回答的增量文本
// 从 Worker 推给 API 层的 SSE 端点，实现真流式（轮询仅兜底状态机）。
package assistantstream

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

const channelPrefix = "assistant:stream:"

// Event 是发布到频道的载荷：content 为累计全文（幂等，乱序安全，
// 客户端只在长度增加时应用）；done=true 表示任务终结，SSE 应关闭。
type Event struct {
	Content    string      `json:"content,omitempty"`
	Kind       string      `json:"kind,omitempty"`
	Stage      string      `json:"stage,omitempty"`
	Image      *ImageEvent `json:"image,omitempty"`
	ImageTotal int         `json:"imageTotal,omitempty"`
	Done       bool        `json:"done,omitempty"`
	Status     string      `json:"status,omitempty"`
}

type ImageEvent struct {
	ID            string `json:"id"`
	Index         int    `json:"index"`
	DataURL       string `json:"dataUrl"`
	FileKey       string `json:"fileKey,omitempty"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
}

func Channel(runID string) string {
	return channelPrefix + runID
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
