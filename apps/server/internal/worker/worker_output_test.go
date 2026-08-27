package worker

import (
	"errors"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/google/uuid"
)

func TestEnsureUpstreamOutputErrorRetriesEmptyCompletion(t *testing.T) {
	err := ensureUpstreamOutputError(nil, nil)
	if err == nil || !c2a.IsRetryableError(err) {
		t.Fatalf("empty upstream completion must be retryable: %v", err)
	}
	existing := &c2a.UpstreamError{Message: "explicit failure"}
	if got := ensureUpstreamOutputError(existing, nil); got != existing {
		t.Fatalf("existing error changed: %v", got)
	}
	if got := ensureUpstreamOutputError(nil, []string{"stored/output.png"}); got != nil {
		t.Fatalf("stored output should stay successful: %v", got)
	}
}

func TestShouldRecoverEmptyOpenAISubmit(t *testing.T) {
	attemptID := uuid.New()
	if !shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, nil, nil) {
		t.Fatal("configured OpenAI empty submit must enter asynchronous recovery")
	}
	if shouldRecoverEmptyOpenAISubmit(uuid.Nil, modelconfig.AdapterOpenAI, nil, nil) {
		t.Fatal("legacy request without a durable attempt cannot enter recovery")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterCRUN, nil, nil) {
		t.Fatal("CRUN empty submit must keep its adapter-specific handling")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, []string{"image"}, nil) {
		t.Fatal("completed OpenAI image must not enter recovery")
	}
	if shouldRecoverEmptyOpenAISubmit(attemptID, modelconfig.AdapterOpenAI, nil, errors.New("explicit failure")) {
		t.Fatal("explicit OpenAI failure must be preserved")
	}
}
