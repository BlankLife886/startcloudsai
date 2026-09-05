package worker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

func TestGenerateAssistantC2AItemsCompletesEveryRequestedSlot(t *testing.T) {
	called := 0
	stored := map[int]string{}
	actual, err := generateAssistantC2AItems(context.Background(), "run", 3, func(_ context.Context, taskID string) ([]string, error) {
		called++
		if taskID != "run" {
			t.Fatalf("taskID = %q", taskID)
		}
		return []string{"image-1", "image-2", "image-3"}, nil
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
	if called != 1 {
		t.Fatalf("batch called = %d, want 1", called)
	}
}

func TestGenerateAssistantC2AIndividualItemsMapsOneReferencePerSlot(t *testing.T) {
	references := []string{"reference-1", "reference-2", "reference-3", "reference-4"}
	var mu sync.Mutex
	called := map[string]string{}
	stored := map[int]string{}
	actual, err := generateAssistantC2AIndividualItems(context.Background(), "run", len(references),
		func(_ context.Context, taskID string, index int) ([]string, error) {
			mu.Lock()
			called[taskID] = references[index]
			mu.Unlock()
			return []string{"edited-" + references[index]}, nil
		}, func(index int, encoded string) error {
			stored[index] = encoded
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if actual != len(references) || len(called) != len(references) || len(stored) != len(references) {
		t.Fatalf("actual=%d called=%#v stored=%#v", actual, called, stored)
	}
	for index, reference := range references {
		taskID := fmt.Sprintf("run-%d", index+1)
		if called[taskID] != reference || stored[index] != "edited-"+reference {
			t.Fatalf("slot %d task=%q called=%q stored=%q", index, taskID, called[taskID], stored[index])
		}
	}
}

func TestGenerateAssistantC2AIndividualItemsRetriesOnlyFailedReference(t *testing.T) {
	var mu sync.Mutex
	called := map[string]int{}
	actual, err := generateAssistantC2AIndividualItems(context.Background(), "run", 2,
		func(_ context.Context, taskID string, _ int) ([]string, error) {
			mu.Lock()
			called[taskID]++
			mu.Unlock()
			if taskID == "run-2" {
				return nil, &c2a.UpstreamError{Message: "temporary gateway error", StatusCode: http.StatusBadGateway}
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

func TestGenerateAssistantC2AItemsPreservesPartialBatch(t *testing.T) {
	actual, err := generateAssistantC2AItems(context.Background(), "run", 2, func(_ context.Context, _ string) ([]string, error) {
		return []string{"image"}, &c2a.UpstreamError{Message: "second image timed out", StatusCode: http.StatusBadGateway}
	}, func(_ int, _ string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if actual != 1 {
		t.Fatalf("actual=%d, want 1", actual)
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

func TestAssistantFailureCodeClassifiesImageTransportAndStorage(t *testing.T) {
	if got := assistantFailureCode(&c2a.NetworkError{Message: "上游图片任务等待超时"}); got != "upstream_timeout" {
		t.Fatalf("timeout code = %q", got)
	}
	if got := assistantFailureCode(&assistantStorageError{err: fmt.Errorf("put object: %w", io.EOF)}); got != "storage_unavailable" {
		t.Fatalf("storage code = %q", got)
	}
}
