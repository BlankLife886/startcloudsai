package store

import "testing"

func TestAssistantGalleryImagesSupportsStoredAndInMemoryMetadata(t *testing.T) {
	first := map[string]any{"fileKey": "tasks/user/run/1.png"}
	second := map[string]any{"fileKey": "tasks/user/run/2.png"}
	tests := []struct {
		name  string
		value any
		want  int
	}{
		{name: "stored json array", value: []any{first, "invalid", second}, want: 2},
		{name: "in-memory map array", value: []map[string]any{first, second}, want: 2},
		{name: "invalid", value: map[string]any{"fileKey": "ignored"}, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := len(assistantGalleryImages(tt.value)); got != tt.want {
				t.Fatalf("image count = %d, want %d", got, tt.want)
			}
		})
	}
}
