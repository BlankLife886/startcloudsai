package worker

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

func TestUpstreamSubmitTracesAttachToTimelineMeta(t *testing.T) {
	traces := &upstreamSubmitTraces{}
	if meta := traces.withMeta(map[string]any{"model": "m"}); meta["submitTraces"] != nil {
		t.Fatalf("no traces should leave meta untouched: %#v", meta)
	}
	traces.add(c2a.SubmitTrace{ClientTaskID: "task-1", BodyBytes: 2048, GotConnMs: 3, WroteRequestMs: 40, FirstByteMs: -1, Error: "context deadline exceeded"})
	traces.add(c2a.SubmitTrace{ClientTaskID: "task-1", GotConnMs: 1, WroteRequestMs: 20, FirstByteMs: 900, StatusCode: 200})
	meta := traces.withMeta(map[string]any{"model": "m"})
	list, ok := meta["submitTraces"].([]map[string]any)
	if !ok || len(list) != 2 || meta["model"] != "m" {
		t.Fatalf("unexpected meta: %#v", meta)
	}
	if list[0]["firstByteMs"] != int64(-1) || list[0]["error"] != "context deadline exceeded" || list[1]["statusCode"] != 200 {
		t.Fatalf("trace fields not preserved: %#v", list)
	}
}
