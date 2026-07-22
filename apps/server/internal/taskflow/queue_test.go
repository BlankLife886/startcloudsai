package taskflow

import (
	"testing"
	"time"
)

func TestNewQueueCoversMaximumDynamicC2ATimeout(t *testing.T) {
	queue, err := NewQueue("redis://localhost:6379/0", 180)
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	defer queue.Close()

	want := time.Duration(maxC2ATimeoutSecs*2+120) * time.Second
	if queue.timeout != want {
		t.Fatalf("queue timeout = %s, want %s", queue.timeout, want)
	}
}
