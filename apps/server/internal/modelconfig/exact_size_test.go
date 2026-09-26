package modelconfig

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestExactSizeDefaultsAndDisabledLimitsSurviveNormalization(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal([]byte(`{"models":[{"id":"legacy","kind":"image"},{"id":"disabled","kind":"image","exactSizeLimits":{"minWidth":320,"maxWidth":2000,"minHeight":320,"maxHeight":2000,"step":8,"minPixels":200000,"maxPixels":2000000,"maxAspectRatio":2}}]}`), &cfg); err != nil {
		t.Fatal(err)
	}
	normalize(&cfg)
	if cfg.Models[0].SupportsExactSize || cfg.Models[0].ExactSizeRules() != DefaultExactSizeLimits() {
		t.Fatalf("legacy model exact-size defaults = %#v", cfg.Models[0])
	}
	if cfg.Models[1].SupportsExactSize || cfg.Models[1].ExactSizeRules().MinWidth != 320 || cfg.Models[1].ExactSizeRules().MaxAspectRatio != 2 {
		t.Fatalf("disabled limits were discarded: %#v", cfg.Models[1])
	}
	if err := validateExactSizeConfig(Model{Kind: ModelKindChat, SupportsExactSize: true}, Provider{Adapter: AdapterOpenAI}); err == nil {
		t.Fatal("chat model accepted exact-size capability")
	}
}

func TestExactSizeValidatesCombinedLimits(t *testing.T) {
	model := Model{Kind: ModelKindImage, SupportsExactSize: true, ExactSizeLimits: &ExactSizeLimits{
		MinWidth: 256, MaxWidth: 3840, MinHeight: 256, MaxHeight: 3840,
		Step: 16, MinPixels: 655360, MaxPixels: 8294400, MaxAspectRatio: 3,
	}}
	for _, dimensions := range [][2]int{{1024, 1024}, {3840, 2160}, {1280, 768}} {
		if err := ValidateExactImageSize(model, dimensions[0], dimensions[1]); err != nil {
			t.Fatalf("valid size %v rejected: %v", dimensions, err)
		}
	}
	for _, dimensions := range [][2]int{{1000, 768}, {4096, 2048}, {256, 256}, {3840, 3840}, {3008, 800}} {
		if err := ValidateExactImageSize(model, dimensions[0], dimensions[1]); err == nil {
			t.Fatalf("invalid size %v accepted", dimensions)
		}
	}
	for _, limits := range []ExactSizeLimits{
		{MinWidth: 1024, MaxWidth: 1024, MinHeight: 512, MaxHeight: 512, Step: 16, MaxAspectRatio: 1},
		{MinWidth: 256, MaxWidth: 300, MinHeight: 256, MaxHeight: 300, Step: 64, MinPixels: 70000},
		{MinWidth: 256, MaxWidth: 512, MinHeight: 256, MaxHeight: 512, Step: 0},
		{MinWidth: 256, MaxWidth: 16385, MinHeight: 256, MaxHeight: 512, Step: 1},
	} {
		if err := validateExactSizeLimits(limits); err == nil {
			t.Fatalf("impossible limits accepted: %#v", limits)
		}
	}
}

func TestExactSizePreservesPixelsAndLegacySizeStrings(t *testing.T) {
	legacy := map[string]any{"size": "1024x1792", "outputSize": "1024x1792", "resolution": "2K"}
	want := map[string]any{"size": "1024x1792", "outputSize": "1024x1792", "resolution": "2K"}
	if err := NormalizeExactImageParams(Model{}, AdapterOpenAI, legacy); err != nil || !reflect.DeepEqual(legacy, want) {
		t.Fatalf("legacy size changed: %#v err=%v", legacy, err)
	}
	params := map[string]any{"sizeMode": "exact", "exactWidth": 1001, "exactHeight": 777, "size": "1024x1024", "resolution": "4K", "aspectRatio": "auto"}
	model := Model{Kind: ModelKindImage, SupportsExactSize: true}
	if err := NormalizeExactImageParams(model, AdapterOpenAI, params); err != nil {
		t.Fatal(err)
	}
	if params["size"] != "1001x777" || params["outputSize"] != "1001x777" || params["requestSize"] != "1001x777" || params["width"] != 1001 || params["height"] != 777 {
		t.Fatalf("exact dimensions changed: %#v", params)
	}
	if _, exists := params["resolution"]; exists {
		t.Fatal("resolution could override exact pixels")
	}
	for _, width := range []any{nil, "1000", 1000.5, 0, -1, 16385} {
		if err := ValidateExactImageParams(model, AdapterOpenAI, map[string]any{"sizeMode": "exact", "exactWidth": width, "exactHeight": 777}); err == nil {
			t.Fatalf("invalid width %#v accepted", width)
		}
	}
	model.SupportsExactSize = false
	if err := ValidateExactImageParams(model, AdapterOpenAI, params); err == nil {
		t.Fatal("unsupported model silently accepted exact mode")
	}
}

func TestExactSizeCRUNSchemaValidation(t *testing.T) {
	model := Model{Kind: ModelKindImage, SupportsExactSize: true, UpstreamInputFields: []string{"prompt", "size"}, UpstreamInputSchema: map[string]any{
		"properties": map[string]any{"size": map[string]any{"type": []any{"string", "null"}, "enum": []any{"auto", "1001x777"}}},
	}}
	params := map[string]any{"sizeMode": "exact", "exactWidth": 1001, "exactHeight": 777}
	if err := ValidateExactImageParams(model, AdapterCRUN, params); err != nil {
		t.Fatal(err)
	}
	params["exactWidth"] = 1000
	if err := ValidateExactImageParams(model, AdapterCRUN, params); err == nil {
		t.Fatal("size outside CRUN enum accepted")
	}
	model.UpstreamInputFields = []string{"prompt", "width", "height"}
	model.UpstreamInputSchema = map[string]any{"properties": map[string]any{
		"width":  map[string]any{"type": []any{"integer", "null"}, "minimum": 512, "maximum": 2048, "multipleOf": 16},
		"height": map[string]any{"type": "integer", "minimum": 512, "maximum": 2048, "multipleOf": 16},
	}}
	params["exactWidth"], params["exactHeight"] = 1024, 768
	if err := ValidateExactImageParams(model, AdapterCRUN, params); err != nil {
		t.Fatal(err)
	}
	for _, width := range []int{256, 1000, 2064} {
		params["exactWidth"] = width
		if err := ValidateExactImageParams(model, AdapterCRUN, params); err == nil {
			t.Fatalf("width %d outside CRUN schema accepted", width)
		}
	}
	model.UpstreamInputFields = []string{"prompt", "resolution", "aspect_ratio"}
	if err := validateExactSizeConfig(model, Provider{Adapter: AdapterCRUN}); err == nil {
		t.Fatal("CRUN enabled exact sizes without declared fields")
	}
	model.UpstreamInputFields = []string{"size"}
	model.UpstreamInputSchema = map[string]any{"properties": map[string]any{"size": map[string]any{"type": "string", "enum": []any{"auto", "1K"}}}}
	if _, err := CRUNExactSizeFields(model); err == nil {
		t.Fatal("CRUN size tiers were treated as exact pixels")
	}
}
