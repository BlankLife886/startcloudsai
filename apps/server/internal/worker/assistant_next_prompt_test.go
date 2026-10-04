package worker

import (
	"strings"
	"testing"
)

func TestSplitAssistantNextPrompt(t *testing.T) {
	cases := []struct {
		name, in, text, next string
	}{
		{"trailing line", "可以。你想画哪一个？\n\n<next>帮我按第 1 个方向出图</next>", "可以。你想画哪一个？", "帮我按第 1 个方向出图"},
		{"no suggestion", "本月共消耗 240 积分。", "本月共消耗 240 积分。", ""},
		{"quotes and spaces are trimmed", "好的\n<next> “再做一版 9:16 的” </next>\n", "好的", "再做一版 9:16 的"},
		{"only at the end", "用 <next> 标签不算</next> 后面还有正文", "用 <next> 标签不算</next> 后面还有正文", ""},
		{"too long is dropped", "好的\n<next>" + strings.Repeat("长", 80) + "</next>", "好的", ""},
		{"unfinished tag is hidden", "好的\n<next>帮我出", "好的", ""},
		{"half-typed tag is hidden", "好的\n<ne", "好的", ""},
	}
	for _, tc := range cases {
		text, next := splitAssistantNextPrompt(tc.in)
		if text != tc.text || next != tc.next {
			t.Errorf("%s: got (%q, %q), want (%q, %q)", tc.name, text, next, tc.text, tc.next)
		}
	}
}

func TestAssistantHideNextPromptTailWhileStreaming(t *testing.T) {
	for in, want := range map[string]string{
		"正文\n<":          "正文",
		"正文\n<ne":        "正文",
		"正文\n<next>帮我": "正文",
		"a < b 是对的":      "a < b 是对的",
		"正文没有标签":         "正文没有标签",
	} {
		if got := assistantHideNextPromptTail(in); got != want {
			t.Errorf("hide(%q) = %q, want %q", in, got, want)
		}
	}
}
