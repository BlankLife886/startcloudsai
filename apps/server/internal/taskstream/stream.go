// Package taskstream publishes durable task state changes from workers to SSE clients.
package taskstream

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

const channelPrefix = "task:stream:"

type Event struct {
	TaskID     string `json:"taskId,omitempty"`
	Stage      string `json:"stage,omitempty"`
	Status     string `json:"status,omitempty"`
	ImageIndex int    `json:"imageIndex,omitempty"`
	ImageCount int    `json:"imageCount,omitempty"`
	Done       bool   `json:"done,omitempty"`
}

func Channel(taskID string) string {
	return channelPrefix + taskID
}

func UserChannel(userID string) string {
	return channelPrefix + "user:" + userID
}

// Publish is best-effort. Persisted task state remains the source of truth.
func Publish(ctx context.Context, client *redis.Client, taskID string, event Event) {
	if client == nil || taskID == "" {
		return
	}
	if event.TaskID == "" {
		event.TaskID = taskID
	}
	publish(ctx, client, Channel(taskID), event)
}

func PublishUser(ctx context.Context, client *redis.Client, userID string, event Event) {
	if client == nil || userID == "" || event.TaskID == "" {
		return
	}
	publish(ctx, client, UserChannel(userID), event)
}

func publish(ctx context.Context, client *redis.Client, channel string, event Event) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	publishCtx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	_ = client.Publish(publishCtx, channel, payload).Err()
}
