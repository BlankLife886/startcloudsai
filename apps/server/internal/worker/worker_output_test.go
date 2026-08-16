package worker

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
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
