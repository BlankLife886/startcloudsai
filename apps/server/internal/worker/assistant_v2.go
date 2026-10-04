package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantproactive"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantv2"
	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// AssistantEngineV2 marks runs from the assistant page's 问答 and Agent
// modes. They run the one agent loop (executeAssistantAgent) with the
// platform tools added; the run engine (queue, lease, billing, stream,
// cancel) is shared with every other assistant run.
const AssistantEngineV2 = "v2"

const assistantV2MaxViewRows = 120

func assistantRunUsesV2(run *store.AssistantRun) bool {
	return run != nil && assistantParamString(run.Params, "_engine", "") == AssistantEngineV2
}

// assistantV2ChatOnly reports a turn sent in 问答 mode. 问答 only answers:
// it never makes or changes images and never runs site tools; that is what
// Agent and 图片 modes are for. Web search is still answering.
func assistantV2ChatOnly(run *store.AssistantRun) bool {
	return run != nil && run.Mode == "chat"
}

// assistantAgentPlatform is what the v2 entry adds to the agent loop: the
// platform tools with their rules and permissions, and the 问答-mode
// restriction.
type assistantAgentPlatform struct {
	registry     *assistanttools.Registry
	tools        []sub2api.FunctionTool
	permissions  map[assistanttools.Permission]bool
	instructions string
	chatOnly     bool
}

// offers reports whether name is one of the platform tools given this turn.
func (p *assistantAgentPlatform) offers(name string) bool {
	if p == nil {
		return false
	}
	for _, tool := range p.tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

// readOnly reports a platform tool that only reads, so it can run in a
// parallel batch with other reads ("本月和上月各花了多少" asks for two stats
// queries at once).
func (p *assistantAgentPlatform) readOnly(name string) bool {
	if !p.offers(name) {
		return false
	}
	level, ok := p.registry.Level(name)
	return ok && level == assistanttools.LevelRead
}

// attach records the platform tools' cards and marks the answer as v2.
func (p *assistantAgentPlatform) attach(metadata map[string]any, dataViews []map[string]any) {
	if p == nil {
		return
	}
	metadata["engine"] = AssistantEngineV2
	metadata["systemPromptVersion"] = assistantv2.SystemVersion
	if len(dataViews) > 0 {
		metadata["dataViews"] = dataViews
	}
}

// executeAssistantV2 runs a 问答 or Agent turn: gather what the platform
// knows about the user, then hand everything to the one agent loop.
func (w *Worker) executeAssistantV2(ctx context.Context, run *store.AssistantRun) error {
	selection, configured, err := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
	if err != nil {
		return err
	}
	if !configured {
		return fmt.Errorf("AI 助手没有可用的对话模型")
	}
	client, err := w.configuredAssistantChatClient(selection)
	if err != nil {
		return err
	}
	client = client.WithMaxOutputTokens(
		assistantParamInt(run.Params, "_chatMaxOutputTokens", assistantDefaultOutputTokens),
	).WithReasoningEffort(assistantParamString(run.Params, "reasoningEffort", ""))
	return w.runAssistantV2(ctx, run, client)
}

// runAssistantV2 takes the chat client as a parameter so tests can drive it
// against a fake upstream.
func (w *Worker) runAssistantV2(ctx context.Context, run *store.AssistantRun, client *sub2api.Client) error {
	history, err := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
	if err != nil {
		history = nil
	}
	history = assistantMessagesAfterContextBoundary(history)
	references, err := w.loadAssistantReferences(ctx, run.Params)
	if err != nil {
		return err
	}
	chatOnly := assistantV2ChatOnly(run)
	if !chatOnly {
		// Editable PSD / PPT files have their own generator.
		if kind := assistantEditableKind(run); kind != "" {
			return w.executeAssistantEditableFile(ctx, run, references, kind)
		}
	}
	recall := w.assistantV2Recall(ctx, run)
	commerce := assistantV2Commerce{}
	if !chatOnly {
		commerce = w.assistantV2CommerceTurn(ctx, run, recall.Memories)
	}
	if commerce.product != nil && len(references) == 0 {
		// A remembered product stands in for uploading its photos again; the
		// planner still looks at them to write the copy.
		items := make([]map[string]any, 0, len(commerce.inputKeys))
		for _, key := range commerce.inputKeys {
			items = append(items, map[string]any{"fileKey": key})
		}
		if references, err = w.loadAssistantReferenceItems(ctx, items); err != nil {
			return err
		}
	}
	platform, err := w.assistantAgentPlatformFor(ctx, run, client, references, recall, commerce)
	if err != nil {
		return err
	}
	return w.executeAssistantAgent(ctx, client, run, references, history, platform)
}

// assistantAgentPlatformFor builds the platform tools and rules for a turn.
func (w *Worker) assistantAgentPlatformFor(
	ctx context.Context,
	run *store.AssistantRun,
	client *sub2api.Client,
	references []string,
	recall assistantmemory.Recall,
	commerce assistantV2Commerce,
) (*assistantAgentPlatform, error) {
	chatOnly := assistantV2ChatOnly(run)
	var extra []assistanttools.Manifest
	if commerce.enabled {
		extra = append(extra, w.assistantV2CommerceManifest(run, client, references, commerce))
	}
	if recall.Enabled {
		conversationID := run.ConversationID
		extra = append(extra, assistanttools.NewMemoryManifest(w.St, assistanttools.MemoryContext{
			ConversationID: &conversationID, InputKeys: assistantV2ReferenceKeys(run.Params),
		}))
	}
	registry, err := assistantv2.Registry(w.St, time.Now, false, extra...)
	if err != nil {
		return nil, err
	}
	tools, err := registry.Definitions(assistantv2.AgentToolsFor(registry))
	if err != nil {
		return nil, err
	}
	permissions := map[assistanttools.Permission]bool{}
	for _, permission := range assistantv2.TurnPermissions {
		permissions[permission] = true
	}

	var instructions strings.Builder
	instructions.WriteString(assistantv2.PlatformRules)
	instructions.WriteString("\n\n" + assistantv2.TimeNote(assistantParamString(run.Params, "timezone", "Asia/Shanghai"), time.Now()))
	instructions.WriteString(assistantv2.MemoryPrompt(recall.Enabled, recall.Block))
	if chatOnly {
		instructions.WriteString(assistantv2.ChatOnlyPrompt)
	} else {
		if recall.Enabled && recall.Block != "" {
			instructions.WriteString("\n出图方案要遵循记忆里的品牌和风格偏好（写进提示词）；用户本轮另有要求时以本轮为准。")
		}
		instructions.WriteString(assistantproactive.HabitNote(w.assistantV2Habits(ctx, run, recall)))
	}
	if commerce.enabled {
		instructions.WriteString(assistantv2.CommercePrompt)
		if commerce.open != nil {
			fmt.Fprintf(&instructions, "\n本对话已有一套电商图：setId=%s，状态 %s。用户的话是在说这套图时，直接对它操作。", commerce.open.ID, commerce.open.Status)
		}
		if commerce.product != nil {
			fmt.Fprintf(&instructions, "\n本轮没有上传商品图，用的是记忆里的商品“%s”的 %d 张图；策划时参考这条记忆的内容。", commerce.product.Title, len(commerce.inputKeys))
		}
	}
	return &assistantAgentPlatform{
		registry: registry, tools: tools, permissions: permissions,
		instructions: instructions.String(), chatOnly: chatOnly,
	}, nil
}

// assistantV2Habits reads the user's habits for the prompt. They are
// personalisation like memory, so they go away with memory off or with
// suggestions off; a failure only drops them from this turn.
func (w *Worker) assistantV2Habits(ctx context.Context, run *store.AssistantRun, recall assistantmemory.Recall) string {
	if !recall.Enabled {
		return ""
	}
	facts, err := assistantproactive.HabitFacts(ctx, w.St.Pool, run.UserID, recall.Memories, time.Now())
	if err != nil {
		log.Printf("assistant v2 habits failed for run %s: %v", run.ID, err)
	}
	return facts
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

// appendAssistantDataView adds a tool card to the answer. Planning and then
// generating the same e-commerce set returns the same set twice; one live card
// is enough, so the later view replaces the earlier one.
func appendAssistantDataView(views []map[string]any, view map[string]any) []map[string]any {
	if view["view"] == "commerce_set" {
		id := assistantDataViewID(view)
		for index, existing := range views {
			if id != "" && existing["view"] == "commerce_set" && assistantDataViewID(existing) == id {
				views[index] = view
				return views
			}
		}
	}
	return append(views, view)
}

func assistantDataViewID(view map[string]any) string {
	data, _ := view["data"].(map[string]any)
	id, _ := data["id"].(string)
	return id
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
	// Spend tools enforce the user's budget themselves, inside the
	// transaction that spends; change tools still need a confirmation flow.
	if level == assistanttools.LevelChange {
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

// assistantV2Commerce says whether a turn can make e-commerce image sets:
// the user attached images, the conversation has an open set, or the user
// named a remembered product.
type assistantV2Commerce struct {
	enabled   bool
	inputKeys []string
	open      *store.CommerceSet
	// product is the remembered product whose photos stand in for uploads.
	product *assistantmemory.Memory
}

// assistantV2Recall loads what the assistant remembers about the user. A
// failure only costs this turn its memory; it never fails the turn.
func (w *Worker) assistantV2Recall(ctx context.Context, run *store.AssistantRun) assistantmemory.Recall {
	if w.St == nil {
		return assistantmemory.Recall{}
	}
	recall, err := assistantmemory.Load(ctx, w.St.Pool, run.UserID)
	if err != nil {
		log.Printf("assistant v2 memory recall failed for run %s: %v", run.ID, err)
	}
	return recall
}

func (w *Worker) assistantV2CommerceTurn(ctx context.Context, run *store.AssistantRun, memories []assistantmemory.Memory) assistantV2Commerce {
	if w.St == nil {
		return assistantV2Commerce{}
	}
	keys := assistantV2ReferenceKeys(run.Params)
	open, err := store.LatestOpenCommerceSet(ctx, w.St.Pool, run.UserID, run.ConversationID, time.Now())
	if err != nil {
		log.Printf("assistant v2 open commerce set lookup failed for run %s: %v", run.ID, err)
	}
	turn := assistantV2Commerce{inputKeys: keys, open: open}
	// The set tools are offered whenever a set could be made or is open; the
	// model decides whether the user wants one. The only text match left picks
	// which remembered product's photos to load when nothing was uploaded.
	switch {
	case len(keys) > 0:
		turn.enabled = true
	case open != nil:
		turn.enabled, turn.inputKeys = true, open.InputKeys
	case assistantv2.CommerceSetRequested(run.Prompt) && assistantmemory.ProductFor(memories, run.Prompt) != nil:
		turn.product = assistantmemory.ProductFor(memories, run.Prompt)
		turn.enabled, turn.inputKeys = true, turn.product.ImageKeys
	}
	return turn
}

// assistantV2ReferenceKeys lists the stored images attached to the turn;
// inline data URLs have no key and cannot feed a generation task.
func assistantV2ReferenceKeys(params map[string]any) []string {
	items, _ := params["referenceImages"].([]any)
	if typed, ok := params["referenceImages"].([]map[string]any); ok {
		for _, item := range typed {
			items = append(items, item)
		}
	}
	keys := []string{}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		key := assistantMapString(item, "fileKey")
		if value := assistantMapString(item, "dataUrl"); key == "" && strings.HasPrefix(value, "/api/v1/files/") {
			key = strings.TrimPrefix(value, "/api/v1/files/")
		}
		if key = strings.TrimSpace(key); key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}

func (w *Worker) assistantV2CommerceManifest(run *store.AssistantRun, client *sub2api.Client, references []string, turn assistantV2Commerce) assistanttools.Manifest {
	service := commerceset.Service{St: w.St}
	if w.Queue != nil {
		service.Enqueue = w.Queue.EnqueueRunTask
	}
	var copyWriter commerceset.CopyWriter
	if len(references) > 0 {
		planner := client.WithoutReasoning()
		copyWriter = func(ctx context.Context, prompt string) (string, error) {
			return planner.ChatTextWithImages(ctx, []sub2api.Message{{Role: "user", Content: prompt}}, references, nil)
		}
	}
	conversationID, runID := run.ConversationID, run.ID
	return assistanttools.NewCommerceSetManifest(service, assistanttools.CommerceSetContext{
		ConversationID: &conversationID, RunID: &runID, InputKeys: turn.inputKeys, Copy: copyWriter,
	})
}
