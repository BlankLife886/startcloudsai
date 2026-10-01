package modelconfig

import (
	"strings"
	"testing"
)

func TestValidateMediaToolInputUsesStoredSchema(t *testing.T) {
	model := Model{
		Kind: ModelKindImageTool, UpstreamInputFields: []string{"img_urls", "mode", "scale_factor"},
		UpstreamRequiredInputFields: []string{"img_urls"},
		UpstreamInputSchema: map[string]any{"properties": map[string]any{
			"img_urls":     map[string]any{"type": "array", "minItems": float64(1), "maxItems": float64(1)},
			"mode":         map[string]any{"type": "string", "enum": []any{"clean", "face"}},
			"scale_factor": map[string]any{"enum": []any{float64(1), float64(2), float64(4), nil}},
		}},
	}
	key := "uploads/00000000-0000-0000-0000-000000000001/original/demo.png"
	if err := ValidateMediaToolInput(model, map[string]any{"mode": "face", "scale_factor": float64(2)}, map[string][]string{"img_urls": {key}}, []string{key}); err != nil {
		t.Fatalf("valid tool input: %v", err)
	}
	if err := ValidateMediaToolInput(model, map[string]any{"mode": "invented"}, map[string][]string{"img_urls": {key}}, []string{key}); err == nil || !strings.Contains(err.Error(), "允许范围") {
		t.Fatalf("enum validation = %v", err)
	}
	if err := ValidateMediaToolInput(model, map[string]any{"unknown": true}, map[string][]string{"img_urls": {key}}, []string{key}); err == nil || !strings.Contains(err.Error(), "当前 schema") {
		t.Fatalf("unknown field validation = %v", err)
	}
}
