package worker

import "testing"

func TestNormalizeCRUNImageOptions(t *testing.T) {
	autoAspect := normalizeCRUNAspectRatio(map[string]any{"aspectRatio": "auto"}, "auto")
	if autoAspect != "" {
		got := autoAspect
		t.Fatalf("auto aspect ratio = %q, want empty provider constraint", got)
	}
	if got := normalizeCRUNResolution(map[string]any{"resolutionScale": "AUTO"}); got != "1K" {
		t.Fatalf("invalid legacy resolution = %q, want safe 1K fallback", got)
	}
	if got := normalizeCRUNAspectRatio(map[string]any{"aspectRatio": "16 / 9"}, ""); got != "16:9" {
		t.Fatalf("aspect ratio = %q", got)
	}
	if got := normalizeCRUNAspectRatio(map[string]any{"aspectRatio": "5:4"}, ""); got != "4:3" {
		t.Fatalf("closest aspect ratio = %q", got)
	}
	if got := normalizeCRUNResolutionForAspect("4K", "1:1"); got != "2K" {
		t.Fatalf("square 4K resolution = %q", got)
	}
	if got := normalizeCRUNResolutionForAspect("4K", "16:9"); got != "4K" {
		t.Fatalf("landscape 4K resolution = %q", got)
	}
}
