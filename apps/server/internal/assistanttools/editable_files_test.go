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
