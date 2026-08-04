package worker

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestParseAssistantProposalAcceptsWrappedJSON(t *testing.T) {
	proposal, err := parseAssistantProposal("```json\n{\"action\":\"edit\",\"prompt\":\"参考图1，调整背景\",\"reason\":\"保留主体\",\"ratio\":\"4:3\",\"resolution\":\"2K\",\"count\":2,\"quality\":\"medium\"}\n```")
	if err != nil {
		t.Fatalf("parse proposal: %v", err)
	}
	if proposal.Action != "edit" || proposal.Prompt != "参考图1，调整背景" || proposal.Count != 2 {
		t.Fatalf("proposal = %#v", proposal)
	}
}

func TestAssistantProposalFunctionToolKeepsCountInsideParameters(t *testing.T) {
	tool := assistantProposalFunctionTool()
	properties, _ := tool.Parameters["properties"].(map[string]any)
	count, _ := properties["count"].(map[string]any)
	if tool.Name != "propose_image_action" || count["minimum"] != 1 || count["maximum"] != 4 {
		t.Fatalf("tool = %#v", tool)
	}
	if _, exists := tool.Parameters["n"]; exists {
		t.Fatalf("n must not be a top-level tool parameter: %#v", tool.Parameters)
	}
}

func TestAssistantAgentInstructionsPreserveRequestedCount(t *testing.T) {
	run := &store.AssistantRun{Params: map[string]any{
		"ratio": "16:9", "resolution": "2K", "count": float64(3), "quality": "high",
		"_imageModelConfigId": "image-model",
	}}
	instructions := assistantAgentInstructions(run, nil, nil)
	if !strings.Contains(instructions, "数量=3") || !strings.Contains(instructions, "图片模型=image-model") {
		t.Fatalf("instructions = %q", instructions)
	}
	if !strings.Contains(instructions, "不支持工具调用") || !strings.Contains(instructions, "JSON 对象") {
		t.Fatalf("instructions lack structured fallback = %q", instructions)
	}
}

func TestBuildAssistantImageCatalogAndResolveSemanticReference(t *testing.T) {
	messageID := uuid.New()
	history := []*store.AssistantMessage{{
		ID: messageID, Role: "assistant", Kind: "image", Status: "complete", Content: "图片已生成",
		Metadata: map[string]any{"prompt": "红色跑车", "images": []any{
			map[string]any{"id": "image-a", "fileKey": "tasks/user/run/1.png", "dataUrl": "/api/v1/files/tasks/user/run/1.png"},
			map[string]any{"id": "image-b", "fileKey": "tasks/user/run/2.png", "dataUrl": "/api/v1/files/tasks/user/run/2.png"},
		}},
	}}
	catalog := buildAssistantImageCatalog(history)
	if len(catalog) != 2 || catalog[1].ID != "image-b" || catalog[0].Description != "红色跑车" {
		t.Fatalf("catalog = %#v", catalog)
	}
	resolved := resolveAssistantProposalReferences(nil, catalog, "把第二张改成夜景")
	if len(resolved) != 1 || assistantMapString(resolved[0], "id") != "image-b" {
		t.Fatalf("resolved = %#v", resolved)
	}
	last := resolveAssistantProposalReferences(nil, catalog, "继续编辑上一张")
	if len(last) != 1 || assistantMapString(last[0], "id") != "image-b" {
		t.Fatalf("last = %#v", last)
	}
}

func TestNormalizeAssistantProposalSelectsValidatedModel(t *testing.T) {
	run := &store.AssistantRun{Prompt: "生成海报", Params: map[string]any{
		"ratio": "1:1", "resolution": "1K", "count": float64(1), "quality": "low",
		"_imageModelConfigId": "default", "_imageModelDisplayName": "默认模型",
	}}
	models := []map[string]any{{
		"id": "quality", "name": "高质量模型", "resolutions": []any{"2K", "4K"},
		"aspectRatios": []any{"16:9"}, "qualities": []any{"high"}, "maxReferenceImages": float64(2),
	}}
	proposal := normalizeAssistantProposalWithModels(assistantImageProposal{
		Action: "generate", Prompt: "电影海报", Model: "quality", Resolution: "1K", Ratio: "1:1", Quality: "low", Count: 1,
	}, run, models)
	if proposal.Model != "quality" || proposal.ModelName != "高质量模型" || proposal.Resolution != "2K" || proposal.Ratio != "16:9" || proposal.Quality != "high" {
		t.Fatalf("proposal = %#v", proposal)
	}
}

func TestAssistantMessagesAfterContextBoundary(t *testing.T) {
	messages := []*store.AssistantMessage{
		{Kind: "chat", Content: "旧问题"},
		{Kind: "context-divider", Metadata: map[string]any{"contextDivider": true}},
		{Kind: "chat", Content: "新问题"},
	}
	trimmed := assistantMessagesAfterContextBoundary(messages)
	if len(trimmed) != 1 || trimmed[0].Content != "新问题" {
		t.Fatalf("trimmed = %#v", trimmed)
	}
}

func TestAssistantProposalPromptFromAgentTextKeepsVisualBrief(t *testing.T) {
	raw := `方案确认：

- **数量**：3 张
- **主题**：极简绿色三角形图标测试图
- **整体风格**：纯净、扁平、极简图标风格
- **画面设定**：
  1. 白色纯背景 + 单个居中绿色实心三角形
  2. 白色纯背景 + 绿色三角形偏中心布局
  3. 白色纯背景 + 绿色三角形轻微变化构图
- **元素限制**：
  - 不添加文字
  - 不添加阴影和纹理

默认参数：
- 比例：auto

等待确认后再开始生成。`
	prompt, ok := assistantProposalPromptFromAgentText(raw)
	if !ok {
		t.Fatal("expected visual brief")
	}
	for _, expected := range []string{"主题：极简绿色三角形", "画面设定：", "不添加文字"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q: %q", expected, prompt)
		}
	}
	for _, excluded := range []string{"数量：", "默认参数", "等待确认"} {
		if strings.Contains(prompt, excluded) {
			t.Fatalf("prompt contains control text %q: %q", excluded, prompt)
		}
	}
}

func TestNormalizeAssistantProposalUsesConfiguredCapabilities(t *testing.T) {
	run := &store.AssistantRun{Prompt: "生成海报", Params: map[string]any{
		"ratio": "1:1", "resolution": "1K", "count": float64(1), "quality": "low",
		"_modelAspectRatios": []any{"1:1", "16:9"},
		"_modelResolutions":  []any{"1K", "2K"},
		"_modelQualities":    []any{"low", "high"},
	}}
	proposal := normalizeAssistantProposal(assistantImageProposal{
		Action: "unknown", Prompt: "  生成未来城市海报  ", Ratio: "3:2",
		Resolution: "4K", Count: 8, Quality: "medium",
	}, run)
	if proposal.Action != "generate" || proposal.Prompt != "生成未来城市海报" {
		t.Fatalf("identity fields = %#v", proposal)
	}
	if proposal.Ratio != "1:1" || proposal.Resolution != "1K" || proposal.Count != 1 || proposal.Quality != "low" {
		t.Fatalf("normalized capabilities = %#v", proposal)
	}
}
