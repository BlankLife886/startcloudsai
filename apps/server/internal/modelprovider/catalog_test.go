package modelprovider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestModelsEndpointAcceptsOriginAndVersionedBaseURL(t *testing.T) {
	tests := map[string]string{
		"https://gpt.xkyh.cc.cd/v1":  "https://gpt.xkyh.cc.cd/v1/models",
		"https://rsimage.xkyh.cc.cd": "https://rsimage.xkyh.cc.cd/v1/models",
	}
	for input, want := range tests {
		got, err := modelsEndpoint(input)
		if err != nil {
			t.Fatalf("modelsEndpoint(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("modelsEndpoint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCRUNModelsEndpointUsesRealVersionedAPI(t *testing.T) {
	tests := map[string]string{
		"https://api.crun.ai":               "https://api.crun.ai/api/v1/models",
		"https://api.crun.ai/api/v1":        "https://api.crun.ai/api/v1/models",
		"https://api.crun.ai/api/v1/models": "https://api.crun.ai/api/v1/models",
	}
	for input, want := range tests {
		got, err := crunModelsEndpoint(input)
		if err != nil {
			t.Fatalf("crunModelsEndpoint(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("crunModelsEndpoint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCRUNTaskModelsEndpointAcceptsOriginAndVersionedBaseURL(t *testing.T) {
	tests := map[string]string{
		"https://api.crun.ai":        "https://api.crun.ai/api/v1/client/job/Models",
		"https://api.crun.ai/api/v1": "https://api.crun.ai/api/v1/client/job/Models",
	}
	for input, want := range tests {
		got, err := crunTaskModelsEndpoint(input)
		if err != nil {
			t.Fatalf("crunTaskModelsEndpoint(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("crunTaskModelsEndpoint(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDiscoverCRUNModelsClassifiesLiveCatalogs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/client/job/Models":
			if r.Header.Get("x-api-key") != "test-key" {
				t.Fatalf("media catalog x-api-key = %q", r.Header.Get("x-api-key"))
			}
			_, _ = w.Write([]byte(`{"code":200,"message":"success","data":{"total":3,"models":[{"model":"google/nano-banana","model_type":"image","modality":"image","operations":["image-edit","text-to-image"],"input_fields":["prompt","img_urls","aspect_ratio"],"required_input_fields":["prompt"],"supports_reference":true},{"model":"image-background-remove","model_type":"tools","modality":"image","operations":["background-remove"],"input_fields":["img_urls"],"required_input_fields":["img_urls"]},{"model":"google/veo","model_type":"video","modality":"video","operations":["text-to-video"],"input_fields":["prompt"]}]}}`))
		case "/api/v1/models":
			if r.Header.Get("Authorization") != "Bearer test-key" {
				t.Fatalf("LLM catalog authorization = %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"gpt-5.6-sol"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := DiscoverModels(context.Background(), modelconfig.Provider{
		Adapter: modelconfig.AdapterCRUN, BaseURL: server.URL, APIKey: "test-key",
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Models) != 3 || result.TaskModelCount != 3 || len(result.Entries) != 4 {
		t.Fatalf("catalog result = %#v", result)
	}
	entries := map[string]CatalogEntry{}
	for _, entry := range result.Entries {
		entries[entry.ID] = entry
	}
	if entries["google/nano-banana"].Kind != modelconfig.ModelKindImage || !entries["google/nano-banana"].Compatible {
		t.Fatalf("image entry = %#v", entries["google/nano-banana"])
	}
	if entries["image-background-remove"].Kind != modelconfig.ModelKindImageTool {
		t.Fatalf("tool entry = %#v", entries["image-background-remove"])
	}
	if entries["google/veo"].Compatible || entries["gpt-5.6-sol"].Kind != modelconfig.ModelKindChat {
		t.Fatalf("classified entries = %#v", entries)
	}
}

func TestDescribeCRUNModelReturnsInputSchema(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/client/job/Models/google/nano-banana" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"code":200,"message":"success","data":{"model":"google/nano-banana","model_type":"image","modality":"image","operations":["text-to-image"],"input_fields":["prompt","aspect_ratio"],"required_input_fields":["prompt"],"input_schema":{"type":"object","properties":{"aspect_ratio":{"type":"string","enum":["1:1","16:9"]}}}}}`))
	}))
	defer server.Close()

	entry, err := DescribeCRUNModel(context.Background(), modelconfig.Provider{
		Adapter: modelconfig.AdapterCRUN, BaseURL: server.URL, APIKey: "test-key",
	}, "google/nano-banana", true)
	if err != nil {
		t.Fatal(err)
	}
	if entry.ID != "google/nano-banana" || entry.InputSchema["type"] != "object" {
		t.Fatalf("entry = %#v", entry)
	}
}
