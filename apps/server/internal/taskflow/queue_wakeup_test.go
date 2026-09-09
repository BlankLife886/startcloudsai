package taskflow

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestUserQueueWakeBypassesDelayAndDeduplicates(t *testing.T) {
	st := testdb.Setup(t)
	binary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("isolated Redis is required")
	}
	directory, err := os.MkdirTemp("", "sc-wake-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	socket := filepath.Join(directory, "redis.sock")
	process := exec.Command(binary, "--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no", "--dir", directory, "--logfile", filepath.Join(directory, "redis.log"))
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rdb := redis.NewClient(&redis.Options{Network: "unix", Addr: socket, DialTimeout: 100 * time.Millisecond})
	for rdb.Ping(ctx).Err() != nil {
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(20 * time.Millisecond):
		}
	}
	connection := asynq.RedisClientOpt{Network: "unix", Addr: socket}
	queue := &Queue{client: asynq.NewClient(connection), inspector: asynq.NewInspector(connection), metrics: rdb, timeout: time.Minute}
	defer queue.Close()
	u, err := store.InsertUser(ctx, st.Pool, uuid.NewString()+"@wake.test", "test", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	if _, err := store.InsertTask(ctx, st.Pool, store.NewTask{ID: id, UserID: u.ID, Type: "t2i", Prompt: "wake", Count: 1}); err != nil {
		t.Fatal(err)
	}
	if err := queue.EnqueueRunTaskRecoveryIn(ctx, id.String(), time.Minute); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := queue.WakeUserTaskQueue(ctx, st.Pool, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	pending, err := queue.inspector.ListPendingTasks(QueueDefault)
	if err != nil || len(pending) != 1 || pending[0].ID != id.String()+":wake" {
		t.Fatalf("pending=%v err=%v", pending, err)
	}
	scheduled, err := queue.inspector.ListScheduledTasks(QueueDefault)
	if err != nil || len(scheduled) != 1 {
		t.Fatalf("scheduled fallback=%v err=%v", scheduled, err)
	}
}
