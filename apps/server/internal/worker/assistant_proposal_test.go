package worker

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
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
	if !strings.Contains(instructions, "web_search") || !strings.Contains(instructions, "实时信息") || !strings.Contains(instructions, "真实错误") {
		t.Fatalf("instructions lack controlled web search rules = %q", instructions)
	}
	if !strings.Contains(instructions, "task_status") || !strings.Contains(instructions, "退款") || !strings.Contains(instructions, "内部任务 ID") {
		t.Fatalf("instructions lack private task status rules = %q", instructions)
	}
	for _, requirement := range []string{"通用执行 Agent", "全部子目标", "同一轮持续推进", "修正后重试", "最终回答前逐项检查"} {
		if !strings.Contains(instructions, requirement) {
			t.Fatalf("instructions lack orchestration requirement %q: %q", requirement, instructions)
		}
	}
}

func TestAttachAssistantWebSearchesSkipsEmptyAndKeepsSources(t *testing.T) {
	metadata := map[string]any{}
	attachAssistantWebSearches(metadata, nil)
	if _, exists := metadata["webSearches"]; exists {
		t.Fatalf("empty searches must not be stored: %#v", metadata)
	}
	searches := []sub2api.WebSearchResult{{
		Query: "latest", Text: "answer", Sources: []sub2api.WebSearchSource{{Title: "Example", URL: "https://example.com/latest"}},
	}}
	attachAssistantWebSearches(metadata, searches)
	stored, ok := metadata["webSearches"].([]sub2api.WebSearchResult)
	if !ok || len(stored) != 1 || len(stored[0].Sources) != 1 {
		t.Fatalf("stored searches = %#v", metadata["webSearches"])
	}
}

func TestAssistantPromptRequestsWebSearch(t *testing.T) {
	tests := []struct {
		prompt string
		want   bool
	}{
		{prompt: "联网搜索最近的海报趋势，再帮我生成一张图", want: true},
		{prompt: "search the web for current logo trends and create a poster", want: true},
		{prompt: "生成一张极简天气图标", want: false},
		{prompt: "查一下参考图中的文字并重新排版", want: false},
	}
	for _, test := range tests {
		if got := assistantPromptRequestsWebSearch(test.prompt); got != test.want {
			t.Fatalf("assistantPromptRequestsWebSearch(%q) = %v, want %v", test.prompt, got, test.want)
		}
	}
}

func TestAssistantExecutionModeRoutesExplicitSearchThroughAgent(t *testing.T) {
	tests := []struct {
		mode   string
		prompt string
		want   string
	}{
		{mode: "chat", prompt: "请联网搜索今天的官方消息", want: "agent"},
		{mode: "chat", prompt: "我的生图任务为什么还在运行中", want: "agent"},
		{mode: "chat", prompt: "解释一下什么是对象存储", want: "chat"},
		{mode: "image", prompt: "你好", want: "chat"},
		{mode: "image", prompt: "生成一张海报", want: "image"},
	}
	for _, test := range tests {
		if got := assistantExecutionMode(test.mode, test.prompt); got != test.want {
			t.Fatalf("assistantExecutionMode(%q, %q) = %q, want %q", test.mode, test.prompt, got, test.want)
		}
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
	implicit := resolveAssistantProposalReferences(nil, catalog, "布局也要改一下，要美观")
	if len(implicit) != 1 || assistantMapString(implicit[0], "id") != "image-b" {
		t.Fatalf("implicit = %#v", implicit)
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

func TestAttachAssistantProposalReferencesRecoversImplicitVisualIteration(t *testing.T) {
	run := &store.AssistantRun{Prompt: "布局也要改一下，要美观", Params: map[string]any{}}
	catalog := []assistantCatalogImage{
		{ID: "old-1", Image: map[string]any{"id": "old-1", "fileKey": "tasks/u/1.png", "dataUrl": "/api/v1/files/tasks/u/1.png"}},
		{ID: "latest", Image: map[string]any{"id": "latest", "fileKey": "tasks/u/2.png", "dataUrl": "/api/v1/files/tasks/u/2.png"}},
	}
	got := attachAssistantProposalReferences(assistantImageProposal{Action: "edit"}, run, catalog, nil)
	if len(got.ReferenceImages) != 1 || assistantMapString(got.ReferenceImages[0], "id") != "latest" {
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
		{name: "implicit layout iteration", prompt: "布局也要改一下，要美观", action: "edit", want: true},
		{name: "standalone continuation", prompt: "继续调整", action: "edit", want: true},
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

func TestAssistantProposalFunctionToolIncludesPromptModesAndImageItems(t *testing.T) {
	tool := assistantProposalFunctionTool(nil)
	properties := tool.Parameters["properties"].(map[string]any)
	for _, key := range []string{"promptMode", "faithfulPrompt", "enhancedPrompt", "items"} {
		if _, ok := properties[key]; !ok {
			t.Fatalf("proposal schema missing %q: %#v", key, properties)
		}
	}
	required := tool.Parameters["required"].([]string)
	for _, key := range []string{"promptMode", "faithfulPrompt", "enhancedPrompt", "items"} {
		if !slices.Contains(required, key) {
			t.Fatalf("proposal schema must require %q: %#v", key, required)
		}
	}
	items := properties["items"].(map[string]any)
	itemSchema := items["items"].(map[string]any)
	itemProperties := itemSchema["properties"].(map[string]any)
	for _, key := range []string{"title", "prompt", "referencedImageIds"} {
		if _, ok := itemProperties[key]; !ok {
			t.Fatalf("image plan item schema missing %q: %#v", key, itemProperties)
		}
	}
}

func TestAssistantHistoricalVisionCatalogSelectsNumberedImageAndRespectsLimit(t *testing.T) {
	catalog := []assistantCatalogImage{
		{ID: "image-1"}, {ID: "image-2"}, {ID: "image-3"}, {ID: "image-4"},
	}
	selected := assistantHistoricalVisionCatalog("修改图2的背景", catalog, 0)
	if len(selected) != 1 || selected[0].ID != "image-2" {
		t.Fatalf("numbered selection = %#v", selected)
	}
	limited := assistantHistoricalVisionCatalog("参考图1、图2和图3生成新版本", catalog, 2)
	if len(limited) != 2 || limited[0].ID != "image-1" || limited[1].ID != "image-2" {
		t.Fatalf("limited selection = %#v", limited)
	}
	if got := assistantHistoricalVisionCatalog("生成一张全新的海报", catalog, 0); len(got) != 0 {
		t.Fatalf("fresh request loaded historical pixels: %#v", got)
	}
	iteration := assistantHistoricalVisionCatalog("不太满意，再更新一版", catalog, 0)
	if len(iteration) != 1 || iteration[0].ID != "image-4" {
		t.Fatalf("feedback iteration = %#v, want latest image", iteration)
	}
}

func TestAttachAssistantProposalReferencesRecoversLatestForEllipticalEdit(t *testing.T) {
	run := &store.AssistantRun{Prompt: "换个感觉", Params: map[string]any{}}
	catalog := []assistantCatalogImage{
		{ID: "older", Image: map[string]any{"id": "older", "fileKey": "tasks/u/older.png"}},
		{ID: "latest", Image: map[string]any{"id": "latest", "fileKey": "tasks/u/latest.png"}},
	}
	proposal := attachAssistantProposalReferences(assistantImageProposal{
		Action: "edit", Prompt: "换个感觉",
	}, run, catalog, nil)
	if len(proposal.ReferenceImages) != 1 || assistantMapString(proposal.ReferenceImages[0], "id") != "latest" {
		t.Fatalf("proposal references = %#v, want latest image", proposal.ReferenceImages)
	}
	if !slices.Equal(proposal.ReferencedImageIDs, []string{"latest"}) {
		t.Fatalf("referenced image IDs = %#v", proposal.ReferencedImageIDs)
	}
}

func TestAssistantDefaultPromptMode(t *testing.T) {
	tests := []struct {
		name   string
		run    *store.AssistantRun
		action string
		want   string
	}{
		{name: "new vague image", run: &store.AssistantRun{Prompt: "生成一张未来城市海报", Params: map[string]any{}}, action: "generate", want: assistantPromptModeEnhanced},
		{name: "current reference", run: &store.AssistantRun{Prompt: "做成海报", Params: map[string]any{"referenceImages": []any{map[string]any{"id": "ref-1"}}}}, action: "edit", want: assistantPromptModeFaithful},
		{name: "historical reference", run: &store.AssistantRun{Prompt: "修改图2的背景", Params: map[string]any{}}, action: "edit", want: assistantPromptModeFaithful},
		{name: "exact wording", run: &store.AssistantRun{Prompt: "提示词一模一样，不要改", Params: map[string]any{}}, action: "generate", want: assistantPromptModeFaithful},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := assistantDefaultPromptMode(test.run, test.action); got != test.want {
				t.Fatalf("assistantDefaultPromptMode() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNormalizeAssistantImagePlanItemsAssignsStableIDsAndCount(t *testing.T) {
	items := normalizeAssistantImagePlanItems([]assistantImagePlanItem{
		{Title: " 主图 ", Prompt: " 主图提示词 ", ReferencedImageIDs: []string{"ref-1", "ref-1"}},
		{Title: "", Prompt: "场景图提示词", ReferencedImageIDs: []string{"ref-2"}},
		{Title: "细节图", Prompt: "细节图提示词"},
	}, 2, "备用提示词")
	if len(items) != 2 || items[0].ID != "item-1" || items[1].ID != "item-2" {
		t.Fatalf("normalized items = %#v", items)
	}
	if items[0].Title != "主图" || items[1].Title != "图片 2" || !slices.Equal(items[0].ReferencedImageIDs, []string{"ref-1"}) {
		t.Fatalf("normalized item content = %#v", items)
	}
}

func TestAttachAssistantProposalReferencesMapsEachPlanItem(t *testing.T) {
	run := &store.AssistantRun{Prompt: "参考图1和图2制作主图与细节图", Params: map[string]any{}}
	catalog := []assistantCatalogImage{
		{ID: "ref-1", Image: map[string]any{"id": "ref-1", "fileKey": "tasks/u/1.png"}},
		{ID: "ref-2", Image: map[string]any{"id": "ref-2", "fileKey": "tasks/u/2.png"}},
	}
	proposal := attachAssistantProposalReferences(assistantImageProposal{
		Action: "edit", Count: 2, Items: []assistantImagePlanItem{
			{ID: "item-1", Title: "主图", Prompt: "主图提示词", ReferencedImageIDs: []string{"ref-1"}},
			{ID: "item-2", Title: "细节图", Prompt: "细节提示词", ReferencedImageIDs: []string{"ref-2"}},
		},
	}, run, catalog, nil)
	if len(proposal.ReferenceImages) != 2 || len(proposal.Items) != 2 {
		t.Fatalf("mapped proposal = %#v", proposal)
	}
	if len(proposal.Items[0].ReferenceImages) != 1 || assistantMapString(proposal.Items[0].ReferenceImages[0], "id") != "ref-1" {
		t.Fatalf("first item mapping = %#v", proposal.Items[0])
	}
	if len(proposal.Items[1].ReferenceImages) != 1 || assistantMapString(proposal.Items[1].ReferenceImages[0], "id") != "ref-2" {
		t.Fatalf("second item mapping = %#v", proposal.Items[1])
	}
}

func TestAssistantImageExecutionPlanUsesIndependentPromptsAndReferences(t *testing.T) {
	plan, err := assistantImageExecutionPlan(map[string]any{
		"referenceImages": []map[string]any{
			{"id": "ref-1", "fileKey": "tasks/u/1.png"},
			{"id": "ref-2", "fileKey": "tasks/u/2.png"},
		},
		"imagePlanItems": []map[string]any{
			{"title": "主图", "prompt": "主图提示词", "referenceImageIds": []string{"ref-2"}},
			{"title": "细节图", "prompt": "细节图提示词", "referenceImageIds": []string{"ref-1", "ref-2"}},
		},
	})
	if err != nil {
		t.Fatalf("execution plan: %v", err)
	}
	if len(plan) != 2 || plan[0].Prompt != "主图提示词" || !slices.Equal(plan[0].ReferenceIndexes, []int{1}) {
		t.Fatalf("first execution item = %#v", plan)
	}
	if plan[1].Prompt != "细节图提示词" || !slices.Equal(plan[1].ReferenceIndexes, []int{0, 1}) {
		t.Fatalf("second execution item = %#v", plan)
	}
}

func TestAssistantProposalGoalContractCapturesAcceptanceFacts(t *testing.T) {
	run := &store.AssistantRun{Prompt: "联网查一下趋势，导出 CSV，再严格按图1制作主图和细节图"}
	proposal := assistantImageProposal{
		Action: "edit", PromptMode: assistantPromptModeFaithful, Prompt: "原提示词", FaithfulPrompt: "原提示词",
		Count: 2, ReferenceImages: []map[string]any{{"id": "ref-1"}}, InspectedImageIDs: []string{"history-1"},
		Items: []assistantImagePlanItem{
			{Title: "主图", Prompt: "主图提示词", ReferencedImageIDs: []string{"ref-1"}},
			{Title: "细节图", Prompt: "细节图提示词", ReferencedImageIDs: []string{"ref-1"}},
		},
	}
	contract := assistantProposalGoalContract(run, proposal, 1, 1)
	if contract.OutcomeKind != "image_proposal" || contract.DeliverableCount != 2 || len(contract.Deliverables) != 2 {
		t.Fatalf("goal contract = %#v", contract)
	}
	if !contract.FaithfulPreserved || contract.ReferencedImageCount != 1 || contract.InspectedImageCount != 1 || contract.WebSearchCount != 1 || !contract.ArtifactRequested || contract.ArtifactCount != 1 {
		t.Fatalf("goal acceptance facts = %#v", contract)
	}
}

func TestAssistantToolArgumentsAlwaysProducesValidJSON(t *testing.T) {
	if got := assistantToolArguments(`{"query":"最新趋势"}`); !json.Valid(got) || !strings.Contains(string(got), "最新趋势") {
		t.Fatalf("valid arguments = %s", got)
	}
	if got := assistantToolArguments("not-json"); !json.Valid(got) || !strings.Contains(string(got), "not-json") {
		t.Fatalf("wrapped arguments = %s", got)
	}
	oversized := `{"prompt":"` + strings.Repeat("x", 17_000) + `"}`
	if got := assistantToolArguments(oversized); !json.Valid(got) || len(got) > 5_000 {
		t.Fatalf("oversized arguments were not compacted: %d bytes", len(got))
	}
}
