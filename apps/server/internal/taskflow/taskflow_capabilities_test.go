package taskflow

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestValidateModelImageCapabilities(t *testing.T) {
	model := modelconfig.Model{
		AspectRatios: []string{"1:1", "16:9"}, Qualities: []string{"medium", "high"},
		TransparentBackground: false, OutputFormats: []string{"png"},
		ModerationLevels: []string{"auto"}, MaxReferenceImages: 2,
	}
	tests := []struct {
		name       string
		params     map[string]any
		references int
	}{
		{name: "aspect", params: map[string]any{"aspectRatio": "9:16"}},
		{name: "quality", params: map[string]any{"quality": "low"}},
		{name: "transparent", params: map[string]any{"transparentBackground": true}},
		{name: "format", params: map[string]any{"outputFormat": "webp"}},
		{name: "moderation", params: map[string]any{"moderationLevel": "low"}},
		{name: "references", params: map[string]any{}, references: 3},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateModelImageCapabilities(model, test.params, test.references); err == nil {
				t.Fatal("expected unsupported capability error")
			}
		})
	}
	if err := validateModelImageCapabilities(model, map[string]any{
		"aspectRatio": "16:9", "quality": "standard", "outputFormat": "png", "moderationLevel": "auto",
	}, 2); err != nil {
		t.Fatalf("supported capabilities rejected: %v", err)
	}
}

func TestValidateModelImageCapabilitiesByResolution(t *testing.T) {
	model := modelconfig.Model{
		Resolutions:  []string{"1K", "4K"},
		AspectRatios: []string{"auto", "16:9", "1:1"},
		AspectRatiosByResolution: map[string][]string{
			"1K": {"auto", "16:9"},
			"4K": {"auto", "1:1"},
		},
		Qualities: []string{"high"}, MaxReferenceImages: 0,
	}
	if err := validateModelImageCapabilities(model, map[string]any{
		"resolutionScale": "4K", "aspectRatio": "16:9", "quality": "high",
	}, 0); err == nil {
		t.Fatal("expected 4K to reject a ratio only configured for 1K")
	}
	if err := validateModelImageCapabilities(model, map[string]any{
		"resolutionScale": "4K", "aspectRatio": "1:1", "quality": "high",
	}, 0); err != nil {
		t.Fatalf("4K configured ratio rejected: %v", err)
	}
}
