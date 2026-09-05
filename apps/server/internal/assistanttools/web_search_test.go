package assistanttools

import "testing"

func TestWebSearchRequested(t *testing.T) {
	tests := []struct {
		prompt string
		want   bool
	}{
		{prompt: "请联网搜索今天的官方消息", want: true},
		{prompt: "search the web for current product news", want: true},
		{prompt: "查一下参考图中的文字", want: false},
		{prompt: "搜索我的素材库", want: false},
	}
	for _, test := range tests {
		if got := WebSearchRequested(test.prompt); got != test.want {
			t.Fatalf("WebSearchRequested(%q) = %v, want %v", test.prompt, got, test.want)
		}
	}
}
