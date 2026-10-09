package worker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantreview"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// reviewProber exposes the probe to the admin review.
type reviewProber struct{ worker *Worker }

// NewReviewProber gives the admin review the agent's probe without the
// HTTP server importing the worker.
func NewReviewProber(cfg *config.Config, st *store.Store) assistantreview.Prober {
	return reviewProber{worker: &Worker{Cfg: cfg, St: st}}
}

func (p reviewProber) Probe(ctx context.Context, client *sub2api.Client, item assistantreview.Case, params map[string]any) (assistantreview.Action, error) {
	return p.worker.ProbeAssistantAgent(ctx, client, item, params)
}

// ProbeAssistantAgent asks the agent for its first move on a case, with the
// instructions and tools a real turn in that mode gets, and runs no tool.
// params carries what the run would have been created with (the image model
// catalog and defaults). It uses no user's data: memory is on but empty, and
// attached images are described in words.
func (w *Worker) ProbeAssistantAgent(ctx context.Context, client *sub2api.Client, item assistantreview.Case, params map[string]any) (assistantreview.Action, error) {
	runParams := map[string]any{"timezone": "Asia/Shanghai", "workspace": "assistant", "_engine": AssistantEngineV2}
	for key, value := range params {
		runParams[key] = value
	}
	run := &store.AssistantRun{
		ID: uuid.New(), UserID: uuid.Nil, ConversationID: uuid.New(),
		Mode: item.Mode, Prompt: item.Prompt, Params: runParams,
	}
	commerce := assistantV2Commerce{}
	if item.Mode == assistantreview.ModeAgent && item.ReferenceCount > 0 {
		commerce = assistantV2Commerce{enabled: true, inputKeys: make([]string, item.ReferenceCount)}
	}
	platform, err := w.assistantAgentPlatformFor(ctx, run, client, nil, assistantmemory.Recall{Enabled: true}, commerce)
	if err != nil {
		return assistantreview.Action{}, err
	}
	withholdProposal := platform.chatOnly
	modelCatalog := assistantProposalModelCatalog(run.Params)
	toolset, err := w.assistantAgentTools(modelCatalog, withholdProposal, nil, platform)
	if err != nil {
		return assistantreview.Action{}, err
	}
	static, turnContext := assistantAgentTurnInstructions(run, nil, modelCatalog, withholdProposal, platform)
	payload := []sub2api.Message{{Role: "system", Content: joinAssistantInstructions(static, turnContext)}}
	for _, message := range item.Context {
		if role := strings.TrimSpace(message.Role); (role == "user" || role == "assistant") && strings.TrimSpace(message.Content) != "" {
			payload = append(payload, sub2api.Message{Role: role, Content: message.Content})
		}
	}
	prompt := item.Prompt
	if item.ReferenceCount > 0 {
		prompt += fmt.Sprintf("\n（本轮附带 %d 张参考图）", item.ReferenceCount)
	}
	payload = append(payload, sub2api.Message{Role: "user", Content: prompt})

	started := time.Now()
	// Tools load on demand exactly as in a real turn (see assistantToolLoader).
	loader := newAssistantToolLoader(toolset.tools, assistantToolPreloadsFor(item.Prompt))
	result, err := client.ChatAgentWithTools(ctx, payload, nil, loader.active(toolset.tools), "", nil)
	for attempt := 0; attempt < 2 && err == nil && result.ToolCall != nil; attempt++ {
		switch {
		case result.ToolCall.Name == toolset.plan.Name:
			// Writing a to-do list is not a move; ask once more for the real one.
			steps, planErr := parseAssistantPlan(result.ToolCall.Arguments)
			observation, _ := assistantAgentToolObservation(result.ToolCall, assistantPlanObservation(steps), planErr, nil)
			payload = append(payload, canvasAgentToolMessages(result, observation)...)
		case len(loader.loadCalls(result)) > 0:
			// Loading a tool is not a move either: the next call is.
			loads := loader.loadCalls(result)
			observations := make([]string, len(loads))
			for index, call := range loads {
				observations[index] = loader.observe(call)
			}
			payload = append(payload, assistantAgentBatchToolMessages(result.Text, loads, observations)...)
		default:
			attempt = 2
			continue
		}
		result, err = client.ChatAgentWithTools(ctx, payload, nil, loader.active(toolset.tools), "", nil)
	}
	if err != nil {
		return assistantreview.Action{}, err
	}
	action := assistantreview.Action{LatencyMs: time.Since(started).Milliseconds(), Text: truncateAssistantRunes(strings.TrimSpace(result.Text), 400)}
	if result.ToolCall != nil {
		action.Tool = result.ToolCall.Name
		action.Arguments = truncateAssistantRunes(result.ToolCall.Arguments, 600)
	}
	if action.Category = assistantreview.CategoryOfTool(action.Tool); action.Category == "" {
		// A second to-do list in a row still made no move: count it as words.
		action.Category = assistantreview.ExpectAnswer
	}
	// A model without tool support writes the proposal as JSON text.
	if action.Tool == "" && !platform.chatOnly && assistantTextLooksLikeProposal(result.Text) {
		action.Category = assistantreview.ExpectImage
	}
	return action, nil
}
