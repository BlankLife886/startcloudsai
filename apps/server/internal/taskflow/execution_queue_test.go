package taskflow

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

func TestExecutionQueuesChatRunsWhileImagePoolIsBlocked(t *testing.T) {
	redisBinary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server is required for isolated queue integration")
	}
	// A dedicated Unix socket avoids touching development Redis or exposing
	// a test server on a network port. Keep its path below Unix socket limits.
	directory, err := os.MkdirTemp("", "sc-queue-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	socket := filepath.Join(directory, "redis.sock")
	process := exec.Command(redisBinary, "--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no", "--dir", directory, "--logfile", filepath.Join(directory, "redis.log"))
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- process.Wait() }()
	t.Cleanup(func() {
		_ = process.Process.Signal(os.Interrupt)
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = process.Process.Kill()
			<-done
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	redisClient := redis.NewClient(&redis.Options{Network: "unix", Addr: socket, DialTimeout: 100 * time.Millisecond})
	defer redisClient.Close()
	for redisClient.Ping(ctx).Err() != nil {
		select {
		case <-ctx.Done():
			t.Fatal("isolated Redis did not start")
		case <-time.After(20 * time.Millisecond):
		}
	}
	connection := asynq.RedisClientOpt{Network: "unix", Addr: socket}
	queue := &Queue{client: asynq.NewClient(connection), inspector: asynq.NewInspector(connection), metrics: redisClient, timeout: time.Minute}
	defer queue.Close()
	imageStarted, releaseImage := make(chan struct{}), make(chan struct{})
	chatFinished := make(chan string, 1)
	mux := asynq.NewServeMux()
	mux.HandleFunc(TypeRunAssistant, func(ctx context.Context, task *asynq.Task) error {
		var payload RunAssistantPayload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return err
		}
		name, _ := asynq.GetQueueName(ctx)
		if payload.RunID == "blocked-image" {
			if name != QueueAssistantImage {
				t.Errorf("image dispatched to %s", name)
			}
			close(imageStarted)
			select {
			case <-releaseImage:
			case <-ctx.Done():
				return ctx.Err()
			}
		} else {
			chatFinished <- name
		}
		return nil
	})
	images := asynq.NewServer(connection, asynq.Config{Concurrency: 1, Queues: ImageQueueWeights})
	if err := images.Start(mux); err != nil {
		t.Fatal(err)
	}
	defer images.Shutdown()
	chats := asynq.NewServer(connection, asynq.Config{Concurrency: 1, Queues: ChatQueueWeights})
	if err := chats.Start(mux); err != nil {
		t.Fatal(err)
	}
	defer chats.Shutdown()
	defer close(releaseImage)
	if err := queue.EnqueueAssistantRun(ctx, "blocked-image", "image"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-imageStarted:
	case <-ctx.Done():
		t.Fatal("image worker did not start")
	}
	if err := queue.EnqueueAssistantRunRecovery(ctx, "independent-chat", "chat"); err != nil {
		t.Fatal(err)
	}
	select {
	case name := <-chatFinished:
		if name != QueueAssistantChat {
			t.Fatalf("chat ran in %s", name)
		}
	case <-ctx.Done():
		t.Fatal("blocked image pool prevented chat from executing")
	}
}
