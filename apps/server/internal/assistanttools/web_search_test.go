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
		{prompt: "物联网设备怎么配网", want: false},
		{prompt: "上网本和平板怎么选", want: false},
		{prompt: "互联网公司有哪些岗位", want: false},
		{prompt: "帮我联网查一下物联网行业的最新新闻", want: true},
	}
	for _, test := range tests {
		if got := WebSearchRequested(test.prompt); got != test.want {
			t.Fatalf("WebSearchRequested(%q) = %v, want %v", test.prompt, got, test.want)
		}
	}
}
