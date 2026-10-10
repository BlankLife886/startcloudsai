package worker

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/crun"
)

func TestUpstreamQualityHonorsModelSwitch(t *testing.T) {
	if got := upstreamQuality(map[string]any{"quality": "high"}, "high"); got != "high" {
		t.Fatalf("quality = %q, want it sent by default", got)
	}
	if got := upstreamQuality(map[string]any{"quality": "high", "_qualityNotSent": true}, "high"); got != "" {
		t.Fatalf("quality = %q, want it held back", got)
	}
}

func TestUpstreamRejectsRequestIgnoresMemberFaults(t *testing.T) {
	invalid := &crun.PreflightError{Err: &crun.UpstreamError{Status: 422, Code: 422, Message: "1:1 aspect ratio is not supported for 4k resolution"}}
	if !upstreamRejectsRequest(invalid) {
		t.Fatal("a 422 parameter error should not count against the slot member")
	}
	if upstreamRejectsRequest(&crun.UpstreamError{Status: 500, Code: 500}) || upstreamRejectsRequest(&crun.UpstreamError{Status: 402, Code: 402}) {
		t.Fatal("server errors and refusals still count")
	}
}
