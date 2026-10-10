package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestExactSizeConfiguredOpenAIRequestPreservesPixels(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["size"] != "1001x777" {
			t.Errorf("exact pixels changed upstream: %#v", body)
		}
		if r.URL.Path == "/api/image-tasks/generations" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, `{"data":[{"b64_json":"aW1hZ2U="}]}`)
	}))
	defer upstream.Close()
	w := &Worker{Cfg: &config.Config{C2AAllowPrivate: true}}
	selection := &modelconfig.Selection{Provider: modelconfig.Provider{Adapter: modelconfig.AdapterOpenAI, BaseURL: upstream.URL, APIKey: "test-key", TimeoutSecs: 2}, Model: modelconfig.Model{Kind: modelconfig.ModelKindImage, UpstreamModel: "exact-model", SupportsExactSize: true}}
	task := &store.Task{Type: "t2i", Prompt: "poster", Count: 1, Params: map[string]any{"sizeMode": "exact", "exactWidth": 1001, "exactHeight": 777, "size": "auto"}}
	images, err := w.callConfiguredUpstream(context.Background(), task, selection, nil)
	if err != nil || len(images) != 1 {
		t.Fatalf("images=%#v err=%v", images, err)
	}
}

func TestExactSizeCRUNPlanAndCanvasToolKeepExplicitContract(t *testing.T) {
	base := map[string]any{"sizeMode": "exact", "exactWidth": 1001, "exactHeight": 777, "requestSize": "1001x777"}
	item := assistantImageExecutionItem{SizeMode: "exact", ExactWidth: 777, ExactHeight: 1001, RequestSize: "777x1001"}
	params := assistantImagePlanParams(base, item)
	request := crun.OpenAIImageRequest{Size: "1001x777", Resolution: "4K", AspectRatio: "1:1"}
	if err := applyCRUNExactSize(&request, params, []string{"width", "height"}); err != nil {
		t.Fatal(err)
	}
	if request.Size != "777x1001" || request.ExactWidth != 777 || request.ExactHeight != 1001 || request.Resolution != "" || request.AspectRatio != "" {
		t.Fatalf("plan dimensions changed: %#v", request)
	}
	properties := canvasUpdateGenerationSettingsTool().Parameters["properties"].(map[string]any)
	for _, field := range []string{"sizeMode", "exactWidth", "exactHeight"} {
		if properties[field] == nil {
			t.Fatalf("canvas tool omitted %s", field)
		}
	}
}
