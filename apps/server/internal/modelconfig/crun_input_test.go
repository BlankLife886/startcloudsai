package modelconfig

import (
	"strings"
	"testing"
)

func crunVariantModel() Model {
	return Model{
		Name: "GPT Image 2.5 Sunburst", Kind: ModelKindImage,
		UpstreamInputFields: []string{"prompt", "img_urls", "model_variant", "resolution"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{
			"prompt":        map[string]any{"type": "string"},
			"img_urls":      map[string]any{"type": "array"},
			"model_variant": map[string]any{"enum": []any{"flare", "sunburst"}},
			"resolution":    map[string]any{"enum": []any{"1k", "2k", "4k"}},
		}},
		Resolutions: []string{"1K", "2K", "4K"},
	}
}

func TestValidateFixedInput(t *testing.T) {
	crun := Provider{Adapter: AdapterCRUN}
	model := crunVariantModel()
	model.UpstreamFixedInput = map[string]string{"model_variant": "Sunburst"}
	if err := validateFixedInput(model, crun); err != nil {
		t.Fatalf("valid variant: %v", err)
	}
	model.UpstreamFixedInput = map[string]string{"model_variant": "nova"}
	if err := validateFixedInput(model, crun); err == nil || !strings.Contains(err.Error(), "可选值") {
		t.Fatalf("unknown variant = %v", err)
	}
	model.UpstreamFixedInput = map[string]string{"resolution": "4k"}
	if err := validateFixedInput(model, crun); err == nil || !strings.Contains(err.Error(), "不能固定") {
		t.Fatalf("platform field = %v", err)
	}
	model.UpstreamFixedInput = map[string]string{"mode": "fast"}
	if err := validateFixedInput(model, crun); err == nil || !strings.Contains(err.Error(), "schema") {
		t.Fatalf("undeclared field = %v", err)
	}
	model.UpstreamFixedInput = map[string]string{"model_variant": "flare"}
	if err := validateFixedInput(model, Provider{Adapter: AdapterOpenAI}); err == nil {
		t.Fatal("non-CRUN provider accepted a fixed input")
	}
}

func TestCRUNResolutionUsesSchemaSpelling(t *testing.T) {
	model := crunVariantModel()
	if got := CRUNResolution(model, "2K"); got != "2k" {
		t.Fatalf("lower-case schema resolution = %q", got)
	}
	model.UpstreamInputSchema["properties"].(map[string]any)["resolution"] = map[string]any{"enum": []any{"2K", "4K"}}
	model.Resolutions = []string{"2K", "4K"}
	if got := CRUNResolution(model, "1K"); got != "2K" {
		t.Fatalf("unsupported default tier = %q, want first configured", got)
	}
	model.UpstreamInputFields = []string{"prompt"}
	if got := CRUNResolution(model, "1K"); got != "1K" {
		t.Fatalf("model without resolution = %q", got)
	}
}

func TestAdaptCRUNImage(t *testing.T) {
	model := Model{
		UpstreamInputFields: []string{"prompt", "aspect_ratio", "resolution"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{
			"prompt":       map[string]any{"maxLength": float64(5)},
			"aspect_ratio": map[string]any{"enum": []any{"1:1", "3:4", "4:5", "auto"}},
			"resolution":   map[string]any{"enum": []any{"1k", "2k"}},
		}},
		Resolutions: []string{"1K", "2K"},
	}
	got := AdaptCRUNImage(model, CRUNImageParams{Prompt: "一二三四五六", AspectRatio: "4:5", Resolution: "2K"})
	if got.Prompt != "一二三四五" || got.AspectRatio != "4:5" || got.Resolution != "2k" {
		t.Fatalf("adapted = %#v", got)
	}
	if ratio := CRUNAspectRatio(model, "9:16"); ratio != "3:4" {
		t.Fatalf("nearest ratio = %q", ratio)
	}
	if ratio := CRUNAspectRatio(model, "auto"); ratio != "auto" {
		t.Fatalf("schema auto = %q", ratio)
	}
	model.UpstreamInputSchema["properties"].(map[string]any)["aspect_ratio"] = map[string]any{"enum": []any{"1:1"}}
	if ratio := CRUNAspectRatio(model, "auto"); ratio != "" {
		t.Fatalf("auto without schema support = %q, want omitted", ratio)
	}
}

func TestModelPromptLimitWinsOverSchema(t *testing.T) {
	model := Model{
		UpstreamInputFields: []string{"prompt"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{"prompt": map[string]any{"maxLength": float64(5)}}},
		PromptMaxChars:      3,
	}
	if got := AdaptCRUNImage(model, CRUNImageParams{Prompt: "一二三四五六"}).Prompt; got != "一二三" {
		t.Fatalf("prompt = %q, want the model's own limit", got)
	}
}

func TestCleanAspectRatiosKeepsCustomRatios(t *testing.T) {
	got := cleanAspectRatios([]string{"1:4", "16:9", "8:1", "bad", "0:1", "50:1", " 9:19.5 ", "AUTO", "16:9"})
	want := []string{"auto", "16:9", "8:1", "9:19.5", "1:4"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("ratios = %v, want %v", got, want)
	}
}
