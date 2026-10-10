package upstreamcompat

import (
	"encoding/json"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return out
}

func TestRewriteDropsRenamesAndMergesExtraBody(t *testing.T) {
	compat := &modelconfig.RequestCompat{
		DropParams:   []string{"parallel_tool_calls"},
		RenameParams: map[string]string{"max_completion_tokens": "max_tokens"},
		ExtraBody:    map[string]any{"watermark": false},
	}
	out := decode(t, Rewrite([]byte(`{"model":"m","parallel_tool_calls":true,"max_completion_tokens":64,"n":1}`), "/v1/chat/completions", compat))
	if _, exists := out["parallel_tool_calls"]; exists {
		t.Fatal("dropped param still sent")
	}
	if _, exists := out["max_completion_tokens"]; exists || out["max_tokens"] != float64(64) {
		t.Fatalf("rename not applied: %v", out)
	}
	if out["watermark"] != false || out["model"] != "m" || out["n"] != float64(1) {
		t.Fatalf("unexpected body: %v", out)
	}
}

func TestRewriteImageSizeAsAspectRatioOnlyForImagePaths(t *testing.T) {
	compat := &modelconfig.RequestCompat{ImageSizeParam: modelconfig.ImageSizeParamAspectRatio}
	out := decode(t, Rewrite([]byte(`{"size":"1536x1024"}`), "/v1/images/generations", compat))
	if _, exists := out["size"]; exists || out["aspect_ratio"] != "3:2" {
		t.Fatalf("size not converted: %v", out)
	}
	chat := decode(t, Rewrite([]byte(`{"size":"1536x1024"}`), "/v1/chat/completions", compat))
	if chat["size"] != "1536x1024" {
		t.Fatalf("chat body must not be touched: %v", chat)
	}
	auto := decode(t, Rewrite([]byte(`{"size":"auto"}`), "/v1/images/generations", compat))
	if len(auto) != 0 {
		t.Fatalf("unparseable size should be removed without a ratio: %v", auto)
	}
}

func TestRewriteLeavesNonObjectsAlone(t *testing.T) {
	compat := &modelconfig.RequestCompat{DropParams: []string{"x"}}
	if got := string(Rewrite([]byte(`[1,2]`), "/v1/x", compat)); got != `[1,2]` {
		t.Fatalf("got %s", got)
	}
}

func TestAspectRatioForSize(t *testing.T) {
	cases := map[string]string{"1024x1024": "1:1", "1792x1024": "16:9", "1024x1536": "2:3", "2048x880": "21:9", "bad": ""}
	for size, want := range cases {
		if got := AspectRatioForSize(size); got != want {
			t.Errorf("%s: got %q want %q", size, got, want)
		}
	}
}
