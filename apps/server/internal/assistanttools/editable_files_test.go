package assistanttools

import "testing"

func TestEditableFileKindRequested(t *testing.T) {
	tests := []struct {
		prompt string
		want   string
	}{
		{"制作一份产品发布会 PPT", "ppt"},
		{"Create a PowerPoint presentation", "ppt"},
		{"把这张海报转换成 PSD", "psd"},
		{"PPT 是什么？", ""},
		{"PSD 可以编辑吗？", ""},
	}
	for _, test := range tests {
		if got := EditableFileKindRequested(test.prompt); got != test.want {
			t.Errorf("EditableFileKindRequested(%q) = %q, want %q", test.prompt, got, test.want)
		}
	}
}

func TestDedicatedEditableFileKindRequested(t *testing.T) {
	tests := []struct {
		name           string
		prompt         string
		hasAttachments bool
		want           string
	}{
		{name: "pure ppt", prompt: "制作一份产品发布会 PPT", want: "ppt"},
		{name: "web search ppt", prompt: "联网搜索最新资料并生成可编辑 PPT", want: ""},
		{name: "task status ppt", prompt: "查询最近任务状态并生成 PPT", want: ""},
		{name: "workspace tool ppt", prompt: "截取网页并生成 PPT", want: ""},
		{name: "attached document ppt", prompt: "根据附件制作 PPT", hasAttachments: true, want: ""},
		{name: "pure psd", prompt: "把这张图片转换为 PSD", want: "psd"},
		{name: "image action psd", prompt: "把这张图片生成 PSD", want: "psd"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := DedicatedEditableFileKindRequested(test.prompt, test.hasAttachments); got != test.want {
				t.Fatalf("DedicatedEditableFileKindRequested(%q, %t) = %q, want %q", test.prompt, test.hasAttachments, got, test.want)
			}
		})
	}
}
