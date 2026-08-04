package worker

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

func TestGenerateAssistantC2AItemsCompletesEveryRequestedSlot(t *testing.T) {
	var mu sync.Mutex
	called := map[string]int{}
	stored := map[int]string{}
	actual, err := generateAssistantC2AItems(context.Background(), "run", 3, func(_ context.Context, taskID string) ([]string, error) {
		mu.Lock()
		called[taskID]++
		mu.Unlock()
		return []string{"image-" + taskID}, nil
	}, func(index int, encoded string) error {
		stored[index] = encoded
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if actual != 3 || len(stored) != 3 {
		t.Fatalf("actual=%d stored=%#v", actual, stored)
	}
	for index := 0; index < 3; index++ {
		taskID := fmt.Sprintf("run-%d", index+1)
		if called[taskID] != 1 || stored[index] != "image-"+taskID {
			t.Fatalf("slot %d called=%#v stored=%#v", index, called, stored)
		}
	}
}

func TestGenerateAssistantC2AItemsRetriesOnlyFailedSlot(t *testing.T) {
	var mu sync.Mutex
	called := map[string]int{}
	actual, err := generateAssistantC2AItems(context.Background(), "run", 2, func(_ context.Context, taskID string) ([]string, error) {
		mu.Lock()
		called[taskID]++
		mu.Unlock()
		if taskID == "run-2" {
			return nil, &c2a.UpstreamError{Message: "temporary timeout", StatusCode: http.StatusBadGateway}
		}
		return []string{"image"}, nil
	}, func(_ int, _ string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if actual != 2 || called["run-1"] != 1 || called["run-2"] != 1 || called["run-2-retry-1"] != 1 {
		t.Fatalf("actual=%d called=%#v", actual, called)
	}
}

func TestGenerateAssistantC2AItemsReturnsErrorWhenEverySlotFails(t *testing.T) {
	actual, err := generateAssistantC2AItems(context.Background(), "run", 2, func(_ context.Context, _ string) ([]string, error) {
		return nil, &c2a.UpstreamError{Message: "invalid prompt", StatusCode: http.StatusBadRequest}
	}, func(_ int, _ string) error { return nil })
	if err == nil || actual != 0 {
		t.Fatalf("actual=%d err=%v", actual, err)
	}
}
