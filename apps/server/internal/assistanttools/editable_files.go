package assistanttools

import "strings"

// EditableFileKindRequested recognizes explicit creation commands only, so a
// question about PPT/PSD remains a normal chat request.
func EditableFileKindRequested(prompt string) string {
	if ImageToPSDRequested(prompt) {
		return "psd"
	}
	value := strings.ToLower(strings.TrimSpace(prompt))
	if value == "" {
		return ""
	}
	verbs := []string{
		"生成", "创建", "制作", "做一份", "做个", "导出", "输出", "整理成", "保存为",
		"create", "make", "generate", "export", "build", "prepare",
	}
	nouns := []string{"ppt", "pptx", "powerpoint", "演示文稿", "幻灯片", "slide deck", "presentation"}
	for _, verb := range verbs {
		if !strings.Contains(value, verb) {
			continue
		}
		for _, noun := range nouns {
			if strings.Contains(value, noun) {
				return "ppt"
			}
		}
	}
	return ""
}

// DedicatedEditableFileKindRequested returns a kind only when the specialized
// editable-file provider should own the whole request. Tool-assisted PPT
// workflows stay with the general assistant so their evidence can flow into
// files_create. PSD remains specialized because files_create cannot produce it.
func DedicatedEditableFileKindRequested(prompt string, hasDocumentAttachments bool) string {
	kind := EditableFileKindRequested(prompt)
	if kind == "" || hasDocumentAttachments {
		return ""
	}
	if kind == "ppt" && AgentExecutionRequested(prompt) {
		return ""
	}
	return kind
}
