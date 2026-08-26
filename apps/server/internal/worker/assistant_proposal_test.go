package worker

import (
	"slices"
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
	tool := assistantProposalFunctionTool(nil)
	properties, _ := tool.Parameters["properties"].(map[string]any)
	count, _ := properties["count"].(map[string]any)
	if tool.Name != "propose_image_action" || count["minimum"] != 1 || count["maximum"] != 4 {
		t.Fatalf("tool = %#v", tool)
	}
	if _, exists := tool.Parameters["n"]; exists {
		t.Fatalf("n must not be a top-level tool parameter: %#v", tool.Parameters)
	}
	referenceMode, ok := properties["referenceMode"].(map[string]any)
	if !ok || len(referenceMode["enum"].([]string)) != 2 {
		t.Fatalf("referenceMode schema = %#v", properties["referenceMode"])
	}
	required, _ := tool.Parameters["required"].([]string)
	if !slices.Contains(required, "referenceMode") {
		t.Fatalf("referenceMode must be required: %#v", required)
	}
}

func TestAssistantProposalFunctionToolOmitsUnsupportedModelParameters(t *testing.T) {
	models := []map[string]any{{
		"id": "schema-only", "aspectRatios": []any{"auto", "16:9"},
		"resolutions": []any{}, "qualities": []any{}, "maxImages": float64(2),
	}}
	tool := assistantProposalFunctionTool(models)
	properties, _ := tool.Parameters["properties"].(map[string]any)
	if _, exists := properties["resolution"]; exists {
		t.Fatalf("unsupported resolution leaked into tool schema: %#v", properties)
	}
	if _, exists := properties["quality"]; exists {
		t.Fatalf("unsupported quality leaked into tool schema: %#v", properties)
	}
	if ratio, ok := properties["ratio"].(map[string]any); !ok || len(ratio["enum"].([]string)) != 2 {
		t.Fatalf("ratio schema = %#v", properties["ratio"])
	}
	count := properties["count"].(map[string]any)
	if count["maximum"] != 2 {
		t.Fatalf("count schema = %#v", count)
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
	if !strings.Contains(instructions, "referenceMode=individual") || !strings.Contains(instructions, "一一对应") {
		t.Fatalf("instructions lack reference mapping rules = %q", instructions)
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

func TestNormalizeAssistantProposalPreservesStructuredReferenceMode(t *testing.T) {
	run := &store.AssistantRun{Prompt: "分别编辑四张图", Params: map[string]any{"count": float64(4)}}
	individual := normalizeAssistantProposal(assistantImageProposal{
		Action: "edit", Prompt: "分别编辑图1、图2、图3、图4", Count: 4, ReferenceMode: assistantReferenceModeIndividual,
	}, run)
	if individual.ReferenceMode != assistantReferenceModeIndividual {
		t.Fatalf("individual reference mode = %q", individual.ReferenceMode)
	}
	shared := normalizeAssistantProposal(assistantImageProposal{
		Action: "generate", Prompt: "融合多张参考图", Count: 4, ReferenceMode: assistantReferenceModeIndividual,
	}, run)
	if shared.ReferenceMode != assistantReferenceModeShared {
		t.Fatalf("fresh generation reference mode = %q", shared.ReferenceMode)
	}
}

func TestNormalizeAssistantProposalClearsUnsupportedConfiguredParameters(t *testing.T) {
	run := &store.AssistantRun{Prompt: "生成海报", Params: map[string]any{
		"ratio": "1:1", "resolution": "1K", "count": float64(1), "quality": "high",
		"requestSize": "1024x1024", "width": float64(1024), "height": float64(1024),
		"_imageModelConfigId": "schema-only",
	}}
	models := []map[string]any{{
		"id": "schema-only", "name": "Schema 模型", "aspectRatios": []any{"auto", "16:9"},
		"resolutions": []any{}, "qualities": []any{}, "maxImages": float64(2),
	}}
	proposal := normalizeAssistantProposalWithModels(assistantImageProposal{
		Action: "generate", Prompt: "电影海报", Model: "schema-only", Ratio: "1:1",
		Resolution: "4K", Quality: "high", Count: 1,
	}, run, models)
	if proposal.Ratio != "auto" || proposal.Resolution != "" || proposal.Quality != "" {
		t.Fatalf("proposal capabilities = %#v", proposal)
	}
	if proposal.RequestSize != "" || proposal.Width != 0 || proposal.Height != 0 {
		t.Fatalf("unsupported size leaked into proposal = %#v", proposal)
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

func TestAttachAssistantProposalReferencesKeepsOnlyUserUploads(t *testing.T) {
	run := &store.AssistantRun{Params: map[string]any{
		"referenceImages": []any{
			map[string]any{"id": "user-ref", "fileKey": "uploads/u/a.png", "dataUrl": "/api/v1/files/uploads/u/a.png"},
		},
	}}
	catalog := []assistantCatalogImage{
		{ID: "user-ref", Image: map[string]any{"id": "user-ref", "fileKey": "uploads/u/a.png"}},
		{ID: "old-1", Image: map[string]any{"id": "old-1", "fileKey": "tasks/u/1.png", "dataUrl": "/api/v1/files/tasks/u/1.png"}},
	}
	got := attachAssistantProposalReferences(assistantImageProposal{ReferencedImageIDs: []string{"user-ref", "old-1"}}, run, catalog, nil)
	if len(got.ReferenceImages) != 1 || assistantMapString(got.ReferenceImages[0], "id") != "user-ref" {
		t.Fatalf("refs = %#v", got.ReferenceImages)
	}
}

func TestAttachAssistantProposalReferencesAlignsIndividualOutputCount(t *testing.T) {
	run := &store.AssistantRun{Params: map[string]any{
		"referenceImages": []any{
			map[string]any{"id": "ref-1", "fileKey": "uploads/u/1.png"},
			map[string]any{"id": "ref-2", "fileKey": "uploads/u/2.png"},
			map[string]any{"id": "ref-3", "fileKey": "uploads/u/3.png"},
			map[string]any{"id": "ref-4", "fileKey": "uploads/u/4.png"},
		},
	}}
	models := []map[string]any{{"id": "image-model", "maxImages": float64(4), "maxReferenceImages": float64(4)}}
	got := attachAssistantProposalReferences(assistantImageProposal{
		Action: "edit", Model: "image-model", Count: 1, ReferenceMode: assistantReferenceModeIndividual,
	}, run, nil, models)
	if got.Count != 4 || len(got.ReferenceImages) != 4 {
		t.Fatalf("individual proposal = %#v", got)
	}
}

func TestAttachAssistantProposalReferencesUsesHistoryWhenUserDidNotAttach(t *testing.T) {
	run := &store.AssistantRun{Prompt: "把上一张的背景换成蓝色", Params: map[string]any{}}
	catalog := []assistantCatalogImage{
		{ID: "old-1", Image: map[string]any{"id": "old-1", "fileKey": "tasks/u/1.png", "dataUrl": "/api/v1/files/tasks/u/1.png"}},
	}
	got := attachAssistantProposalReferences(assistantImageProposal{Action: "edit", ReferencedImageIDs: []string{"old-1"}}, run, catalog, nil)
	if len(got.ReferenceImages) != 1 || assistantMapString(got.ReferenceImages[0], "id") != "old-1" {
		t.Fatalf("refs = %#v", got.ReferenceImages)
	}
}

func TestAttachAssistantProposalReferencesRejectsUnrelatedHistoryForFreshImage(t *testing.T) {
	run := &store.AssistantRun{Prompt: "创建一张蓝天白云图", Params: map[string]any{}}
	catalog := []assistantCatalogImage{
		{ID: "old-1", Image: map[string]any{"id": "old-1", "fileKey": "tasks/u/1.png", "dataUrl": "/api/v1/files/tasks/u/1.png"}},
	}
	got := attachAssistantProposalReferences(assistantImageProposal{Action: "generate", ReferencedImageIDs: []string{"old-1"}}, run, catalog, nil)
	if len(got.ReferenceImages) != 0 || len(got.ReferencedImageIDs) != 0 {
		t.Fatalf("fresh image inherited unrelated refs = %#v", got.ReferenceImages)
	}
}

func TestAssistantPromptAllowsHistoricalReferences(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		action string
		want   bool
	}{
		{name: "previous image", prompt: "沿用之前图片的风格做一张海报", action: "generate", want: true},
		{name: "numbered image", prompt: "参考图2的构图生成一个新版本", action: "generate", want: true},
		{name: "implicit edit", prompt: "把人物头发改成红色", action: "edit", want: true},
		{name: "fresh landscape", prompt: "创建一张蓝天白云图", action: "generate", want: false},
		{name: "fresh logo", prompt: "设计一个全新的 logo", action: "generate", want: false},
		{name: "unrelated edit action", prompt: "把标题改成更简洁的说法", action: "edit", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := assistantPromptAllowsHistoricalReferences(tt.prompt, tt.action); got != tt.want {
				t.Fatalf("assistantPromptAllowsHistoricalReferences(%q, %q) = %v, want %v", tt.prompt, tt.action, got, tt.want)
			}
		})
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
