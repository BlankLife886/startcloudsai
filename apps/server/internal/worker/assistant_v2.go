package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
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
	assistantV2MaxSteps         = 6
	assistantV2DecisionTimeout  = 3 * time.Second
	assistantV2SystemVersion    = "assistant-v2-1"
	assistantV2MaxViewRows      = 120
	assistantV2ClarifyThreshold = 0.75
)

func assistantRunUsesV2(run *store.AssistantRun) bool {
	return run != nil && assistantParamString(run.Params, "_engine", "") == AssistantEngineV2
}

// Intents the decision layer chooses between. Each maps to capability
// domains whose tools are exposed for the turn.
const (
	assistantV2IntentAnswer  = "answer"
	assistantV2IntentMyData  = "my_data"
	assistantV2IntentCreate  = "create"
	assistantV2IntentAccount = "account"
)

func assistantV2DecisionQuestions() []decision.Question {
	return []decision.Question{
		{
			ID: "intent", Kind: decision.KindChoice,
			Instructions: "判断用户最后一条消息主要需要哪类能力。",
			Options: []decision.Option{
				{ID: assistantV2IntentAnswer, Description: "直接回答：闲聊、知识问答、写作、平台功能怎么用"},
				{ID: assistantV2IntentMyData, Description: "查询用户本人的数据：用量、消耗、积分去向、创作次数、成功率、明细记录"},
				{ID: assistantV2IntentCreate, Description: "要求生成、修改或处理图片和设计"},
				{ID: assistantV2IntentAccount, Description: "账户与支付：充值、购买或退订套餐、订单、退款、修改密码、API Key"},
			},
		},
		{
			ID: "clarify", Kind: decision.KindYesNo,
			Instructions: "用户的要求是否缺少关键信息，必须先追问一个问题才能继续？能先给出合理默认答案的情况回答否。",
		},
	}
}

var assistantV2MyDataPattern = regexp.MustCompile(`(花了|花哪|花在|花费|钱|消耗|消费|扣了|扣费|积分|余额|用量|用了多少|多少张|多少次|成功率|失败率|统计|账单|明细|趋势|环比|本月|上月|这周|上周|今年)`)

// assistantV2Rules answer only when the text makes the answer obvious, with
// deliberately low confidence; everything else is left to the defaults.
func assistantV2Rules() decision.Rules {
	return decision.Rules{
		"intent": func(state string) (decision.Answer, bool) {
			last := state
			if index := strings.LastIndex(state, "用户："); index >= 0 {
				last = state[index:]
			}
			if assistantV2MyDataPattern.MatchString(last) {
				return decision.Answer{Choice: assistantV2IntentMyData, Confidence: 0.4}, true
			}
			return decision.Answer{Choice: assistantV2IntentAnswer, Confidence: 0.2}, true
		},
		"clarify": decision.Fixed(decision.Answer{Yes: 0, Confidence: 0.2}),
	}
}

// assistantV2Decider builds the decision chain: the decision model (override
// or the assistant page's default chat model) first, rules as fallback.
func (w *Worker) assistantV2Decider(ctx context.Context) decision.Decider {
	chain := decision.Chain{Fallback: assistantV2Rules(), Timeout: assistantV2DecisionTimeout}
	if w.St == nil {
		return chain
	}
	selection, err := decision.ResolveModel(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		if !errors.Is(err, decision.ErrNoModel) {
			log.Printf("assistant v2 decision model unavailable: %v", err)
		}
		return chain
	}
	client, err := w.configuredAssistantChatClient(selection)
	if err != nil {
		log.Printf("assistant v2 decision client unavailable: %v", err)
		return chain
	}
	chain.Primary = decision.LLM{Completer: decision.ClientCompleter{Client: client}, Model: selection.Model.Name}
	return chain
}

func assistantV2DecisionState(history []*store.AssistantMessage, run *store.AssistantRun) string {
	return buildAssistantIntentTranscript(history, run.UserMessageID, run.AssistantMessageID, run.Prompt)
}

type assistantV2Decision struct {
	Intent     string
	Confidence float64
	Clarify    bool
	Response   decision.Response
	Err        error
}

func (d assistantV2Decision) metadata() map[string]any {
	out := map[string]any{
		"intent":     d.Intent,
		"confidence": d.Confidence,
		"clarify":    d.Clarify,
		"provider":   d.Response.Provider,
		"model":      d.Response.Model,
		"calibrated": d.Response.Calibrated,
		"latencyMs":  d.Response.LatencyMs,
	}
	if len(d.Response.FallbackIDs) > 0 {
		out["fallbackIds"] = d.Response.FallbackIDs
	}
	if d.Err != nil {
		out["error"] = sanitizeUpstreamMessage(d.Err.Error())
	}
	return out
}

func (w *Worker) assistantV2Decide(ctx context.Context, decider decision.Decider, state string) assistantV2Decision {
	result := assistantV2Decision{Intent: assistantV2IntentAnswer}
	response, err := decider.Decide(ctx, decision.Request{State: state, Questions: assistantV2DecisionQuestions()})
	result.Response, result.Err = response, err
	if answer, ok := response.Answers["intent"]; ok && answer.Choice != "" {
		result.Intent, result.Confidence = answer.Choice, answer.Confidence
	}
	if answer, ok := response.Answers["clarify"]; ok {
		// Self-reported LLM confidence is not calibrated, so clarification
		// needs a clearly high "yes" before the assistant stops to ask.
		result.Clarify = answer.Yes >= assistantV2ClarifyThreshold
	}
	return result
}

// assistantV2Registry holds the capabilities v2 can call. Each domain is one
// manifest; adding a platform capability means adding a manifest here.
func (w *Worker) assistantV2Registry() (*assistanttools.Registry, error) {
	return assistanttools.NewRegistry(
		assistanttools.NewMyDataManifest(w.St, time.Now),
		assistanttools.NewTaskStatusManifest(w.St.Pool),
	)
}

// assistantV2ToolsFor returns the tools exposed for an intent. Read-only
// personal data is cheap and safe, so it stays available to every turn that
// might reference it; other domains join as they ship.
func assistantV2ToolsFor(registry *assistanttools.Registry, intent string) []string {
	names := []string{}
	for _, name := range registry.Names() {
		switch registry.Domain(name) {
		case "my_data", "task-status":
			names = append(names, name)
		}
	}
	return names
}

func assistantV2SystemPrompt(run *store.AssistantRun, now time.Time, d assistantV2Decision) string {
	timezone := assistantParamString(run.Params, "timezone", "Asia/Shanghai")
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.FixedZone("Asia/Shanghai", 8*3600)
	}
	local := now.In(location)
	var builder strings.Builder
	builder.WriteString(`你是星云 AI 平台的 AI 助手。你的目标是帮用户把事情办成，而不只是回答问题。

通用规则：
- 用中文回答，先给结论，再给依据，最后给可以直接执行的下一步。
- 用户问某个任务为什么失败、还在不在跑、有没有退款时，调用 task_status 查看真实状态，不要猜测；不向用户展示内部任务 ID、线路或端点。
- 涉及用户本人的数据（用量、消耗、积分去向、创作次数、成功率、明细）时，必须调用 my_stats_query 或 my_records_list 获取，回答中的每个数字都只能来自工具结果；工具没返回的数字不得编造或估算。
- 问题不够具体时先给合理的默认答案（例如默认看最近 30 天），再提供一两个细分方向，不要反问。
- 统计结果要做解读：与上一周期对比时说明变化幅度，并指出变化最大的部分和可能的原因。
- 解读只能基于工具返回的分组数据，不要臆测用户的意图。
- 账户与支付操作（充值、购买或退订套餐、退款、修改密码、管理 API Key）你不能代为执行：解释清楚后给出站内页面让用户自己操作——钱包 /wallet，订阅 /subscriptions，订单 /orders，套餐价格 /pricing，个人资料 /profile，API /developer-api。
- 生成或修改图片：当前版本请给出具体建议（画面、比例、模型选择），并引导用户到对应工作台：AI 电商 /ecommerce-design，文生图 /text-to-image，无限画布 /canvas，游戏设计 /game-art，模型设计 /model-sheet，UI 设计 /design-workshop。
- 站内链接用 Markdown 链接格式，例如 [打开钱包](/wallet)。`)
	fmt.Fprintf(&builder, "\n\n当前时间：%s（%s，%s）。", local.Format("2006-01-02 15:04"), timezone, [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}[local.Weekday()])
	if d.Clarify {
		builder.WriteString("\n\n本轮判断：用户的要求缺少关键信息。只问一个最关键的问题，并给出 2-3 个可选答案供用户直接选择。")
	}
	switch d.Intent {
	case assistantV2IntentAccount:
		builder.WriteString("\n\n本轮判断：这是账户或支付相关的问题。可以查询并解释用户自己的数据，但不能代为执行任何账户或支付操作。")
	case assistantV2IntentCreate:
		builder.WriteString("\n\n本轮判断：用户想生成或处理图片。按上面“生成或修改图片”的规则回答。")
	}
	return builder.String()
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
	return w.runAssistantV2(ctx, run, client, w.assistantV2Decider(ctx))
}

// runAssistantV2 is the orchestration itself, with the chat client and the
// decider injected so tests can drive it against a fake upstream.
func (w *Worker) runAssistantV2(ctx context.Context, run *store.AssistantRun, client *sub2api.Client, decider decision.Decider) error {
	started := assistantRunClock(run)
	ctx = withAssistantDebugLog(ctx, &assistantDebugLog{started: started})
	const kind = "agent"

	history, err := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
	if err != nil {
		history = nil
	}
	history = assistantMessagesAfterContextBoundary(history)

	w.publishAssistantDebug(ctx, run, "decision", "正在判断这一轮需要什么能力")
	decided := w.assistantV2Decide(ctx, decider, assistantV2DecisionState(history, run))
	w.publishAssistantDebug(ctx, run, "decision_done", fmt.Sprintf("%s（置信度 %.2f，来源 %s）",
		decided.Intent, decided.Confidence, decided.Response.Provider))

	payload, _, err := w.prepareAssistantContext(ctx, run, kind, assistantV2SystemPrompt(run, time.Now(), decided), history, nil, false, "thinking")
	if err != nil {
		return err
	}

	registry, err := w.assistantV2Registry()
	if err != nil {
		return err
	}
	toolNames := []string{}
	if !decided.Clarify {
		toolNames = assistantV2ToolsFor(registry, decided.Intent)
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
		assistanttools.PermissionMyDataRead: true,
		assistanttools.PermissionTasksRead:  true,
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
			observation, meta, toolErr := w.assistantV2InvokeTool(ctx, registry, run, &call, permissions, observations)
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
	metadata["systemPromptVersion"] = assistantV2SystemVersion
	metadata["decision"] = decided.metadata()
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
		Timezone:           assistantParamString(run.Params, "timezone", ""),
	})
	if err != nil {
		return "", nil, err
	}
	return result.Content, result.Meta, nil
}
