package worker

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func TestAssistantAgentToolCallKeyCanonicalizesJSON(t *testing.T) {
	first := &sub2api.ToolCall{Name: "media_action", Arguments: `{"b":2,"a":1}`}
	second := &sub2api.ToolCall{Name: "media_action", Arguments: " { \n \t\"a\" : 1, \"b\" : 2 } "}
	if got, want := assistantAgentToolCallKey(first), assistantAgentToolCallKey(second); got == "" || got != want {
		t.Fatalf("equivalent tool calls produced different keys: %q != %q", got, want)
	}

	differentArguments := &sub2api.ToolCall{Name: "media_action", Arguments: `{"a":2,"b":2}`}
	differentTool := &sub2api.ToolCall{Name: "delivery_export", Arguments: `{"a":1,"b":2}`}
	baseKey := assistantAgentToolCallKey(first)
	if got := assistantAgentToolCallKey(differentArguments); got == baseKey {
		t.Fatal("different arguments must not share a tool call key")
	}
	if got := assistantAgentToolCallKey(differentTool); got == baseKey {
		t.Fatal("different tool names must not share a tool call key")
	}
	if got := assistantAgentToolCallKey(nil); got != "" {
		t.Fatalf("nil tool call key = %q, want empty", got)
	}
}

func TestAssistantAgentToolObservationTurnsFailureIntoActionableResult(t *testing.T) {
	call := &sub2api.ToolCall{Name: "media_action"}
	observation, err := assistantAgentToolObservation(
		call,
		"",
		errors.New("malformed JSON: missing image_id"),
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"工具 media_action 执行失败", "malformed JSON", "修正工具参数", "不得声称该工具已经成功"} {
		if !strings.Contains(observation, want) {
			t.Fatalf("failure observation %q does not contain %q", observation, want)
		}
	}
}

func TestAssistantAgentSafeToolErrorRedactsAndTruncates(t *testing.T) {
	raw := "request https://internal.example/private failed; api_key=sk-private; " +
		"Authorization: Bearer abcdefghijklmnop; token=top-secret; " + strings.Repeat("x", assistantAgentToolErrorRunes+200)
	got := assistantAgentSafeToolError(errors.New(raw))
	for _, secret := range []string{"internal.example", "sk-private", "abcdefghijklmnop", "top-secret"} {
		if strings.Contains(got, secret) {
			t.Fatalf("sanitized error leaked %q: %q", secret, got)
		}
	}
	if !strings.Contains(got, "[redacted]") {
		t.Fatalf("sanitized error should mark redacted credentials: %q", got)
	}
	if runes := len([]rune(got)); runes != assistantAgentToolErrorRunes {
		t.Fatalf("sanitized error rune length = %d, want %d", runes, assistantAgentToolErrorRunes)
	}
}

func TestAssistantAgentToolObservationPreservesParentCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	observation, err := assistantAgentToolObservation(
		&sub2api.ToolCall{Name: "media_action"},
		"",
		errors.New("tool failed"),
		ctx.Err(),
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if observation != "" {
		t.Fatalf("canceled call returned observation %q", observation)
	}
}

func TestAssistantAgentRepeatedToolObservationReusesPriorResult(t *testing.T) {
	got := assistantAgentRepeatedToolObservation(`{"ok":true}`)
	for _, want := range []string{"没有再次执行", "复用此前结果", `{"ok":true}`} {
		if !strings.Contains(got, want) {
			t.Fatalf("repeated-call observation %q does not contain %q", got, want)
		}
	}
}

func TestAssistantAgentNeedsFinalSynthesis(t *testing.T) {
	const proposalTool = "propose_image_action"
	tests := []struct {
		name      string
		result    sub2api.AgentChatResult
		exhausted bool
		want      bool
	}{
		{name: "normal text", result: sub2api.AgentChatResult{Text: "done"}, want: false},
		{name: "empty response", result: sub2api.AgentChatResult{}, want: true},
		{name: "loop exhausted", result: sub2api.AgentChatResult{Text: "partial"}, exhausted: true, want: true},
		{name: "unresolved tool", result: sub2api.AgentChatResult{ToolCall: &sub2api.ToolCall{Name: "media_action"}}, want: true},
		{name: "proposal tool", result: sub2api.AgentChatResult{ToolCall: &sub2api.ToolCall{Name: proposalTool}}, exhausted: true, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := assistantAgentNeedsFinalSynthesis(test.result, proposalTool, test.exhausted); got != test.want {
				t.Fatalf("assistantAgentNeedsFinalSynthesis() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestAssistantArtifactUsesDedicatedChatOnlyForSimpleRequests(t *testing.T) {
	tests := []struct {
		name   string
		prompt string
		want   bool
	}{
		{name: "simple artifact", prompt: "请把这些内容导出为 CSV 文件", want: true},
		{name: "web and artifact", prompt: "请联网搜索最新资料并导出为 CSV 文件", want: false},
		{name: "task status and artifact", prompt: "查询我的任务状态并导出 JSON 文件", want: false},
		{name: "workspace tool and artifact", prompt: "截取网页并导出 JSON 文件", want: false},
		{name: "not an artifact", prompt: "请联网搜索最新资料", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := assistantArtifactUsesDedicatedChat(test.prompt); got != test.want {
				t.Fatalf("assistantArtifactUsesDedicatedChat(%q) = %v, want %v", test.prompt, got, test.want)
			}
		})
	}
}

func TestAssistantAgentFileToolCatalogAndPermissions(t *testing.T) {
	worker := &Worker{St: &store.Store{}}
	registry, definitions, err := worker.assistantAgentFileToolRegistry(true, true)
	if err != nil {
		t.Fatal(err)
	}
	wantNames := map[string]bool{
		assistanttools.ToolFilesList:   true,
		assistanttools.ToolFilesSearch: true,
		assistanttools.ToolFilesRead:   true,
		assistanttools.ToolFilesCreate: true,
	}
	if len(definitions) != len(wantNames) {
		t.Fatalf("file tool definitions = %#v", definitions)
	}
	for _, definition := range definitions {
		if !wantNames[definition.Name] || !registry.Has(definition.Name) || !definition.Strict {
			t.Fatalf("unexpected or non-strict file tool definition: %#v", definition)
		}
	}

	permissions, err := assistantAgentFileToolPermissions(assistanttools.ToolFilesCreate)
	if err != nil {
		t.Fatal(err)
	}
	if len(permissions) != 1 || !permissions[assistanttools.PermissionFilesWrite] {
		t.Fatalf("files_create permissions = %#v", permissions)
	}
	for _, permission := range []assistanttools.Permission{
		assistanttools.PermissionFilesMetadata,
		assistanttools.PermissionFilesRead,
		assistanttools.PermissionTasksRead,
		assistanttools.PermissionWebRead,
		assistanttools.PermissionActionsCreate,
	} {
		if permissions[permission] {
			t.Fatalf("files_create unexpectedly received permission %s", permission)
		}
	}
}

func TestAssistantAgentFileRequirementsOrderEvidenceBeforeArtifact(t *testing.T) {
	fileIDs := []uuid.UUID{uuid.New()}
	definitions := []sub2api.FunctionTool{
		{Name: "propose_image_action"},
		{Name: assistanttools.ToolFilesSearch},
		{Name: assistanttools.ToolFilesCreate},
	}
	hasTool := func(tools []sub2api.FunctionTool, name string) bool {
		for _, tool := range tools {
			if tool.Name == name {
				return true
			}
		}
		return false
	}
	if !assistantAgentFileRequirementsPending(fileIDs, true, nil, nil) {
		t.Fatal("file requirements should suppress premature visible output and proposals")
	}
	if got := assistantAgentVisibleText("CSV 已生成", false, true); got != "" {
		t.Fatalf("premature visible text = %q", got)
	}
	if got := assistantAgentFileRequirementReminder(fileIDs, true, nil, nil); !strings.Contains(got, "files_search") {
		t.Fatalf("first reminder = %q", got)
	}
	beforeEvidence := assistantAgentToolsForFileRequirements(definitions, "propose_image_action", fileIDs, true, nil, nil)
	if hasTool(beforeEvidence, "propose_image_action") || hasTool(beforeEvidence, assistanttools.ToolFilesCreate) ||
		!hasTool(beforeEvidence, assistanttools.ToolFilesSearch) {
		t.Fatalf("tools before evidence = %#v", beforeEvidence)
	}
	if got := assistantAgentFileRequirementReminder(fileIDs, true, []string{assistanttools.ToolFilesSearch}, nil); !strings.Contains(got, "files_create") {
		t.Fatalf("artifact reminder = %q", got)
	}
	afterEvidence := assistantAgentToolsForFileRequirements(definitions, "propose_image_action", fileIDs, true,
		[]string{assistanttools.ToolFilesSearch}, nil)
	if hasTool(afterEvidence, "propose_image_action") || !hasTool(afterEvidence, assistanttools.ToolFilesCreate) {
		t.Fatalf("tools after evidence = %#v", afterEvidence)
	}
	if got := assistantAgentFileRequirementReminder(fileIDs, true,
		[]string{assistanttools.ToolFilesSearch, assistanttools.ToolFilesCreate}, []map[string]any{{"id": "artifact-1"}}); got != "" {
		t.Fatalf("completed requirements returned reminder %q", got)
	}
	if assistantAgentFileRequirementsPending(fileIDs, true,
		[]string{assistanttools.ToolFilesSearch, assistanttools.ToolFilesCreate}, []map[string]any{{"id": "artifact-1"}}) {
		t.Fatal("completed file requirements should allow visible output and image proposal")
	}
	if got := assistantAgentVisibleText("CSV 已生成", false, false); got != "CSV 已生成" {
		t.Fatalf("completed visible text = %q", got)
	}
	completedTools := assistantAgentToolsForFileRequirements(definitions, "propose_image_action", fileIDs, true,
		[]string{assistanttools.ToolFilesSearch, assistanttools.ToolFilesCreate}, []map[string]any{{"id": "artifact-1"}})
	if !hasTool(completedTools, "propose_image_action") || !hasTool(completedTools, assistanttools.ToolFilesCreate) {
		t.Fatalf("tools after requirements = %#v", completedTools)
	}
}

func TestAttachAssistantArtifactsAddsFinalMessageMetadata(t *testing.T) {
	metadata := map[string]any{"statusStage": "complete"}
	artifacts := []map[string]any{{"id": "artifact-1", "format": "csv"}}
	attachAssistantArtifacts(metadata, artifacts)
	got, ok := metadata["artifacts"].([]map[string]any)
	if !ok || len(got) != 1 || got[0]["id"] != "artifact-1" || metadata["statusStage"] != "complete" {
		t.Fatalf("final metadata = %#v", metadata)
	}
}
