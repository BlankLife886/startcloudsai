package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/decision"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

type v2Fixture struct {
	st               *store.Store
	user             *store.User
	run              *store.AssistantRun
	assistantMessage uuid.UUID
}

func newV2Fixture(t *testing.T, prompt string) v2Fixture {
	t.Helper()
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "v2-"+uuid.NewString()+"@test.dev", "v2", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	var conversationID uuid.UUID
	if err := st.Pool.QueryRow(ctx, `INSERT INTO assistant_conversations (user_id) VALUES ($1) RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversationID, Role: "user", Content: prompt,
		Kind: "chat", Status: "complete", CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversationID, Role: "assistant", Kind: "agent", Status: "queued",
		CreatedAt: time.Now().UTC().Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversationID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "agent", Prompt: prompt,
		Params: map[string]any{
			"_engine": AssistantEngineV2, "timezone": "Asia/Shanghai", "workspace": "assistant",
			"_chatCostCents": 0, "_imageCostCents": 0,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET status = 'running', stage = 'thinking' WHERE id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}
	return v2Fixture{st: st, user: user, run: run, assistantMessage: assistantMessage.ID}
}

// fakeUpstream answers OpenAI-compatible streaming requests from a script
// and records every request body.
type fakeUpstream struct {
	mu       sync.Mutex
	requests []map[string]any
	script   func(index int, body map[string]any) string
}

func (f *fakeUpstream) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		f.mu.Lock()
		index := len(f.requests)
		f.requests = append(f.requests, body)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, f.script(index, body))
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
}

func sseToolCall(id, name, arguments string) string {
	return fmt.Sprintf(`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":%q,"function":{"name":%q,"arguments":%q}}]}}]}`+"\n\n", id, name, arguments)
}

func sseText(text string) string {
	return fmt.Sprintf(`data: {"choices":[{"delta":{"content":%q}}]}`+"\n\n", text)
}

func rulesOnlySetup(prompt string) assistantV2DecisionSetup {
	rules := assistantV2Rules(prompt)
	return assistantV2DecisionSetup{Decider: decision.Chain{Fallback: rules}, Rules: rules, Thresholds: decision.DefaultThresholds}
}

func TestAssistantV2AnswersPersonalStatsFromTheMetricsTool(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "这个月钱都花哪了？")
	at := time.Now().UTC().Add(-time.Hour)
	var taskID uuid.UUID
	if err := fixture.st.Pool.QueryRow(ctx, `INSERT INTO tasks (user_id, type, status, prompt, count, output_keys, cost_cents, created_at, started_at, finished_at)
		VALUES ($1, 'ecommerce_design', 'succeeded', '主图', 1, '["a.png","b.png"]', 240, $2::timestamptz, $2::timestamptz, $2::timestamptz + interval '30 seconds') RETURNING id`,
		fixture.user.ID, at).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.st.Pool.Exec(ctx, `INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
		VALUES ($1, 'spend', -240, 0, 'task', $2, $3)`, fixture.user.ID, taskID.String(), at); err != nil {
		t.Fatal(err)
	}

	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		switch index {
		case 0:
			tools, _ := body["tools"].([]any)
			names := []string{}
			for _, raw := range tools {
				function, _ := raw.(map[string]any)["function"].(map[string]any)
				names = append(names, fmt.Sprint(function["name"]))
			}
			if strings.Join(names, ",") != "explain_charge,my_account_overview,my_orders_list,my_records_list,my_stats_query,task_status" {
				t.Errorf("exposed tools = %v", names)
			}
			messages, _ := body["messages"].([]any)
			system, _ := messages[0].(map[string]any)["content"].(string)
			if !strings.Contains(system, "每个数字都只能来自工具结果") || !strings.Contains(system, "Asia/Shanghai") {
				t.Errorf("system prompt missing v2 rules: %s", system)
			}
			return sseToolCall("call_stats", "my_stats_query",
				`{"metrics":["spend_points","images"],"dimensions":["workspace"],"timeRange":{"preset":"this_month"},"compareToPrevious":true}`)
		default:
			messages, _ := body["messages"].([]any)
			last, _ := messages[len(messages)-1].(map[string]any)
			content, _ := last["content"].(string)
			if last["role"] != "tool" || !strings.Contains(content, `"spend_points":240`) {
				t.Errorf("tool observation = %#v", last)
			}
			return sseText("本月共消耗 240 积分，全部用在 AI 电商。")
		}
	}}
	server := upstream.server(t)
	defer server.Close()
	client, err := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	if err != nil {
		t.Fatal(err)
	}

	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client, rulesOnlySetup(fixture.run.Prompt)); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	if len(upstream.requests) != 2 {
		t.Fatalf("upstream requests = %d", len(upstream.requests))
	}
	message, err := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if err != nil {
		t.Fatal(err)
	}
	if message.Status != "complete" || !strings.Contains(message.Content, "240") {
		t.Fatalf("message = %+v", message)
	}
	if message.Metadata["engine"] != AssistantEngineV2 {
		t.Fatalf("engine metadata = %#v", message.Metadata["engine"])
	}
	decided, _ := message.Metadata["_decision"].(map[string]any)
	if decided["intent"] != assistantV2IntentMyData || decided["provider"] != "rules" {
		t.Fatalf("decision = %#v", decided)
	}
	views, _ := message.Metadata["dataViews"].([]any)
	if len(views) != 1 {
		t.Fatalf("dataViews = %#v", message.Metadata["dataViews"])
	}
	view, _ := views[0].(map[string]any)
	data, _ := view["data"].(map[string]any)
	totals, _ := data["totals"].(map[string]any)
	if view["view"] != "stats" || totals["spend_points"] != float64(240) || totals["images"] != float64(2) {
		t.Fatalf("view = %#v", view)
	}
	steps, _ := message.Metadata["toolSteps"].([]any)
	if len(steps) != 1 {
		t.Fatalf("toolSteps = %#v", message.Metadata["toolSteps"])
	}
	run, err := store.GetAssistantRun(ctx, fixture.st.Pool, fixture.run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "succeeded" {
		t.Fatalf("run status = %s", run.Status)
	}
}

func TestAssistantV2ScopesStatsToTheRunOwner(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "我花了多少积分")
	other, err := store.InsertUser(ctx, fixture.st.Pool, "other-"+uuid.NewString()+"@test.dev", "other", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.st.Pool.Exec(ctx, `INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
		VALUES ($1, 'spend', -999, 0, 'task', $2, now() - interval '1 hour')`, other.ID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		if index == 0 {
			// Even if a model tried to smuggle a user id, the schema has no
			// such field and the tool ignores unknown input.
			return sseToolCall("call_1", "my_stats_query", `{"metrics":["spend_points"],"timeRange":{"preset":"all_time"}}`)
		}
		messages, _ := body["messages"].([]any)
		last, _ := messages[len(messages)-1].(map[string]any)
		content, _ := last["content"].(string)
		if strings.Contains(content, "999") {
			t.Errorf("another user's spend leaked into the observation: %s", content)
		}
		return sseText("你目前没有消耗记录。")
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client, rulesOnlySetup(fixture.run.Prompt)); err != nil {
		t.Fatalf("run v2: %v", err)
	}
}

func TestAssistantV2ClarifiesWithoutToolsWhenDecisionSaysSo(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "帮我弄一下")
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		if _, hasTools := body["tools"]; hasTools {
			t.Error("a clarification turn must not expose tools")
		}
		messages, _ := body["messages"].([]any)
		system, _ := messages[0].(map[string]any)["content"].(string)
		if !strings.Contains(system, "只问一个最关键的问题") {
			t.Errorf("system prompt missing clarification hint")
		}
		return sseText("你想处理哪一类事情？")
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	decider := decision.Rules{
		"intent":  decision.Fixed(decision.Answer{Choice: assistantV2IntentAnswer, Confidence: 0.9}),
		"clarify": decision.Fixed(decision.Answer{Yes: 0.95, Confidence: 0.9}),
	}
	worker := &Worker{St: fixture.st}
	setup := assistantV2DecisionSetup{Decider: decider, Thresholds: decision.DefaultThresholds}
	if err := worker.runAssistantV2(ctx, fixture.run, client, setup); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	if len(upstream.requests) != 1 {
		t.Fatalf("requests = %d", len(upstream.requests))
	}
}

func TestAssistantV2RulesRouteUnsupportedTurnsToTheOriginalEngine(t *testing.T) {
	cases := map[string]string{
		"请联网搜索今天的科技新闻":   assistantV2IntentWeb,
		"帮我生成一张猫咪海报":     assistantV2IntentCreate,
		"导出交付包":          assistantV2IntentWorkspace,
		"这个月积分花哪了":       assistantV2IntentMyData,
		"物联网设备怎么配网":      assistantV2IntentAnswer,
		"帮我写一段 618 商品文案": assistantV2IntentAnswer,
	}
	for prompt, want := range cases {
		response, err := assistantV2Rules(prompt).Decide(context.Background(), decision.Request{State: "用户：" + prompt, Questions: assistantV2DecisionQuestions()})
		if err != nil {
			t.Fatalf("%s: %v", prompt, err)
		}
		if got := response.Answers["intent"].Choice; got != want {
			t.Fatalf("%s: intent = %s, want %s", prompt, got, want)
		}
		delegates := want == assistantV2IntentWeb || want == assistantV2IntentCreate || want == assistantV2IntentWorkspace
		if assistantV2DelegatesIntent(want) != delegates {
			t.Fatalf("%s: delegation mismatch", prompt)
		}
	}
}

type fixedDecider struct{ response decision.Response }

func (f fixedDecider) Name() string { return f.response.Provider }
func (f fixedDecider) Decide(context.Context, decision.Request) (decision.Response, error) {
	return f.response, nil
}

func TestAssistantV2LowConfidenceDefersToRulesAndIsLogged(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "这个月积分花哪了")
	model := fixedDecider{response: decision.Response{Provider: "llm", Model: "decider-model", Answers: map[string]decision.Answer{
		"intent":  {Kind: decision.KindChoice, Choice: assistantV2IntentAnswer, Confidence: 0.3},
		"clarify": {Kind: decision.KindYesNo, Yes: 0.1},
	}}}
	setup := assistantV2DecisionSetup{Decider: model, Rules: assistantV2Rules(fixture.run.Prompt),
		Thresholds: decision.Thresholds{Intent: 0.6, Clarify: 0.75}}
	worker := &Worker{St: fixture.st}
	decided := worker.assistantV2Decide(ctx, setup, "用户：这个月积分花哪了")
	if decided.Intent != assistantV2IntentMyData || !decided.LowConfidence || decided.RulesIntent != assistantV2IntentMyData {
		t.Fatalf("decided = %+v", decided)
	}
	worker.recordAssistantV2Decision(ctx, fixture.run, decided, false)
	stats, err := store.GetAssistantDecisionStats(ctx, fixture.st.Pool, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 1 || stats.ModelAnswered != 1 || stats.LowConfidence != 1 || len(stats.ByModel) != 1 || stats.ByModel[0].Model != "decider-model" {
		t.Fatalf("stats = %+v", stats)
	}

	// A confident model answer is kept even when the rules disagree.
	model.response.Answers["intent"] = decision.Answer{Kind: decision.KindChoice, Choice: assistantV2IntentCreate, Confidence: 0.9}
	setup.Decider = model
	decided = worker.assistantV2Decide(ctx, setup, "用户：这个月积分花哪了")
	if decided.Intent != assistantV2IntentCreate || decided.LowConfidence {
		t.Fatalf("confident decision overridden: %+v", decided)
	}
}

func TestAssistantV2HandOverCarriesTheJudgmentToTheOriginalEngine(t *testing.T) {
	run := &store.AssistantRun{ID: uuid.New(), Mode: "chat", Prompt: "帮我做一张海报", Params: map[string]any{"_engine": AssistantEngineV2}}
	handed := assistantV2HandOver(run, assistantV2Decision{Intent: assistantV2IntentCreate, Confidence: 0.9, Thresholds: decision.DefaultThresholds})
	if handed.Mode != "agent" || run.Mode != "chat" {
		t.Fatalf("hand-over must run as Agent without mutating the stored run: handed=%s original=%s", handed.Mode, run.Mode)
	}
	if handed.Params[assistantV2IntentParam] != assistantV2IntentCreate || handed.Params[assistantV2ConfidentParam] != "true" {
		t.Fatalf("params = %#v", handed.Params)
	}
	if _, leaked := run.Params[assistantV2IntentParam]; leaked {
		t.Fatal("hand-over params leaked into the original run")
	}
	w := &Worker{}
	decide := w.classifyAssistantIntentAsync(context.Background(), nil, handed, nil, false, false, false)
	if got := decide(); got.intent != "image" || !got.confident || got.fromFastPath {
		t.Fatalf("original engine ignored v2's judgment: %+v", got)
	}
	web := assistantV2HandOver(run, assistantV2Decision{Intent: assistantV2IntentWeb, Confidence: 0.2, Thresholds: decision.DefaultThresholds})
	if got := w.classifyAssistantIntentAsync(context.Background(), nil, web, nil, false, false, false)(); got.intent != "chat" || got.confident {
		t.Fatalf("web hand-over = %+v", got)
	}
}

func TestAssistantV2DecisionStateMentionsAttachments(t *testing.T) {
	run := &store.AssistantRun{UserMessageID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "把背景换成白色"}
	if state := assistantV2DecisionState(nil, run, 1, 0); !strings.Contains(state, "1 张参考图") {
		t.Fatalf("state = %q", state)
	}
	if state := assistantV2DecisionState(nil, run, 0, 0); strings.Contains(state, "参考图") {
		t.Fatalf("state = %q", state)
	}
}

func TestAssistantV2ReadsAttachedDocumentsWithFileTools(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "预算是多少？")
	fileID := uuid.New()
	key := "uploads/" + fixture.user.ID.String() + "/original/" + fileID.String() + ".txt"
	if err := store.RegisterUserUploadObjects(ctx, fixture.st.Pool, fixture.user.ID, []string{key}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertAssistantFile(ctx, fixture.st.Pool, store.AssistantFile{
		ID: fileID, UserID: fixture.user.ID, ObjectKey: key, Name: "项目说明.txt", ContentType: "text/plain",
		SizeBytes: 64, SHA256: "hash", CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.st.Pool.Exec(ctx, `UPDATE assistant_files SET status = 'ready', segment_count = 1, char_count = 16 WHERE id = $1`, fileID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.st.Pool.Exec(ctx, `INSERT INTO assistant_file_segments (file_id, ordinal, locator, content)
		VALUES ($1, 0, '{"page":1}', '项目预算是 120 万元。')`, fileID); err != nil {
		t.Fatal(err)
	}
	fixture.run.Params["_assistantFileIds"] = []any{fileID.String()}
	fixture.run.Params["skill"] = "document_analysis"

	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		if index == 0 {
			tools, _ := body["tools"].([]any)
			names := []string{}
			for _, raw := range tools {
				function, _ := raw.(map[string]any)["function"].(map[string]any)
				names = append(names, fmt.Sprint(function["name"]))
			}
			if !strings.Contains(strings.Join(names, ","), "files_search") {
				t.Errorf("file tools not exposed: %v", names)
			}
			return sseToolCall("call_search", "files_search", `{"query":"预算","limit":5}`)
		}
		messages, _ := body["messages"].([]any)
		last, _ := messages[len(messages)-1].(map[string]any)
		if content, _ := last["content"].(string); !strings.Contains(content, "120 万元") {
			t.Errorf("document evidence missing from observation: %v", last)
		}
		return sseText("根据项目说明.txt 第 1 页，预算为 120 万元。")
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client, rulesOnlySetup(fixture.run.Prompt)); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	message, _ := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if !strings.Contains(message.Content, "120 万元") {
		t.Fatalf("content = %q", message.Content)
	}
}
