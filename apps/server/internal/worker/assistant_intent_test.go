package worker

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestFallbackAssistantIntent(t *testing.T) {
	cases := []struct {
		name                  string
		prompt                string
		hasReference          bool
		lastAssistantWasImage bool
		want                  string
	}{
		{"全新生图请求", "帮我画一张赛博朋克风格的海报", false, false, "image"},
		{"纯聊天", "今天天气怎么样", false, false, "chat"},
		{"带参考图的识别问题", "识别一下图片里的文字", true, false, "chat"},
		{"生图后的描述请求仍走对话", "帮我描述一下这张图", false, true, "chat"},
		{"生图后的翻译请求仍走对话", "帮我翻译图上的英文", false, true, "chat"},
		{"生图后的是什么提问仍走对话", "这是什么风格", false, true, "chat"},
		{"生图后再来一张", "再来一张", false, true, "image"},
		{"生图后换颜色", "换成蓝色的", false, true, "image"},
		{"生图后改背景", "背景改成星空", false, true, "image"},
		{"生图后指定某张调整", "第二张放大一点", false, true, "image"},
		{"生图后要求更亮", "更亮一点", false, true, "image"},
		{"生图后英文延续指令", "another one please", false, true, "image"},
		{"无生图上下文时短指令不误判", "再来一张", false, false, "chat"},
		{"生图后过长的修改描述不触发短指令规则", "请把刚才那个方案的整体色调换成更温暖的感觉并且详细说明一下为什么这样调整会更好一些吧", false, true, "chat"},
		{"带参考图的修改指令", "帮我去背景", true, false, "image"},
		{"生图后的寒暄", "真好看", false, true, "chat"},
		{"生图后的致谢", "谢谢", false, true, "chat"},
		{"带参考图但只是提问", "这张照片拍得怎么样", true, false, "chat"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := fallbackAssistantIntent(tc.prompt, tc.hasReference, tc.lastAssistantWasImage)
			if got != tc.want {
				t.Fatalf("fallbackAssistantIntent(%q, ref=%v, lastImg=%v) = %q, want %q",
					tc.prompt, tc.hasReference, tc.lastAssistantWasImage, got, tc.want)
			}
		})
	}
}

func TestParseAssistantIntentReply(t *testing.T) {
	cases := []struct {
		name  string
		reply string
		want  string
	}{
		{"标准IMAGE", "IMAGE", "image"},
		{"标准CHAT", "CHAT", "chat"},
		{"小写回复", "image", "image"},
		{"带标点", "CHAT。", "chat"},
		{"中文前缀", "答案是IMAGE", "image"},
		{"混合先CHAT", "CHAT or IMAGE", "chat"},
		{"混合先IMAGE", "IMAGE, not CHAT", "image"},
		{"粘连单词不算", "IMAGES", ""},
		{"无关内容", "无法判断用户意图", ""},
		{"空回复", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseAssistantIntentReply(tc.reply)
			if got != tc.want {
				t.Fatalf("parseAssistantIntentReply(%q) = %q, want %q", tc.reply, got, tc.want)
			}
		})
	}
}

func intentTestMessage(role, content, kind, status string, metadata map[string]any) *store.AssistantMessage {
	if metadata == nil {
		metadata = map[string]any{}
	}
	return &store.AssistantMessage{
		ID: uuid.New(), Role: role, Content: content, Kind: kind, Status: status, Metadata: metadata,
	}
}

func TestBuildAssistantIntentTranscript(t *testing.T) {
	t.Run("排除当前运行的消息并附加本轮输入", func(t *testing.T) {
		userMsg := intentTestMessage("user", "再来一张", "chat", "complete", nil)
		placeholder := intentTestMessage("assistant", "", "chat", "running", nil)
		history := []*store.AssistantMessage{
			intentTestMessage("user", "画一只猫", "chat", "complete", nil),
			intentTestMessage("assistant", "图片已生成", "image", "complete", map[string]any{
				"prompt": "画一只猫",
				"images": []any{map[string]any{"revisedPrompt": "a cat"}, map[string]any{"revisedPrompt": "a cat 2"}},
			}),
			userMsg,
			placeholder,
		}
		got := buildAssistantIntentTranscript(history, userMsg.ID, placeholder.ID, "再来一张")
		lines := strings.Split(got, "\n")
		if len(lines) != 3 {
			t.Fatalf("expected 3 lines, got %d: %q", len(lines), got)
		}
		if lines[0] != "用户：画一只猫" {
			t.Fatalf("unexpected first line: %q", lines[0])
		}
		if lines[1] != "助手：[生成了 2 张图片：画一只猫]" {
			t.Fatalf("unexpected image summary line: %q", lines[1])
		}
		if lines[2] != "用户：再来一张" {
			t.Fatalf("unexpected final line: %q", lines[2])
		}
	})

	t.Run("已停止的图片消息按普通文本渲染", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("user", "画一只猫", "chat", "complete", nil),
			intentTestMessage("assistant", "已停止生成", "image", "stopped", nil),
		}
		got := buildAssistantIntentTranscript(history, uuid.New(), uuid.New(), "再来一张")
		want := "用户：画一只猫\n助手：已停止生成\n用户：再来一张"
		if got != want {
			t.Fatalf("transcript = %q, want %q", got, want)
		}
	})

	t.Run("跳过空消息和失败消息", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "", "chat", "complete", nil),
			intentTestMessage("assistant", "生成失败", "chat", "failed", nil),
			intentTestMessage("user", "你好", "chat", "complete", nil),
		}
		got := buildAssistantIntentTranscript(history, uuid.New(), uuid.New(), "在吗")
		want := "用户：你好\n用户：在吗"
		if got != want {
			t.Fatalf("transcript = %q, want %q", got, want)
		}
	})

	t.Run("单行超长时按字符截断", func(t *testing.T) {
		long := strings.Repeat("很", 300)
		history := []*store.AssistantMessage{
			intentTestMessage("user", long, "chat", "complete", nil),
		}
		got := buildAssistantIntentTranscript(history, uuid.New(), uuid.New(), "好的")
		lines := strings.Split(got, "\n")
		if runes := len([]rune(lines[0])); runes != assistantIntentLineRunes {
			t.Fatalf("first line rune length = %d, want %d", runes, assistantIntentLineRunes)
		}
		if !strings.HasSuffix(lines[0], "…") {
			t.Fatalf("truncated line should end with ellipsis: %q", lines[0])
		}
	})

	t.Run("图片提示词摘要截断到80字符", func(t *testing.T) {
		longPrompt := strings.Repeat("星", 200)
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "图片已生成", "image", "complete", map[string]any{
				"prompt": longPrompt,
				"images": []any{map[string]any{"revisedPrompt": "x"}},
			}),
		}
		got := buildAssistantIntentTranscript(history, uuid.New(), uuid.New(), "换个颜色")
		lines := strings.Split(got, "\n")
		if !strings.Contains(lines[0], "[生成了 1 张图片：") {
			t.Fatalf("expected image summary, got %q", lines[0])
		}
		summary := strings.TrimSuffix(strings.SplitN(lines[0], "：", 3)[2], "]")
		if runes := len([]rune(summary)); runes != assistantIntentSummaryRunes {
			t.Fatalf("summary rune length = %d, want %d", runes, assistantIntentSummaryRunes)
		}
	})

	t.Run("只保留最近8条历史", func(t *testing.T) {
		history := make([]*store.AssistantMessage, 0, 12)
		for index := 0; index < 12; index++ {
			history = append(history, intentTestMessage("user", fmt.Sprintf("消息%d", index), "chat", "complete", nil))
		}
		got := buildAssistantIntentTranscript(history, uuid.New(), uuid.New(), "最新问题")
		lines := strings.Split(got, "\n")
		if len(lines) != assistantIntentHistoryTurns+1 {
			t.Fatalf("expected %d lines, got %d", assistantIntentHistoryTurns+1, len(lines))
		}
		if lines[0] != "用户：消息4" {
			t.Fatalf("expected oldest kept line to be 消息4, got %q", lines[0])
		}
		if lines[len(lines)-1] != "用户：最新问题" {
			t.Fatalf("unexpected final line: %q", lines[len(lines)-1])
		}
	})

	t.Run("总长度控制在上限内", func(t *testing.T) {
		long := strings.Repeat("长", 200)
		history := make([]*store.AssistantMessage, 0, 12)
		for index := 0; index < 12; index++ {
			history = append(history, intentTestMessage("user", long, "chat", "complete", nil))
		}
		got := buildAssistantIntentTranscript(history, uuid.New(), uuid.New(), long)
		if runes := len([]rune(got)); runes > assistantIntentMaxRunes {
			t.Fatalf("transcript rune length = %d, exceeds %d", runes, assistantIntentMaxRunes)
		}
	})
}

func TestLastAssistantMessageWasImage(t *testing.T) {
	imageMeta := map[string]any{
		"prompt": "画一只猫",
		"images": []any{map[string]any{"revisedPrompt": "a cat"}},
	}

	t.Run("最近助手消息为图片", func(t *testing.T) {
		userMsg := intentTestMessage("user", "再来一张", "chat", "complete", nil)
		placeholder := intentTestMessage("assistant", "", "chat", "running", nil)
		history := []*store.AssistantMessage{
			intentTestMessage("user", "画一只猫", "chat", "complete", nil),
			intentTestMessage("assistant", "图片已生成", "image", "complete", imageMeta),
			userMsg,
			placeholder,
		}
		if !lastAssistantMessageWasImage(history, userMsg.ID, placeholder.ID) {
			t.Fatal("expected true when last assistant message generated images")
		}
	})

	t.Run("最近助手消息为文本", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "图片已生成", "image", "complete", imageMeta),
			intentTestMessage("user", "谢谢", "chat", "complete", nil),
			intentTestMessage("assistant", "不客气", "chat", "complete", nil),
		}
		if lastAssistantMessageWasImage(history, uuid.New(), uuid.New()) {
			t.Fatal("expected false when last assistant message is plain text")
		}
	})

	t.Run("空历史", func(t *testing.T) {
		if lastAssistantMessageWasImage(nil, uuid.New(), uuid.New()) {
			t.Fatal("expected false for empty history")
		}
	})

	t.Run("跳过失败的助手消息", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "图片已生成", "image", "complete", imageMeta),
			intentTestMessage("assistant", "生成失败", "chat", "failed", nil),
		}
		if !lastAssistantMessageWasImage(history, uuid.New(), uuid.New()) {
			t.Fatal("expected failed assistant message to be skipped")
		}
	})

	t.Run("排队中的图片占位消息不算已生成", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "", "image", "queued", nil),
		}
		if lastAssistantMessageWasImage(history, uuid.New(), uuid.New()) {
			t.Fatal("expected queued image placeholder to not count as generated image")
		}
	})

	t.Run("已停止的图片消息不算已生成", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "已停止生成", "image", "stopped", nil),
		}
		if lastAssistantMessageWasImage(history, uuid.New(), uuid.New()) {
			t.Fatal("expected stopped image message to not count as generated image")
		}
	})

	t.Run("完成但缺少images元数据的图片消息仍算已生成", func(t *testing.T) {
		history := []*store.AssistantMessage{
			intentTestMessage("assistant", "图片已生成", "image", "complete", nil),
		}
		if !lastAssistantMessageWasImage(history, uuid.New(), uuid.New()) {
			t.Fatal("expected complete image-kind message without metadata to count")
		}
	})
}
