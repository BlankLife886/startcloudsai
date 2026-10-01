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
			if strings.Join(names, ",") != "my_records_list,my_stats_query" {
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

	decider := decision.Chain{Fallback: assistantV2Rules()}
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client, decider); err != nil {
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
	decided, _ := message.Metadata["decision"].(map[string]any)
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
	if err := worker.runAssistantV2(ctx, fixture.run, client, decision.Chain{Fallback: assistantV2Rules()}); err != nil {
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
	if err := worker.runAssistantV2(ctx, fixture.run, client, decider); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	if len(upstream.requests) != 1 {
		t.Fatalf("requests = %d", len(upstream.requests))
	}
}
