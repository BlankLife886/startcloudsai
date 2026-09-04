package assistanttools

import "testing"

func TestImageActionRequested(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   bool
	}{
		{name: "poster", prompt: "请帮我设计一张极简品牌海报", want: true},
		{name: "wallpaper", prompt: "画一张星空下的雪山壁纸", want: true},
		{name: "edit referenced image", prompt: "把这张图的背景换成夜景", want: true},
		{name: "negative request", prompt: "不要生成图片，只分析一下构图", want: false},
		{name: "negative then positive", prompt: "不要生成旧方案，生成一张新的海报", want: true},
		{name: "compound inspect and create", prompt: "先分析这张图，然后生成一张产品海报", want: true},
		{name: "technical design", prompt: "帮我设计一个图片数据库表结构", want: false},
		{name: "ordinary analysis", prompt: "分析一下品牌图标为什么好看", want: false},
		{name: "knowledge question", prompt: "如何生成一张海报？", want: false},
		{name: "capability question", prompt: "你会生成图片吗？", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ImageActionRequested(test.prompt); got != test.want {
				t.Fatalf("ImageActionRequested(%q) = %v, want %v", test.prompt, got, test.want)
			}
		})
	}
}

func TestWorkspaceToolForPromptRejectsExplanations(t *testing.T) {
	if got := WorkspaceToolForPrompt("解释一下网页截图工具的实现原理"); got != "" {
		t.Fatalf("explanation forced tool %q", got)
	}
	if got := WorkspaceToolForPrompt("把这个公开网站截图给我"); got != ToolWebpageCapture {
		t.Fatalf("direct command = %q", got)
	}
	if got := WorkspaceToolForPrompt("把这张图高清放大"); got != ToolMediaAction {
		t.Fatalf("media command = %q", got)
	}
}

func TestAgentExecutionRequested(t *testing.T) {
	for _, prompt := range []string{
		"联网搜索最新消息", "查询我的任务进度", "画一张产品海报", "发送到无限画布继续做",
	} {
		if !AgentExecutionRequested(prompt) {
			t.Fatalf("expected agent routing for %q", prompt)
		}
	}
	for _, prompt := range []string{"你好", "解释对象存储", "设计一个图片数据库表结构"} {
		if AgentExecutionRequested(prompt) {
			t.Fatalf("unexpected agent routing for %q", prompt)
		}
	}
}
