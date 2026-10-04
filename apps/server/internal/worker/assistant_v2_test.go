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
			// One agent, every tool the mode allows: image proposals and web
			// search sit next to the platform tools, and nothing routes.
			joined := "," + strings.Join(names, ",") + ","
			for _, want := range []string{"propose_image_action", "web_search", "task_status", "my_stats_query", "my_records_list", "my_account_overview", "explain_charge", "assets_search", "memory_save"} {
				if !strings.Contains(joined, ","+want+",") {
					t.Errorf("tool %s not offered: %v", want, names)
				}
			}
			if strings.Contains(joined, ",hand_over,") {
				t.Errorf("hand_over must be gone: %v", names)
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
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
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
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
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
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	message, _ := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if !strings.Contains(message.Content, "120 万元") {
		t.Fatalf("content = %q", message.Content)
	}
}

// v2ModeRun switches the fixture's run to a mode the user picked.
func v2ModeRun(t *testing.T, fixture v2Fixture, mode string) {
	t.Helper()
	if _, err := fixture.st.Pool.Exec(context.Background(), `UPDATE assistant_runs SET mode = $2 WHERE id = $1`, fixture.run.ID, mode); err != nil {
		t.Fatal(err)
	}
	fixture.run.Mode = mode
}

// "你可以做图吗" in Agent mode: the model has the image tool but only answers.
// The answer goes out as chat; nothing is proposed from the user's words, and
// there is exactly one upstream call (no separate classifier).
func TestAssistantV2AgentAnswersCapabilityQuestionsWithoutProposing(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "你可以做图吗")
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		if !strings.Contains(v2ToolNames(body), "propose_image_action") {
			t.Errorf("Agent mode must offer the image tool: %s", v2ToolNames(body))
		}
		if !strings.Contains(v2SystemPrompt(body), "只问能不能做") {
			t.Errorf("image rule missing from the prompt")
		}
		return sseText("可以。告诉我你想画什么，比如主体、风格和尺寸。")
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	if len(upstream.requests) != 1 {
		t.Fatalf("upstream requests = %d, want 1", len(upstream.requests))
	}
	message, _ := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if message.Kind == "proposal" || message.Metadata["proposal"] != nil || !strings.Contains(message.Content, "告诉我你想画什么") {
		t.Fatalf("message = %+v", message)
	}
	if message.Metadata["engine"] != AssistantEngineV2 {
		t.Fatalf("engine = %#v", message.Metadata["engine"])
	}
}

// Agent mode: when the user says what to draw, the same loop proposes it.
func TestAssistantV2AgentProposesImagesInTheSameLoop(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "画一只戴帽子的柴犬")
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		return sseToolCall("call_img", "propose_image_action",
			`{"action":"generate","prompt":"一只戴红色毛线帽的柴犬","promptMode":"enhanced","count":1}`)
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	message, _ := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	proposal, _ := message.Metadata["proposal"].(map[string]any)
	if message.Kind != "proposal" || !strings.Contains(fmt.Sprint(proposal["prompt"]), "柴犬") {
		t.Fatalf("message = %+v", message)
	}
	if message.Metadata["engine"] != AssistantEngineV2 {
		t.Fatalf("engine = %#v", message.Metadata["engine"])
	}
}

// 问答 mode only answers: no image, set or site tools are offered at all, so
// no judgment can turn a question into a paid image.
func TestAssistantV2ChatModeOffersNoImageOrSiteTools(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "画一只猫")
	v2ModeRun(t, fixture, "chat")
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		names := "," + v2ToolNames(body) + ","
		for _, banned := range []string{"propose_image_action", "media_action", "send_to_workspace", "delivery_export", "commerce_set_plan"} {
			if strings.Contains(names, ","+banned+",") {
				t.Errorf("问答 mode offered %s: %s", banned, names)
			}
		}
		for _, kept := range []string{"web_search", "my_stats_query"} {
			if !strings.Contains(names, ","+kept+",") {
				t.Errorf("问答 mode should keep %s: %s", kept, names)
			}
		}
		if !strings.Contains(v2SystemPrompt(body), "当前是问答模式") {
			t.Errorf("system prompt missing the 问答 mode rule")
		}
		return sseText("问答模式不能出图，切换到 Agent 模式或图片模式就可以画。")
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	message, _ := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if message.Kind == "proposal" || message.Metadata["proposal"] != nil {
		t.Fatalf("message = %+v", message)
	}
}

// 问答 mode: even a model that writes a plan as JSON gets no proposal.
func TestAssistantV2ChatModeNeverTurnsTextIntoAProposal(t *testing.T) {
	ctx := context.Background()
	fixture := newV2Fixture(t, "画一只猫")
	v2ModeRun(t, fixture, "chat")
	upstream := &fakeUpstream{script: func(index int, body map[string]any) string {
		return sseText(`{"action":"generate","prompt":"一只猫"}`)
	}}
	server := upstream.server(t)
	defer server.Close()
	client, _ := sub2api.New(server.URL, "test-key", "gpt-test", "", 30)
	worker := &Worker{St: fixture.st}
	if err := worker.runAssistantV2(ctx, fixture.run, client); err != nil {
		t.Fatalf("run v2: %v", err)
	}
	message, _ := store.GetAssistantMessage(ctx, fixture.st.Pool, fixture.assistantMessage)
	if message.Kind == "proposal" || message.Metadata["proposal"] != nil {
		t.Fatalf("message = %+v", message)
	}
}

func TestAppendAssistantDataViewKeepsOneCardPerCommerceSet(t *testing.T) {
	views := appendAssistantDataView(nil, map[string]any{"view": "commerce_set", "tool": "commerce_set_plan", "data": map[string]any{"id": "set-1", "status": "planned"}})
	views = appendAssistantDataView(views, map[string]any{"view": "stats", "data": map[string]any{}})
	views = appendAssistantDataView(views, map[string]any{"view": "commerce_set", "tool": "commerce_set_generate", "data": map[string]any{"id": "set-1", "status": "generating"}})
	views = appendAssistantDataView(views, map[string]any{"view": "commerce_set", "data": map[string]any{"id": "set-2"}})
	if len(views) != 3 || views[0]["tool"] != "commerce_set_generate" || assistantDataViewID(views[2]) != "set-2" {
		t.Fatalf("views = %#v", views)
	}
}
