package store

import "testing"

func TestIsCanvasOrigin(t *testing.T) {
	cases := []struct {
		name   string
		params map[string]any
		want   bool
	}{
		{name: "nil", want: false},
		{name: "assistant", params: map[string]any{"_source": "assistant"}, want: false},
		{name: "react canvas", params: map[string]any{"_source": "react_canvas"}, want: true},
		{name: "workspace", params: map[string]any{"workspace": "infinite_canvas"}, want: true},
		{name: "kind", params: map[string]any{"_kind": "canvas-chat"}, want: true},
	}
	for _, test := range cases {
		if got := IsCanvasOrigin(test.params); got != test.want {
			t.Fatalf("%s: IsCanvasOrigin = %v, want %v", test.name, got, test.want)
		}
	}
	if got := AssistantProductName(map[string]any{"_source": "react_canvas"}); got != "无限画布" {
		t.Fatalf("AssistantProductName canvas = %q", got)
	}
	if got := AssistantProductName(nil); got != "AI 助手" {
		t.Fatalf("AssistantProductName default = %q", got)
	}
}
