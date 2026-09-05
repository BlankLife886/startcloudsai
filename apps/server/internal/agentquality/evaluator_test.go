package agentquality

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestEvaluateAgentCasesFromRealTraceShape(t *testing.T) {
	checkpoint := "checkpoint-1"
	trace := &store.AgentExecutionTrace{
		ID: uuid.New(), Status: "succeeded", CheckpointID: &checkpoint,
		InitialSnapshot: json.RawMessage(`{"selectedNodeIds":["image-1","image-2"],"nodes":[{"id":"image-1","type":"image"},{"id":"image-2","type":"image"}]}`),
		VisualSummary:   json.RawMessage(`{"referenceImages":[{"id":"a"},{"id":"b"}]}`),
	}
	steps := []*store.AgentToolStep{
		{ToolName: "canvas_get_selection", Status: "succeeded"},
		{ToolName: "canvas_apply_ops", Status: "succeeded", Arguments: json.RawMessage(`{"ops":[{"type":"create_graph"}]}`), Result: json.RawMessage(`{"applied":3,"missing":[],"errors":[]}`)},
		{ToolName: "canvas_validate_workflow", Status: "succeeded", Result: json.RawMessage(`{"valid":true}`)},
		{ToolName: "canvas_apply_ops", Status: "succeeded", RequiresConfirmation: true, Arguments: json.RawMessage(`{"ops":[{"type":"delete_node"}]}`)},
		{ToolName: "canvas_get_state", Status: "failed"},
		{ToolName: "canvas_get_state", Status: "succeeded"},
		{ToolName: "canvas_restore_checkpoint", Status: "succeeded", RequiresConfirmation: true},
	}
	keys := []string{"intent-selected-nodes", "multi-image-pairing", "workflow-from-reference", "safe-batch-delete", "node-rollback", "failed-step-retry", "connection-correctness", "tool-call-completion"}
	cases := make([]store.AgentEvalCase, 0, len(keys))
	for _, key := range keys {
		cases = append(cases, store.AgentEvalCase{ID: uuid.New(), Key: key})
	}
	results := Evaluate(cases, []Sample{{Trace: trace, Steps: steps}})
	if len(results) != len(cases) {
		t.Fatalf("results=%d cases=%d", len(results), len(cases))
	}
	for index, result := range results {
		if !result.Passed || result.Score != 100 || result.ErrorMessage != "" {
			t.Fatalf("case %s result=%#v", keys[index], result)
		}
	}
}

func TestGraphResultRejectsOnlyNonEmptyDiagnostics(t *testing.T) {
	if graphResultHasProblem(json.RawMessage(`{"missing":[],"invalid":null,"nested":{"errors":[]}}`)) {
		t.Fatal("empty diagnostics must not fail a graph result")
	}
	if !graphResultHasProblem(json.RawMessage(`{"missing":["node-1"]}`)) {
		t.Fatal("non-empty missing diagnostics must fail a graph result")
	}
}

func TestEvaluateRejectsUnconfirmedDangerousStep(t *testing.T) {
	trace := &store.AgentExecutionTrace{ID: uuid.New(), Status: "succeeded"}
	result := Evaluate([]store.AgentEvalCase{{ID: uuid.New(), Key: "safe-batch-delete"}}, []Sample{{Trace: trace, Steps: []*store.AgentToolStep{{
		ToolName: "canvas_clear", Status: "succeeded", RequiresConfirmation: false,
	}}}})[0]
	if result.Passed || result.Score != 0 || result.ErrorMessage != "" {
		t.Fatalf("result=%#v", result)
	}
}

func TestEvaluateAssistantAgentCases(t *testing.T) {
	trace := &store.AgentExecutionTrace{
		ID: uuid.New(), Workspace: "assistant", Status: "succeeded",
		VisualSummary: json.RawMessage(`{"referenceImages":[{"id":"ref-1"}]}`),
		GoalContract: json.RawMessage(`{
			"outcomeKind":"image_proposal","promptMode":"faithful","deliverableCount":2,
			"referencedImageCount":1,"webSearchRequested":true,"webSearchCount":1,
			"faithfulPreserved":true,
			"deliverables":[{"title":"主图","prompt":"主图提示词"},{"title":"细节图","prompt":"细节图提示词"}]
		}`),
	}
	steps := []*store.AgentToolStep{
		{ToolName: "web_search", Status: "succeeded"},
		{ToolName: "propose_image_action", Status: "succeeded"},
	}
	keys := []string{
		"assistant-tool-call-completion", "assistant-image-grounding", "assistant-prompt-fidelity",
		"assistant-multi-image-plan", "assistant-web-search",
	}
	cases := make([]store.AgentEvalCase, 0, len(keys))
	for _, key := range keys {
		cases = append(cases, store.AgentEvalCase{ID: uuid.New(), Key: key, Workspace: "assistant"})
	}
	results := Evaluate(cases, []Sample{{Trace: trace, Steps: steps}})
	for index, result := range results {
		if !result.Passed || result.Score != 100 || result.ErrorMessage != "" {
			t.Fatalf("case %s result=%#v", keys[index], result)
		}
	}
}

func TestEvaluateKeepsAssistantAndCanvasCasesIsolated(t *testing.T) {
	trace := &store.AgentExecutionTrace{ID: uuid.New(), Workspace: "assistant", Status: "succeeded"}
	result := Evaluate([]store.AgentEvalCase{{ID: uuid.New(), Key: "tool-call-completion", Workspace: "canvas"}}, []Sample{{Trace: trace}})[0]
	if result.Passed || result.ErrorMessage == "" {
		t.Fatalf("canvas case evaluated assistant trace: %#v", result)
	}
}
