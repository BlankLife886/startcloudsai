package worker

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
)

func TestAssistantForcedWorkspaceTool(t *testing.T) {
	tests := map[string]string{
		"帮我找一些咖啡机参考图":  assistanttools.ToolImageSearch,
		"把这个公开网站截图给我":  assistanttools.ToolWebpageCapture,
		"导入商品链接到电商":    assistanttools.ToolProductImport,
		"把这次结果打包交付":    assistanttools.ToolDeliveryExport,
		"把参考图复刻成一个工作流": assistanttools.ToolReferenceRebuild,
		"发送到无限画布继续做":   assistanttools.ToolSendToWorkspace,
		"把这张图高清放大":     assistanttools.ToolMediaAction,
	}
	for prompt, want := range tests {
		if got := assistantForcedWorkspaceTool(prompt); got != want {
			t.Errorf("assistantForcedWorkspaceTool(%q) = %q, want %q", prompt, got, want)
		}
	}
	if got := assistantForcedWorkspaceTool("你好，介绍一下你自己"); got != "" {
		t.Fatalf("ordinary chat forced tool = %q", got)
	}
	if got := assistantForcedWorkspaceTool("解释网页截图工具的实现原理"); got != "" {
		t.Fatalf("tool explanation forced tool = %q", got)
	}
}
