package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantdecision"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantv2"
	"github.com/BlankLife886/startcloudsai/server/internal/decision"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// AssistantEngineV2 marks runs created by the rebuilt assistant. The run
// engine (queue, lease, billing, stream, cancel) is shared with v1; only the
// orchestration in this file differs.
const AssistantEngineV2 = "v2"

const (
	assistantV2MaxSteps        = 6
	assistantV2DecisionTimeout = 3 * time.Second
	assistantV2MaxViewRows     = 120
)

// Params carried from v2 into the original engine when a turn is handed over.
const (
	assistantV2IntentParam    = "_v2Intent"
	assistantV2ConfidentParam = "_v2IntentConfident"
)

func assistantRunUsesV2(run *store.AssistantRun) bool {
	return run != nil && assistantParamString(run.Params, "_engine", "") == AssistantEngineV2
}

// The judgment itself lives in assistantdecision so the admin evaluation runs
// exactly the code that routes turns; these names keep the worker readable.
const (
	assistantV2IntentAnswer    = assistantdecision.IntentAnswer
	assistantV2IntentMyData    = assistantdecision.IntentMyData
	assistantV2IntentCreate    = assistantdecision.IntentCreate
	assistantV2IntentWeb       = assistantdecision.IntentWeb
	assistantV2IntentWorkspace = assistantdecision.IntentWorkspace
	assistantV2IntentAccount   = assistantdecision.IntentAccount
)

type (
	assistantV2DecisionSetup = assistantdecision.Setup
	assistantV2Decision      = assistantdecision.Result
)

func assistantV2DelegatesIntent(intent string) bool { return assistantdecision.DelegatesIntent(intent) }

func assistantV2DecisionQuestions() []decision.Question { return assistantdecision.Questions() }

func assistantV2Rules(prompt string) decision.Rules { return assistantdecision.Rules(prompt) }

// assistantV2DecisionSetupFor resolves the decision model (override, else the
// assistant page's default chat model) and its thresholds. Any failure leaves
// the rules in charge; a turn is never blocked on the decision model.
func (w *Worker) assistantV2DecisionSetupFor(ctx context.Context, prompt string) assistantV2DecisionSetup {
	if w.St == nil {
		return assistantdecision.RulesOnly(prompt, decision.DefaultThresholds)
	}
	return assistantdecision.Resolve(ctx, w.St.Pool, w.Cfg.AppSecret, prompt, "")
}

func (w *Worker) assistantV2Decide(ctx context.Context, setup assistantV2DecisionSetup, state string) assistantV2Decision {
	return assistantdecision.Decide(ctx, setup, state)
}

func assistantV2DecisionState(history []*store.AssistantMessage, run *store.AssistantRun, references, documents int) string {
	state := buildAssistantIntentTranscript(history, run.UserMessageID, run.AssistantMessageID, run.Prompt)
	if references > 0 || documents > 0 {
		// Attachments change the answer ("把背景换成白色" with an image is an
		// edit; without one it is a question), so the judge must know.
		state += fmt.Sprintf("\n（本轮附带 %d 张参考图、%d 个文档）", references, documents)
	}
	return state
}

// recordAssistantV2Decision writes the shadow-comparison row. It is best
// effort: losing a log row must never fail the user's turn.
func (w *Worker) recordAssistantV2Decision(ctx context.Context, run *store.AssistantRun, decided assistantV2Decision, delegated bool) {
	if w.St == nil {
		return
	}
	logCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := store.InsertAssistantDecisionLog(logCtx, w.St.Pool, store.AssistantDecisionLog{
		RunID: run.ID, UserID: run.UserID, Provider: decided.Response.Provider, Model: decided.Response.Model,
		Intent: decided.Intent, Confidence: decided.Confidence, RulesIntent: decided.RulesIntent,
		Clarify: decided.Clarify, LowConfidence: decided.LowConfidence, UsedFallback: decided.UsedFallback(),
		Delegated: delegated, LatencyMs: decided.Response.LatencyMs,
	}); err != nil {
		log.Printf("assistant v2 decision log failed for run %s: %v", run.ID, err)
	}
}

// assistantV2HandOver prepares a run for the original engine: image
// proposals, web search and workspace tools live on its Agent path, so the
// turn runs as Agent with v2's judgment attached (in memory only; the stored
// run keeps the mode the user picked and was priced for).
func assistantV2HandOver(run *store.AssistantRun, decided assistantV2Decision) *store.AssistantRun {
	handed := *run
	handed.Mode = "agent"
	params := make(map[string]any, len(run.Params)+2)
	for key, value := range run.Params {
		params[key] = value
	}
	params[assistantV2IntentParam] = decided.Intent
	params[assistantV2ConfidentParam] = fmt.Sprint(decided.Confident())
	handed.Params = params
	return &handed
}

func assistantV2SystemPrompt(run *store.AssistantRun, now time.Time, d assistantV2Decision) string {
	return assistantv2.SystemPrompt(assistantParamString(run.Params, "timezone", "Asia/Shanghai"), now, d.Intent, d.Clarify)
}

// assistantV2DataView keeps a tool's structured result for the client to
// render as a chart or table. Rows are capped to keep messages small.
func assistantV2DataView(name string, meta map[string]any) map[string]any {
	view, _ := meta["view"].(string)
	if view == "" {
		return nil
	}
	data := meta["data"]
	raw, err := json.Marshal(data)
	if err != nil {
		return nil
	}
	var generic map[string]any
	if json.Unmarshal(raw, &generic) != nil {
		return nil
	}
	for _, key := range []string{"rows", "records"} {
		if rows, ok := generic[key].([]any); ok && len(rows) > assistantV2MaxViewRows {
			generic[key] = rows[:assistantV2MaxViewRows]
			generic["truncatedForView"] = true
		}
	}
	return map[string]any{"tool": name, "view": view, "data": generic}
}

// executeAssistantV2 runs one v2 turn: decide, call tools in a bounded
// loop, answer, persist and settle. Errors follow v1 conventions so the
// shared failure, cancel and route-retry handling applies unchanged.
func (w *Worker) executeAssistantV2(ctx context.Context, run *store.AssistantRun) error {
	selection, configured, err := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
	if err != nil {
		return err
	}
	if !configured {
		return errors.New("AI 助手没有可用的对话模型")
	}
	client, err := w.configuredAssistantChatClient(selection)
	if err != nil {
		return err
	}
	client = client.WithMaxOutputTokens(
		assistantParamInt(run.Params, "_chatMaxOutputTokens", assistantDefaultOutputTokens),
	).WithReasoningEffort(assistantParamString(run.Params, "reasoningEffort", ""))
	return w.runAssistantV2(ctx, run, client, w.assistantV2DecisionSetupFor(ctx, run.Prompt))
}

// runAssistantV2 is the orchestration itself, with the chat client and the
// decider injected so tests can drive it against a fake upstream.
func (w *Worker) runAssistantV2(ctx context.Context, run *store.AssistantRun, client *sub2api.Client, setup assistantV2DecisionSetup) error {
	started := assistantRunClock(run)
	ctx = withAssistantDebugLog(ctx, &assistantDebugLog{started: started})
	const kind = "agent"

	history, err := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
	if err != nil {
		history = nil
	}
	history = assistantMessagesAfterContextBoundary(history)
	references, err := w.loadAssistantReferences(ctx, run.Params)
	if err != nil {
		return err
	}
	inheritAssistantDocumentContext(run, history)
	fileIDs := assistantRunFileIDs(run)

	w.publishAssistantDebug(ctx, run, "decision", "正在判断这一轮需要什么能力")
	decided := w.assistantV2Decide(ctx, setup, assistantV2DecisionState(history, run, len(references), len(fileIDs)))
	w.publishAssistantDebug(ctx, run, "decision_done", fmt.Sprintf("%s（置信度 %.2f，来源 %s）",
		decided.Intent, decided.Confidence, decided.Response.Provider))
	delegating := assistantV2DelegatesIntent(decided.Intent) && !decided.Clarify
	w.recordAssistantV2Decision(ctx, run, decided, delegating)
	if delegating {
		w.publishAssistantDebug(ctx, run, "delegate", "交给原有引擎处理："+decided.Intent)
		return w.executeAssistantRunLegacy(ctx, assistantV2HandOver(run, decided))
	}

	systemPrompt := assistantV2SystemPrompt(run, time.Now(), decided)
	if len(fileIDs) > 0 {
		_, skill, skillErr := w.assistantDocumentSkill(run)
		if skillErr != nil {
			return skillErr
		}
		systemPrompt += "\n\n本轮附带了文档。先用 files_list / files_search / files_read 读取再回答，引用时注明文件名和位置；没读到的内容不要编造。\n" + skill.Instructions
	}
	nextStage := "thinking"
	if len(fileIDs) > 0 {
		nextStage = "analyzing-document"
	} else if len(references) > 0 {
		nextStage = "analyzing-image"
	}
	payload, _, err := w.prepareAssistantContext(ctx, run, kind, systemPrompt, history, references, false, nextStage)
	if err != nil {
		return err
	}

	registry, err := assistantv2.Registry(w.St, time.Now, len(fileIDs) > 0)
	if err != nil {
		return err
	}
	toolNames := []string{}
	if !decided.Clarify {
		toolNames = assistantv2.ToolsFor(registry)
	}
	tools, err := registry.Definitions(toolNames)
	if err != nil {
		return err
	}

	var firstVisible time.Time
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	visible := ""
	onUpdate := func(text, reasoning string) error {
		markAssistantFirstToken(&firstVisible, text)
		if text != "" {
			visible = text
		}
		if (text != "" || reasoning != "") && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: text, Reasoning: reasoning, Kind: kind, Stage: "answering"})
		}
		if time.Since(lastTerminationCheck) >= 400*time.Millisecond {
			lastTerminationCheck = time.Now()
			if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
				if err != nil {
					return err
				}
				return context.Canceled
			}
		}
		return nil
	}

	upstreamCalls := 0
	if decided.Response.Provider == "llm" {
		// The decision model is a real upstream call; profitability reports
		// must see it even though the user pays per turn.
		upstreamCalls++
	}
	var usage sub2api.ChatUsage
	addUsage := func(next sub2api.ChatUsage) {
		usage.PromptTokens += next.PromptTokens
		usage.CompletionTokens += next.CompletionTokens
		usage.TotalTokens += next.TotalTokens
		usage.ReasoningTokens += next.ReasoningTokens
	}
	var toolSteps []map[string]any
	var dataViews []map[string]any
	observations := map[string]string{}
	text, reasoning := "", ""
	messages := payload
	permissions := map[assistanttools.Permission]bool{
		assistanttools.PermissionFilesMetadata: len(fileIDs) > 0,
		assistanttools.PermissionFilesRead:     len(fileIDs) > 0,
	}
	for _, permission := range assistantv2.ReadPermissions {
		permissions[permission] = true
	}

	for step := 0; ; step++ {
		if len(tools) == 0 || step >= assistantV2MaxSteps {
			// No tools for this turn, or the loop budget is spent: answer from
			// what is known so far.
			completion, err := client.CompleteChatTextWithImages(ctx, messages, nil, onUpdate)
			upstreamCalls++
			if err != nil {
				return &assistantProviderError{err: err, outputStarted: strings.TrimSpace(visible) != "" || len(toolSteps) > 0}
			}
			addUsage(completion.Usage)
			text, reasoning = completion.Text, completion.Reasoning
			break
		}
		result, err := client.ChatAgentWithTools(ctx, messages, nil, tools, "", onUpdate)
		upstreamCalls++
		if err != nil {
			return &assistantProviderError{err: err, outputStarted: strings.TrimSpace(visible) != "" || len(toolSteps) > 0}
		}
		addUsage(result.Usage)
		if len(result.ToolCalls) == 0 {
			text, reasoning = result.Text, result.Reasoning
			break
		}
		messages = append(messages, sub2api.Message{Role: "assistant", Content: result.Text, ToolCalls: result.ToolCalls})
		for index := range result.ToolCalls {
			call := result.ToolCalls[index]
			requestID := strings.TrimSpace(call.ID)
			if requestID == "" {
				requestID = fmt.Sprintf("v2-%d-%d", step, index)
				call.ID = requestID
			}
			assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
				Kind: kind, Stage: "tool",
				Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "running"},
			})
			stepStarted := time.Now()
			observation, meta, toolErr := w.assistantV2InvokeTool(ctx, registry, run, &call, permissions, observations, fileIDs)
			if record := assistantAgentToolStepRecord(&call, toolErr, time.Since(stepStarted)); record != nil {
				toolSteps = append(toolSteps, record)
			}
			merged, observationErr := assistantAgentToolObservation(&call, observation, toolErr, ctx.Err())
			if observationErr != nil {
				return observationErr
			}
			if toolErr == nil {
				if key := assistantAgentToolCallKey(&call); key != "" {
					observations[key] = merged
				}
				if view := assistantV2DataView(call.Name, meta); view != nil {
					dataViews = append(dataViews, view)
				}
			}
			event := &assistantstream.ToolCallEvent{RequestID: requestID, Name: call.Name, Arguments: call.Arguments, Execution: "server", Status: "completed"}
			if toolErr != nil {
				event.Status, event.Error = "failed", assistantAgentSafeToolError(toolErr)
			} else if json.Valid([]byte(observation)) {
				event.Result = json.RawMessage(observation)
			}
			assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: kind, Stage: "tool", Tool: event})
			messages = append(messages, sub2api.Message{Role: "tool", ToolCallID: requestID, Name: call.Name, Content: merged})
		}
	}

	text = strings.TrimSpace(text)
	if text == "" {
		return errAssistantAgentEmptyResponse
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	usage = finalizeAssistantUsage(usage, started, firstVisible, run, text)
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	attachAssistantUsage(metadata, usage)
	attachAssistantReasoning(metadata, reasoning)
	attachAssistantToolSteps(metadata, toolSteps)
	metadata["engine"] = AssistantEngineV2
	metadata["systemPromptVersion"] = assistantv2.SystemVersion
	// Underscore keys stay server-side: the decision is for evaluation, not display.
	metadata["_decision"] = decided.Metadata(sanitizeUpstreamMessage)
	if len(dataViews) > 0 {
		metadata["dataViews"] = dataViews
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, kind, "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAgentAttempt(ctx, w.St, run.ID, run.Attempt, "chat", upstreamCalls)
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Content: text, Reasoning: reasoning, Kind: kind, Stage: "complete", Done: true, Status: "succeeded",
		Usage: usage.Map(),
	})
	return nil
}

// assistantV2InvokeTool enforces the capability level before running a tool.
// Only read tools run directly; spending and changing tools need the approval
// flow, which arrives with creation support.
func (w *Worker) assistantV2InvokeTool(
	ctx context.Context,
	registry *assistanttools.Registry,
	run *store.AssistantRun,
	call *sub2api.ToolCall,
	permissions map[assistanttools.Permission]bool,
	observations map[string]string,
	fileIDs []uuid.UUID,
) (string, map[string]any, error) {
	level, ok := registry.Level(call.Name)
	if !ok {
		return "", nil, fmt.Errorf("工具 %s 不存在", call.Name)
	}
	if level != assistanttools.LevelRead {
		return "", nil, fmt.Errorf("工具 %s 需要用户确认后才能执行", call.Name)
	}
	if key := assistantAgentToolCallKey(call); key != "" {
		if previous, ok := observations[key]; ok {
			return assistantAgentRepeatedToolObservation(previous), nil, nil
		}
	}
	result, err := registry.Execute(ctx, call.Name, assistanttools.Invocation{
		UserID:             run.UserID,
		RunID:              run.ID,
		AssistantMessageID: run.AssistantMessageID,
		Arguments:          assistantToolArguments(call.Arguments),
		Permissions:        permissions,
		FileIDs:            fileIDs,
		Timezone:           assistantParamString(run.Params, "timezone", ""),
	})
	if err != nil {
		return "", nil, err
	}
	return result.Content, result.Meta, nil
}
