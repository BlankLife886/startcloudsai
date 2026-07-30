package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

func taskIsTerminal(status string) bool {
	switch status {
	case "succeeded", "failed", "canceled":
		return true
	default:
		return false
	}
}

func (s *Server) writeTaskStreamSnapshot(c *gin.Context, task *store.Task, event taskstream.Event) bool {
	payload, err := json.Marshal(gin.H{
		"task":       taskDict(task, s.outputURLsFor(c, task), s.originalURLsFor(c, task)),
		"stage":      event.Stage,
		"imageIndex": event.ImageIndex,
		"imageCount": event.ImageCount,
		"done":       taskIsTerminal(task.Status),
	})
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", payload); err != nil {
		return false
	}
	c.Writer.Flush()
	return true
}

// taskStream pushes persisted task snapshots immediately; polling remains the fallback.
func (s *Server) taskStream(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	task, err := s.getOwnTask(c, user)
	if err != nil {
		fail(c, err)
		return
	}

	ctx := c.Request.Context()
	terminal := taskIsTerminal(task.Status)
	var pubsub *redis.PubSub
	if !terminal {
		if client := s.assistantStreamRedis(); client != nil {
			candidate := client.Subscribe(ctx, taskstream.Channel(task.ID.String()))
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
	header.Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	if current, gerr := store.GetUserTask(ctx, s.St.Pool, user.ID, task.ID); gerr == nil && current != nil {
		task = current
	}
	if !s.writeTaskStreamSnapshot(c, task, taskstream.Event{Stage: task.Status}) || taskIsTerminal(task.Status) {
		return
	}
	if pubsub == nil {
		return
	}
	defer pubsub.Close()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	terminalCheck := time.NewTicker(3 * time.Second)
	defer terminalCheck.Stop()
	events := pubsub.Channel()

	writeLatest := func(event taskstream.Event) bool {
		current, gerr := store.GetUserTask(ctx, s.St.Pool, user.ID, task.ID)
		if gerr != nil || current == nil {
			return true
		}
		task = current
		return s.writeTaskStreamSnapshot(c, task, event)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-events:
			if !ok {
				return
			}
			var event taskstream.Event
			if json.Unmarshal([]byte(message.Payload), &event) != nil {
				continue
			}
			if !writeLatest(event) || event.Done || taskIsTerminal(task.Status) {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		case <-terminalCheck.C:
			if !writeLatest(taskstream.Event{Stage: "status-check"}) || taskIsTerminal(task.Status) {
				return
			}
		}
	}
}

// userTaskStream is a lightweight account-wide channel used for completion
// notifications even after the user leaves the originating studio page.
func (s *Server) userTaskStream(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var pubsub *redis.PubSub
	if client := s.assistantStreamRedis(); client != nil {
		candidate := client.Subscribe(ctx, taskstream.UserChannel(user.ID.String()))
		subscribeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		_, subscribeErr := candidate.Receive(subscribeCtx)
		cancel()
		if subscribeErr == nil {
			pubsub = candidate
		} else {
			_ = candidate.Close()
		}
	}

	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()
	if pubsub == nil {
		return
	}
	defer pubsub.Close()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	events := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-events:
			if !ok {
				return
			}
			var event taskstream.Event
			if json.Unmarshal([]byte(message.Payload), &event) != nil || event.TaskID == "" {
				continue
			}
			taskID, parseErr := uuid.Parse(event.TaskID)
			if parseErr != nil {
				continue
			}
			task, getErr := store.GetUserTask(ctx, s.St.Pool, user.ID, taskID)
			if getErr != nil || task == nil {
				continue
			}
			if !s.writeTaskStreamSnapshot(c, task, event) {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		}
	}
}
