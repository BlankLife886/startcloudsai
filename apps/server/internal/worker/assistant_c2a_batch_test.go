package worker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

func TestWaitAssistantC2ATaskStopsOnExplicitFailure(t *testing.T) {
	for _, status := range []string{"failed", "canceled", "expired", "text_review"} {
		t.Run(status, func(t *testing.T) {
			polls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				polls++
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprintf(w, `{"items":[{"id":"failed-task","status":%q,"error":"generation rejected"}]}`, status)
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()
			client := c2a.NewWithPolicy(server.URL, "test-key", 30, true)
			_, err := waitAssistantC2ATask(ctx, client, "failed-task", 1, nil, nil)
			var terminalErr *assistantC2ATerminalError
			if !errors.As(err, &terminalErr) || err.Error() != "generation rejected" || polls != 1 {
				t.Fatalf("terminal failure was not returned immediately: polls=%d err=%T %v", polls, err, err)
			}
		})
	}
}

func TestSubmitAndWaitAssistantC2ATaskRetriesTerminalSlotWithNewID(t *testing.T) {
	submits, polls := 0, 0
	persisted := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		polls++
		w.Header().Set("Content-Type", "application/json")
		id := r.URL.Query().Get("ids")
		if id == "run-1" {
			fmt.Fprint(w, `{"items":[{"id":"run-1","status":"failed","error":"generation rejected"}]}`)
			return
		}
		fmt.Fprintf(w, `{"items":[{"id":%q,"status":"success","data":[{"b64_json":"recovered"}]}]}`, id)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	client := c2a.NewWithPolicy(server.URL, "test-key", 30, true)
	actual, err := generateAssistantC2AIndividualItems(ctx, "run", 1,
		func(ctx context.Context, clientTaskID string, _ int) ([]string, error) {
			return submitAndWaitAssistantC2ATask(ctx, client, clientTaskID, persisted, 1,
				func(context.Context) ([]string, bool, string, error) {
					submits++
					return nil, true, clientTaskID, nil
				}, func(id string) error { persisted = id; return nil })
		}, func(_ int, image string) error {
			if image != "recovered" {
				return fmt.Errorf("unexpected image %q", image)
			}
			return nil
		})
	if err != nil || actual != 1 || submits != 2 || polls != 2 || persisted != "run-1-retry-1" {
		t.Fatalf("actual=%d submits=%d polls=%d persisted=%q err=%v", actual, submits, polls, persisted, err)
	}
}

func TestSubmitAndWaitAssistantC2ATaskKeepsAmbiguousSlot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "gateway unavailable", http.StatusBadGateway)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	client := c2a.NewWithPolicy(server.URL, "test-key", 30, true)
	persisted := ""
	_, err := submitAndWaitAssistantC2ATask(ctx, client, "original-task", "", 1,
		func(context.Context) ([]string, bool, string, error) { return nil, true, "original-task", nil },
		func(id string) error { persisted = id; return nil })
	var networkErr *c2a.NetworkError
	if !errors.As(err, &networkErr) || persisted != "original-task" {
		t.Fatalf("ambiguous task identity was discarded: persisted=%q err=%T %v", persisted, err, err)
	}
}

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
	if got := assistantFailureCode(&c2a.UpstreamError{Message: "504 Gateway Time-out", StatusCode: http.StatusGatewayTimeout}); got != "upstream_timeout" {
		t.Fatalf("gateway timeout code = %q", got)
	}
	if got := assistantFailureCode(&assistantStorageError{err: fmt.Errorf("put object: %w", io.EOF)}); got != "storage_unavailable" {
		t.Fatalf("storage code = %q", got)
	}
}

func TestSubmitAndWaitAssistantC2ATaskRecoversAmbiguousGatewayTimeout(t *testing.T) {
	var polls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/image-tasks" || r.URL.Query().Get("ids") != "assistant-task" {
			http.NotFound(w, r)
			return
		}
		polls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"client_task_id":"assistant-task","status":"success","data":[{"b64_json":"recovered"}]}]}`))
	}))
	defer server.Close()

	client := c2a.NewWithPolicy(server.URL, "test-key", 30, true)
	persisted := ""
	images, err := submitAndWaitAssistantC2ATask(context.Background(), client, "assistant-task", "", 1,
		func(context.Context) ([]string, bool, string, error) {
			return nil, false, "", &c2a.UpstreamError{Message: "<html>504 Gateway Time-out</html>", StatusCode: http.StatusGatewayTimeout}
		}, func(taskID string) error {
			persisted = taskID
			return nil
		})
	if err != nil || len(images) != 1 || images[0] != "recovered" {
		t.Fatalf("images=%#v err=%v", images, err)
	}
	if persisted != "assistant-task" || polls != 1 {
		t.Fatalf("persisted=%q polls=%d", persisted, polls)
	}
}

func TestSubmitAndWaitAssistantC2ATaskResumesPersistedTaskWithoutSubmit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"canonical-task","status":"success","data":[{"b64_json":"resumed"}]}]}`))
	}))
	defer server.Close()

	client := c2a.NewWithPolicy(server.URL, "test-key", 30, true)
	submits := 0
	images, err := submitAndWaitAssistantC2ATask(context.Background(), client, "assistant-task", "canonical-task", 1,
		func(context.Context) ([]string, bool, string, error) {
			submits++
			return nil, false, "", nil
		}, nil)
	if err != nil || len(images) != 1 || images[0] != "resumed" || submits != 0 {
		t.Fatalf("images=%#v submits=%d err=%v", images, submits, err)
	}
}
