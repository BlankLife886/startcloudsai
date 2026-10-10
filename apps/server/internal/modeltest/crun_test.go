package modeltest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestCRUNImageSendsStoredModelParameters(t *testing.T) {
	var inputs []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/client/job/EstimateTask":
			fmt.Fprint(w, `{"code":200,"message":"success","data":{"estimated_credits":2,"balance":50,"affordable":true}}`)
		case "/api/v1/client/job/CreateTask":
			var body struct {
				Model string         `json:"model"`
				Input map[string]any `json:"input"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Model != "openai/gpt-image-2-5" {
				t.Fatalf("body = %#v, err = %v", body, err)
			}
			inputs = append(inputs, body.Input)
			fmt.Fprintf(w, `{"code":200,"message":"success","data":{"task_id":"task-%d"}}`, len(inputs))
		case "/api/v1/client/job/TaskInfo":
			id := r.URL.Query().Get("task_id")
			fmt.Fprintf(w, `{"code":200,"message":"success","data":{"task_id":%q,"status":"success","result":{"code":200,"message":"ok","media_urls":["https://cdn.example/%s.png"]}}}`, id, id)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	model := modelconfig.Model{
		UpstreamModel:       "openai/gpt-image-2-5",
		UpstreamInputFields: []string{"prompt", "img_urls", "model_variant", "aspect_ratio", "resolution"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{
			"model_variant": map[string]any{"enum": []any{"flare", "sunburst"}},
			"aspect_ratio":  map[string]any{"enum": []any{"1:1", "16:9"}},
			"resolution":    map[string]any{"enum": []any{"1k", "2k"}},
		}},
		UpstreamFixedInput: map[string]string{"model_variant": "sunburst"},
		Resolutions:        []string{"1K", "2K"}, AspectRatios: []string{"1:1", "16:9"},
	}
	provider := modelconfig.Provider{BaseURL: server.URL, APIKey: "test-key", TimeoutSecs: 5}
	result := CRUNImage(context.Background(), provider, model, CRUNImageOptions{Resolution: "2K", AspectRatio: "16:9", Edit: true})
	if !result.OK() || len(result.Steps) != 2 {
		t.Fatalf("result = %#v", result)
	}
	if inputs[0]["model_variant"] != "sunburst" || inputs[0]["resolution"] != "2k" || inputs[0]["aspect_ratio"] != "16:9" {
		t.Fatalf("generate input = %#v", inputs[0])
	}
	if refs, _ := inputs[1]["img_urls"].([]any); len(refs) != 1 || refs[0] != "https://cdn.example/task-1.png" {
		t.Fatalf("edit input = %#v", inputs[1])
	}
}

func TestCRUNImageEditOnlyNeedsReference(t *testing.T) {
	model := modelconfig.Model{
		UpstreamModel: "qwen-image-edit", UpstreamInputFields: []string{"prompt", "img_urls"},
		UpstreamRequiredInputFields: []string{"img_urls", "prompt"},
	}
	result := CRUNImage(context.Background(), modelconfig.Provider{BaseURL: "https://api.crun.ai", APIKey: "k"}, model, CRUNImageOptions{})
	if result.OK() || len(result.Steps) != 1 || result.Steps[0].Name != "图生图" {
		t.Fatalf("result = %#v", result)
	}
}

func TestCRUNPriceQuotesCoverSchemaOptions(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/client/job/EstimateTask" {
			t.Fatalf("unexpected call %s: a quote must not create tasks", r.URL.Path)
		}
		var body struct {
			Input map[string]any `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		credits := map[string]int{"1K": 6, "4K": 10}[fmt.Sprint(body.Input["resolution"])]
		if _, ok := body.Input["img_urls"]; ok {
			credits += 1
		}
		mu.Lock()
		seen[fmt.Sprintf("%v %v %v", body.Input["resolution"], body.Input["quality"], body.Input["model_variant"])] = true
		mu.Unlock()
		fmt.Fprintf(w, `{"code":200,"message":"success","data":{"estimated_credits":%d,"balance":99,"affordable":true}}`, credits)
	}))
	defer server.Close()
	model := modelconfig.Model{
		UpstreamModel:       "openai/gpt-image-2-premium",
		UpstreamInputFields: []string{"prompt", "img_urls", "resolution", "quality", "model_variant"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{
			"resolution": map[string]any{"enum": []any{"1K", "4K"}},
			"quality":    map[string]any{"enum": []any{"low", "high"}},
		}},
		UpstreamFixedInput: map[string]string{"model_variant": "sunburst"},
	}
	quotes, balance, err := CRUNPriceQuotes(context.Background(), modelconfig.Provider{BaseURL: server.URL, APIKey: "k", TimeoutSecs: 5}, model)
	if err != nil || balance != 99 || len(quotes) != 8 {
		t.Fatalf("quotes = %#v balance = %v err = %v", quotes, balance, err)
	}
	for _, quote := range quotes {
		want := map[string]float64{"1K": 6, "4K": 10}[quote.Resolution]
		if quote.WithReference {
			want++
		}
		if quote.Error != "" || quote.Credits != want {
			t.Fatalf("quote = %#v, want %v credits", quote, want)
		}
	}
	if !seen["1K low sunburst"] || !seen["4K high sunburst"] {
		t.Fatalf("combinations sent = %v", seen)
	}
}

func TestCRUNPriceQuotesTryAnotherRatio(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Input map[string]any `json:"input"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Input["resolution"] == "4K" && body.Input["aspect_ratio"] == "1:1" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			fmt.Fprint(w, `{"code":422,"message":"Value error, 1:1 aspect ratio is not supported for 4k resolution","data":null}`)
			return
		}
		fmt.Fprint(w, `{"code":200,"message":"success","data":{"estimated_credits":10,"balance":1,"affordable":true}}`)
	}))
	defer server.Close()
	model := modelconfig.Model{
		UpstreamModel:       "openai/gpt-image-2",
		UpstreamInputFields: []string{"prompt", "aspect_ratio", "resolution"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{
			"aspect_ratio": map[string]any{"enum": []any{"1:1", "16:9", "auto"}},
			"resolution":   map[string]any{"enum": []any{"4K"}},
		}},
	}
	quotes, _, err := CRUNPriceQuotes(context.Background(), modelconfig.Provider{BaseURL: server.URL, APIKey: "k", TimeoutSecs: 5}, model)
	if err != nil || len(quotes) != 1 || quotes[0].Error != "" || quotes[0].Credits != 10 {
		t.Fatalf("quotes = %#v err = %v", quotes, err)
	}
}
