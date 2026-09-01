package store_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAgentExecutionTraceRecordsToolsAndScore(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "agent-quality-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(ctx, st.Pool, uuid.New(), user.ID, "Agent", "infinite_canvas", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, _ := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Kind: "chat", Status: "complete", CreatedAt: now})
	assistantMessage, _ := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "agent", Status: "queued", CreatedAt: now})
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID, UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID, Mode: "agent", Prompt: "整理画布", ReservedCents: 10})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertAgentExecutionTrace(ctx, st.Pool, run.ID, user.ID, nil, "gpt-test", "high", json.RawMessage(`{"nodes":[]}`), json.RawMessage(`{"referenceImages":[]}`)); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertAgentToolStepClaim(ctx, st.Pool, run.ID, "tool-1", "canvas_apply_ops", json.RawMessage(`{"ops":[{"type":"delete_node"}]}`), "browser", true); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateAgentTraceCheckpoint(ctx, st.Pool, run.ID, "checkpoint-1"); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteAgentToolStep(ctx, st.Pool, run.ID, "tool-1", json.RawMessage(`{"applied":1}`), "", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishAgentExecutionTrace(ctx, st.Pool, run.ID, "succeeded", now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	trace, err := store.GetUserAgentExecutionTrace(ctx, st.Pool, user.ID, run.ID)
	if err != nil || trace == nil {
		t.Fatalf("trace=%#v err=%v", trace, err)
	}
	if trace.Status != "succeeded" || trace.Score == nil || *trace.Score != 100 {
		t.Fatalf("trace status=%s score=%v", trace.Status, trace.Score)
	}
	steps, err := store.ListAgentToolSteps(ctx, st.Pool, trace.ID)
	if err != nil || len(steps) != 1 || steps[0].Status != "succeeded" || !steps[0].RequiresConfirmation {
		t.Fatalf("steps=%#v err=%v", steps, err)
	}
	summary, err := store.GetAgentQualitySummary(ctx, st.Pool, now.Add(-time.Hour))
	if err != nil || summary.TotalTraces != 1 || summary.SucceededTraces != 1 || summary.ToolSteps != 1 || summary.AverageScore != 100 {
		t.Fatalf("summary=%#v err=%v", summary, err)
	}
	versions, err := store.ListAgentQualityVersions(ctx, st.Pool, now.Add(-time.Hour), 10)
	if err != nil || len(versions) != 1 || versions[0].PromptVersion != store.CanvasAgentPromptVersion || versions[0].ToolVersion != store.CanvasAgentToolVersion {
		t.Fatalf("versions=%#v err=%v", versions, err)
	}
	traces, err := store.ListAdminAgentExecutionTraces(ctx, st.Pool, store.AgentTraceListOptions{Since: now.Add(-time.Hour), Model: "gpt-test", Limit: 10})
	if err != nil || len(traces) != 1 || traces[0].StepCount != 1 || traces[0].UserEmail == "" {
		t.Fatalf("traces=%#v err=%v", traces, err)
	}
	cases, err := store.ListAgentEvalCases(ctx, st.Pool, true)
	if err != nil || len(cases) == 0 {
		t.Fatalf("cases=%#v err=%v", cases, err)
	}
	evalRun, err := store.InsertAgentEvalRun(ctx, st.Pool, "gpt-test", "high", store.CanvasAgentPromptVersion, store.CanvasAgentToolVersion, 1, json.RawMessage(`{"days":7}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertAgentEvalResult(ctx, st.Pool, store.AgentEvalResult{EvalRunID: evalRun.ID, CaseID: cases[0].ID, TraceID: &trace.ID, Passed: true, Score: 100, Metrics: json.RawMessage(`{"sampleCount":1}`)}); err != nil {
		t.Fatal(err)
	}
	completed, err := store.FinishAgentEvalRun(ctx, st.Pool, evalRun.ID, "succeeded", 1, 1, 100, now.Add(3*time.Second))
	if err != nil || completed == nil || completed.Score != 100 || completed.SampleSize != 1 {
		t.Fatalf("completed=%#v err=%v", completed, err)
	}
	results, err := store.ListAgentEvalResults(ctx, st.Pool, evalRun.ID)
	if err != nil || len(results) != 1 || !results[0].Passed {
		t.Fatalf("results=%#v err=%v", results, err)
	}
}

func TestAssistantAgentTraceKeepsWorkspaceAndGoalContract(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "assistant-quality-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(ctx, st.Pool, uuid.New(), user.ID, "Assistant Agent", "assistant", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, _ := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Kind: "chat", Status: "complete", CreatedAt: now})
	assistantMessage, _ := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "agent", Status: "queued", CreatedAt: now})
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID, UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID, Mode: "agent", Prompt: "参考上一张制作主图", ReservedCents: 10})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertAssistantAgentExecutionTrace(ctx, st.Pool, run.ID, user.ID, "gpt-assistant", "high", json.RawMessage(`{"goal":"制作主图"}`), json.RawMessage(`{"referenceImages":[{"id":"ref-1"}]}`)); err != nil {
		t.Fatal(err)
	}
	contract := json.RawMessage(`{"outcomeKind":"image_proposal","deliverableCount":1,"referencedImageCount":1}`)
	if err := store.UpdateAgentTraceGoalContract(ctx, st.Pool, run.ID, contract); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertAgentToolStepClaim(ctx, st.Pool, run.ID, "proposal-1", "propose_image_action", json.RawMessage(`{"count":1}`), "server", false); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteAgentToolStep(ctx, st.Pool, run.ID, "proposal-1", json.RawMessage(`{"count":1}`), "", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishAgentExecutionTrace(ctx, st.Pool, run.ID, "succeeded", now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	trace, err := store.GetUserAgentExecutionTrace(ctx, st.Pool, user.ID, run.ID)
	if err != nil || trace == nil || trace.Workspace != "assistant" || trace.PromptVersion != store.AssistantAgentPromptVersion {
		t.Fatalf("trace=%#v err=%v", trace, err)
	}
	var storedContract map[string]any
	if json.Unmarshal(trace.GoalContract, &storedContract) != nil || storedContract["outcomeKind"] != "image_proposal" || storedContract["deliverableCount"] != float64(1) {
		t.Fatalf("goal contract=%s", trace.GoalContract)
	}
	assistantSummary, err := store.GetAgentQualitySummaryScoped(ctx, st.Pool, now.Add(-time.Hour), "assistant")
	if err != nil || assistantSummary.TotalTraces != 1 || assistantSummary.ToolSteps != 1 {
		t.Fatalf("assistant summary=%#v err=%v", assistantSummary, err)
	}
	canvasSummary, err := store.GetAgentQualitySummaryScoped(ctx, st.Pool, now.Add(-time.Hour), "canvas")
	if err != nil || canvasSummary.TotalTraces != 0 {
		t.Fatalf("canvas summary leaked assistant traces=%#v err=%v", canvasSummary, err)
	}
	cases, err := store.ListAgentEvalCasesScoped(ctx, st.Pool, "assistant", true)
	if err != nil || len(cases) < 5 {
		t.Fatalf("assistant cases=%#v err=%v", cases, err)
	}
	for _, evalCase := range cases {
		if evalCase.Workspace != "assistant" {
			t.Fatalf("canvas case leaked into assistant cases: %#v", evalCase)
		}
	}
}
