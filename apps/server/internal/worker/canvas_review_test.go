package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCanvasReviewModelRequestCannotGenerateOrMutate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if tools, ok := payload["tools"].([]any); ok && len(tools) > 0 {
			t.Errorf("review was given mutation tools: %#v", tools)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		event, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": `{"status":"needs_changes","issues":["标题缺失"],"suggestions":["补充标题"]}`}, "finish_reason": "stop"}}})
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", event)
	}))
	defer server.Close()
	client, err := sub2api.New(server.URL, "test-key", "review-model", "image-model", 30)
	if err != nil {
		t.Fatal(err)
	}
	result := requestCanvasReview(context.Background(), client, []sub2api.Message{{Role: "user", Content: "核对实际产物"}})
	if result.Status != "needs_changes" || len(result.Suggestions) != 1 {
		t.Fatalf("review result lost: %#v", result)
	}
}

func TestCanvasReviewWaitsThroughTransientDisconnectWithoutSubmitting(t *testing.T) {
	steps := 0
	pauses := 0
	status, err := waitCanvasReview(context.Background(), func() (string, error) {
		steps++
		switch steps {
		case 1:
			return "running", nil
		case 2:
			return "", errors.New("connection lost")
		case 3:
			return "running", nil
		default:
			return "succeeded", nil
		}
	}, func(context.Context) error { pauses++; return nil })
	if err != nil || status != "succeeded" || steps != 4 || pauses != 3 {
		t.Fatalf("unexpected recovery: %s %v steps=%d", status, err, steps)
	}
}
func TestCanvasReviewDoesNotTurnUnknownOrCanceledIntoSuccess(t *testing.T) {
	for _, terminal := range []string{"failed", "canceled"} {
		status, err := waitCanvasReview(context.Background(), func() (string, error) { return terminal, nil }, func(context.Context) error { t.Fatal("terminal task was polled again"); return nil })
		if err != nil || status != terminal {
			t.Fatal(status, err)
		}
	}
	calls := 0
	status, err := waitCanvasReview(context.Background(), func() (string, error) { calls++; return "unknown", nil }, func(context.Context) error { return nil })
	if err != nil || status != "unverified" || calls != 3 {
		t.Fatal(status, err, calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = waitCanvasReview(ctx, func() (string, error) { t.Fatal("read after cancellation"); return "", nil }, func(context.Context) error { return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestCanvasReviewVerdictRequiresStructuredEvidence(t *testing.T) {
	for _, text := range []string{"看起来不错", `{"status":"done"}`, `{"status":"pass","issues":["缺少一张结果"]}`} {
		if decodeCanvasReviewVerdict(text).Status == "pass" {
			t.Fatalf("invalid pass: %s", text)
		}
	}
	if decodeCanvasReviewVerdict("```json\n{\"status\":\"pass\",\"issues\":[],\"suggestions\":[]}\n```").Status != "pass" {
		t.Fatal("valid review not accepted")
	}
}
func TestCanvasWorkflowStartRetainsIdentityForAutomaticReview(t *testing.T) {
	loop := canvasAgentLoopState{}
	if !canvasAgentWorkflowStartFeedback(&loop, `{"status":"started","requestId":"request","runId":"durable","configNodeIds":["a","b"]}`, "started") || len(loop.reviewTargets) != 1 || loop.reviewTargets[0].RunID != "durable" {
		t.Fatalf("review target not retained: %#v", loop.reviewTargets)
	}
	canceled := canvasAgentLoopState{}
	canvasAgentWorkflowStartFeedback(&canceled, `{"status":"canceled","requestId":"request","configNodeIds":["a"]}`, "started")
	if len(canceled.reviewTargets) != 0 {
		t.Fatal("canceled generation must not be reviewed as completed")
	}
}
