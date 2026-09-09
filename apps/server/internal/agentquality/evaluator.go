package agentquality

import (
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type Sample struct {
	Trace *store.AgentExecutionTrace
	Steps []*store.AgentToolStep
}

type CaseResult struct {
	CaseID       uuid.UUID
	TraceID      *uuid.UUID
	Passed       bool
	Score        float64
	Metrics      json.RawMessage
	ErrorMessage string
}

type sampleVerdict struct {
	Applicable bool
	Passed     bool
}

func Evaluate(cases []store.AgentEvalCase, samples []Sample) []CaseResult {
	results := make([]CaseResult, 0, len(cases))
	for _, evalCase := range cases {
		applicable := 0
		passed := 0
		var representative *uuid.UUID
		for _, sample := range samples {
			if sample.Trace == nil || (evalCase.Workspace != "" && sample.Trace.Workspace != evalCase.Workspace) {
				continue
			}
			verdict := evaluateSample(evalCase.Key, sample)
			if !verdict.Applicable || sample.Trace == nil {
				continue
			}
			applicable++
			if verdict.Passed {
				passed++
			} else if representative == nil {
				id := sample.Trace.ID
				representative = &id
			}
		}
		if representative == nil && applicable > 0 {
			for _, sample := range samples {
				if sample.Trace != nil && (evalCase.Workspace == "" || sample.Trace.Workspace == evalCase.Workspace) && evaluateSample(evalCase.Key, sample).Applicable {
					id := sample.Trace.ID
					representative = &id
					break
				}
			}
		}
		score := 0.0
		if applicable > 0 {
			score = float64(passed) * 100 / float64(applicable)
		}
		metrics, _ := json.Marshal(map[string]any{
			"sampleCount": applicable,
			"passedCount": passed,
			"failedCount": applicable - passed,
			"passRate":    score,
		})
		result := CaseResult{CaseID: evalCase.ID, TraceID: representative, Passed: applicable > 0 && score >= 80, Score: score, Metrics: metrics}
		if applicable == 0 {
			result.ErrorMessage = "当前筛选范围没有适用于该评测项的真实 Agent 样本"
		}
		results = append(results, result)
	}
	return results
}

func evaluateSample(key string, sample Sample) sampleVerdict {
	if sample.Trace == nil {
		return sampleVerdict{}
	}
	goal := agentGoalContract(sample.Trace.GoalContract)
	switch key {
	case "assistant-tool-call-completion":
		if sample.Trace.Workspace != "assistant" {
			return sampleVerdict{}
		}
		unfinished := false
		for _, step := range sample.Steps {
			unfinished = unfinished || step.Status == "pending" || step.Status == "claimed"
		}
		terminal := sample.Trace.Status == "succeeded" || sample.Trace.Status == "failed" || sample.Trace.Status == "canceled"
		return sampleVerdict{Applicable: true, Passed: terminal && !unfinished}
	case "assistant-image-grounding":
		if sample.Trace.Workspace != "assistant" || goal.OutcomeKind != "image_proposal" || referenceImageCount(sample.Trace.VisualSummary) == 0 {
			return sampleVerdict{}
		}
		return sampleVerdict{Applicable: true, Passed: goal.ReferencedImageCount > 0 && successfulTool(sample.Steps, "propose_image_action")}
	case "assistant-prompt-fidelity":
		if sample.Trace.Workspace != "assistant" || goal.PromptMode != "faithful" {
			return sampleVerdict{}
		}
		return sampleVerdict{Applicable: true, Passed: goal.FaithfulPreserved}
	case "assistant-multi-image-plan":
		if sample.Trace.Workspace != "assistant" || goal.DeliverableCount < 2 || len(goal.Deliverables) == 0 {
			return sampleVerdict{}
		}
		complete := len(goal.Deliverables) == goal.DeliverableCount
		for _, item := range goal.Deliverables {
			complete = complete && strings.TrimSpace(item.Title) != "" && strings.TrimSpace(item.Prompt) != ""
		}
		return sampleVerdict{Applicable: true, Passed: complete}
	case "assistant-web-search":
		if sample.Trace.Workspace != "assistant" || !goal.WebSearchRequested {
			return sampleVerdict{}
		}
		return sampleVerdict{Applicable: true, Passed: goal.WebSearchCount > 0 && successfulTool(sample.Steps, "web_search")}
	case "intent-selected-nodes":
		ids := selectedNodeIDs(sample.Trace.InitialSnapshot)
		if len(ids) == 0 {
			return sampleVerdict{}
		}
		used := successfulTool(sample.Steps, "canvas_get_selection")
		for _, step := range sample.Steps {
			if step.Status != "succeeded" {
				continue
			}
			arguments := string(step.Arguments)
			for _, id := range ids {
				if strings.Contains(arguments, id) {
					used = true
					break
				}
			}
		}
		return sampleVerdict{Applicable: true, Passed: used}
	case "multi-image-pairing":
		count := referenceImageCount(sample.Trace.VisualSummary)
		if count < 2 {
			count = selectedImageCount(sample.Trace.InitialSnapshot)
		}
		if count < 2 {
			return sampleVerdict{}
		}
		paired := successfulAnyTool(sample.Steps, "canvas_regenerate_selection", "canvas_create_image_operation", "canvas_create_attachment_nodes") || successfulGraphTool(sample.Steps)
		return sampleVerdict{Applicable: true, Passed: paired && noFailedGraphStep(sample.Steps)}
	case "workflow-from-reference":
		if referenceImageCount(sample.Trace.VisualSummary) == 0 && selectedImageCount(sample.Trace.InitialSnapshot) == 0 {
			return sampleVerdict{}
		}
		created := successfulGraphTool(sample.Steps) || successfulTool(sample.Steps, "canvas_create_from_workflow_template")
		validated := successfulResultContains(sample.Steps, "canvas_validate_workflow", `"valid":true`)
		return sampleVerdict{Applicable: true, Passed: created && validated}
	case "safe-batch-delete":
		dangerous := dangerousSteps(sample.Steps)
		if len(dangerous) == 0 {
			return sampleVerdict{}
		}
		for _, step := range dangerous {
			if !step.RequiresConfirmation {
				return sampleVerdict{Applicable: true}
			}
		}
		return sampleVerdict{Applicable: true, Passed: true}
	case "node-rollback":
		hasFailure := false
		for _, step := range sample.Steps {
			hasFailure = hasFailure || step.Status == "failed"
		}
		if !hasFailure && !successfulAnyTool(sample.Steps, "canvas_restore_checkpoint", "canvas_restore_agent_transaction", "canvas_undo_last_action") {
			return sampleVerdict{}
		}
		return sampleVerdict{Applicable: true, Passed: sample.Trace.CheckpointID != nil}
	case "failed-step-retry":
		failedAt := make(map[string]int)
		applicable := false
		passed := false
		for index, step := range sample.Steps {
			if step.Status == "failed" {
				failedAt[step.ToolName] = index
				applicable = true
			}
			if first, ok := failedAt[step.ToolName]; ok && index > first && step.Status == "succeeded" {
				passed = true
			}
		}
		return sampleVerdict{Applicable: applicable, Passed: passed}
	case "connection-correctness":
		if !hasGraphStep(sample.Steps) {
			return sampleVerdict{}
		}
		return sampleVerdict{Applicable: true, Passed: noFailedGraphStep(sample.Steps)}
	case "tool-call-completion":
		unfinished := false
		for _, step := range sample.Steps {
			unfinished = unfinished || step.Status == "pending" || step.Status == "claimed"
		}
		terminal := sample.Trace.Status == "succeeded" || sample.Trace.Status == "failed" || sample.Trace.Status == "canceled"
		return sampleVerdict{Applicable: true, Passed: terminal && !unfinished}
	default:
		return sampleVerdict{}
	}
}

type goalContract struct {
	OutcomeKind          string `json:"outcomeKind"`
	PromptMode           string `json:"promptMode"`
	DeliverableCount     int    `json:"deliverableCount"`
	ReferencedImageCount int    `json:"referencedImageCount"`
	WebSearchRequested   bool   `json:"webSearchRequested"`
	WebSearchCount       int    `json:"webSearchCount"`
	FaithfulPreserved    bool   `json:"faithfulPreserved"`
	Deliverables         []struct {
		Title  string `json:"title"`
		Prompt string `json:"prompt"`
	} `json:"deliverables"`
}

func agentGoalContract(raw json.RawMessage) goalContract {
	var contract goalContract
	_ = json.Unmarshal(raw, &contract)
	return contract
}

func selectedNodeIDs(raw json.RawMessage) []string {
	var snapshot struct {
		SelectedNodeIDs []string `json:"selectedNodeIds"`
	}
	_ = json.Unmarshal(raw, &snapshot)
	return snapshot.SelectedNodeIDs
}

func selectedImageCount(raw json.RawMessage) int {
	var snapshot struct {
		SelectedNodeIDs []string `json:"selectedNodeIds"`
		Nodes           []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"nodes"`
	}
	_ = json.Unmarshal(raw, &snapshot)
	selected := make(map[string]bool, len(snapshot.SelectedNodeIDs))
	for _, id := range snapshot.SelectedNodeIDs {
		selected[id] = true
	}
	count := 0
	for _, node := range snapshot.Nodes {
		if selected[node.ID] && node.Type == "image" {
			count++
		}
	}
	return count
}

func referenceImageCount(raw json.RawMessage) int {
	var summary struct {
		ReferenceImages []json.RawMessage `json:"referenceImages"`
	}
	_ = json.Unmarshal(raw, &summary)
	return len(summary.ReferenceImages)
}

func successfulTool(steps []*store.AgentToolStep, name string) bool {
	for _, step := range steps {
		if step.ToolName == name && step.Status == "succeeded" {
			return true
		}
	}
	return false
}

func successfulAnyTool(steps []*store.AgentToolStep, names ...string) bool {
	for _, name := range names {
		if successfulTool(steps, name) {
			return true
		}
	}
	return false
}

func successfulResultContains(steps []*store.AgentToolStep, name, value string) bool {
	for _, step := range steps {
		if step.ToolName == name && step.Status == "succeeded" && strings.Contains(strings.ReplaceAll(string(step.Result), " ", ""), value) {
			return true
		}
	}
	return false
}

func hasGraphStep(steps []*store.AgentToolStep) bool {
	for _, step := range steps {
		if step.ToolName == "canvas_apply_ops" && strings.Contains(string(step.Arguments), "create_graph") {
			return true
		}
	}
	return false
}

func successfulGraphTool(steps []*store.AgentToolStep) bool {
	for _, step := range steps {
		if step.ToolName == "canvas_apply_ops" && step.Status == "succeeded" && strings.Contains(string(step.Arguments), "create_graph") {
			return true
		}
	}
	return false
}

func noFailedGraphStep(steps []*store.AgentToolStep) bool {
	for _, step := range steps {
		if step.ToolName != "canvas_apply_ops" || !strings.Contains(string(step.Arguments), "create_graph") {
			continue
		}
		if step.Status != "succeeded" || graphResultHasProblem(step.Result) {
			return false
		}
	}
	return true
}

func graphResultHasProblem(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return true
	}
	return jsonProblemValue(value)
}

func jsonProblemValue(value any) bool {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			normalized := strings.ToLower(strings.TrimSpace(key))
			if normalized == "error" || normalized == "errors" || normalized == "invalid" || normalized == "missing" {
				if jsonValuePresent(child) {
					return true
				}
			}
			if jsonProblemValue(child) {
				return true
			}
		}
	case []any:
		for _, child := range item {
			if jsonProblemValue(child) {
				return true
			}
		}
	}
	return false
}

func jsonValuePresent(value any) bool {
	switch item := value.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(item) != ""
	case []any:
		return len(item) > 0
	case map[string]any:
		return len(item) > 0
	case bool:
		return item
	case float64:
		return item != 0
	default:
		return true
	}
}

func dangerousSteps(steps []*store.AgentToolStep) []*store.AgentToolStep {
	items := make([]*store.AgentToolStep, 0)
	for _, step := range steps {
		if step.ToolName == "canvas_delete_nodes" || step.ToolName == "canvas_clear" || step.ToolName == "canvas_restore_checkpoint" || step.ToolName == "canvas_restore_agent_transaction" ||
			(step.ToolName == "canvas_apply_ops" && (strings.Contains(string(step.Arguments), `"delete_node"`) || strings.Contains(string(step.Arguments), `"clear_canvas"`))) {
			items = append(items, step)
		}
	}
	return items
}
