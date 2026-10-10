package worker

import (
	"reflect"
	"strings"
	"testing"
)

func TestSplitAssistantFollowUps(t *testing.T) {
	cases := []struct {
		name, in, text string
		items          []string
	}{
		{"three follow-ups", "可以。你想画哪一个？\n\n<followups>帮我按第 1 个方向出图｜再做一版 9:16 的｜第 2 个方向适合什么场景？</followups>",
			"可以。你想画哪一个？", []string{"帮我按第 1 个方向出图", "再做一版 9:16 的", "第 2 个方向适合什么场景？"}},
		{"older single next", "可以。\n\n<next>帮我按第 1 个方向出图</next>", "可以。", []string{"帮我按第 1 个方向出图"}},
		{"no suggestion", "本月共消耗 240 积分。", "本月共消耗 240 积分。", nil},
		{"quotes, numbers, duplicates and ascii bars", "好的\n<followups> “1. 再做一版 9:16 的” | 再做一版 9:16 的 |  </followups>\n", "好的", []string{"再做一版 9:16 的"}},
		{"only at the end", "用 <followups> 标签不算</followups> 后面还有正文", "用 <followups> 标签不算</followups> 后面还有正文", nil},
		{"too long is dropped", "好的\n<followups>" + strings.Repeat("长", 50) + "｜短一点？</followups>", "好的", []string{"短一点？"}},
		{"at most three", "好的\n<followups>一？｜二？｜三？｜四？</followups>", "好的", []string{"一？", "二？", "三？"}},
		{"unfinished tag is hidden", "好的\n<followups>帮我出", "好的", nil},
		{"half-typed tag is hidden", "好的\n<follo", "好的", nil},
	}
	for _, tc := range cases {
		text, items := splitAssistantFollowUps(tc.in)
		if text != tc.text || !reflect.DeepEqual(items, tc.items) {
			t.Errorf("%s: got (%q, %q), want (%q, %q)", tc.name, text, items, tc.text, tc.items)
		}
	}
}

func TestAssistantHideFollowUpsTailWhileStreaming(t *testing.T) {
	for in, want := range map[string]string{
		"正文\n<":             "正文",
		"正文\n<fo":           "正文",
		"正文\n<followups>帮我": "正文",
		"正文\n<next>帮我":      "正文",
		"a < b 是对的":         "a < b 是对的",
		"正文没有标签":            "正文没有标签",
	} {
		if got := assistantHideFollowUpsTail(in); got != want {
			t.Errorf("hide(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAssistantFollowUpsInstructionByMode(t *testing.T) {
	if chat := assistantFollowUpsInstructionFor(true); !strings.Contains(chat, "问答模式") || strings.Contains(chat, "帮我按第 1 个方向出图") {
		t.Fatalf("问答 mode must ask for questions only: %s", chat)
	}
	if agent := assistantFollowUpsInstructionFor(false); strings.Contains(agent, "本轮是问答模式") {
		t.Fatalf("agent mode must allow actions: %s", agent)
	}
}
