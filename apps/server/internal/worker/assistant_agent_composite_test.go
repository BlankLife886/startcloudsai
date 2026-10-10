package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func writeAssistantAgentToolCall(t *testing.T, w http.ResponseWriter, id, name, arguments string) {
	t.Helper()
	event, err := json.Marshal(map[string]any{
		"choices": []any{map[string]any{
			"delta": map[string]any{"tool_calls": []any{map[string]any{
				"index": 0,
				"id":    id,
				"function": map[string]any{
					"name": name, "arguments": arguments,
				},
			}}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(w, "data: %s\n\n", event)
	fmt.Fprint(w, "data: [DONE]\n\n")
}

func assistantAgentRequestHasStrictTool(body map[string]any, name string) bool {
	tools, _ := body["tools"].([]any)
	for _, raw := range tools {
		tool, _ := raw.(map[string]any)
		function, _ := tool["function"].(map[string]any)
		if function["name"] == name && function["strict"] == true {
			return true
		}
	}
	return false
}

func TestAssistantAgentCompositeWebSearchCreatesPPTXAndFinalizesTrace(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)

	var uploaded []byte
	objectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || !strings.HasPrefix(r.URL.Path, "/test-bucket/uploads/") {
			http.Error(w, "unexpected object request", http.StatusBadRequest)
			return
		}
		data, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		uploaded = append([]byte(nil), data...)
		w.Header().Set("ETag", `"test"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer objectServer.Close()
	objectStorage, err := storage.New(&config.Config{
		ObjectStorageEndpoint: objectServer.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test",
		ObjectStorageBucket: "test-bucket", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300,
	})
	if err != nil {
		t.Fatal(err)
	}

	searchArguments := `{"query":"latest AI releases","recencyDays":30,"allowedDomains":[]}`
	deckContent, err := json.Marshal(map[string]any{
		"title": "最新 AI 发布", "subtitle": "联网资料摘要",
		"slides": []map[string]any{{
			"title":   "官方发布",
			"bullets": []string{"Official release is current.", "来源：https://example.com/latest"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	artifactArguments, err := json.Marshal(map[string]any{
		"name": "latest-ai.pptx", "format": "pptx", "content": string(deckContent),
	})
	if err != nil {
		t.Fatal(err)
	}
	requestOrder := make([]string, 0, 4)
	chatRequests := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/responses":
			requestOrder = append(requestOrder, "web_search")
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"output":[{"type":"web_search_call","action":{"query":"latest AI releases"}},{"type":"message","content":[{"type":"output_text","text":"Official release is current.","annotations":[{"type":"url_citation","url":"https://example.com/latest","title":"Official"}]}]}]}`)
		case "/v1/chat/completions":
			chatRequests++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				http.Error(w, "invalid request", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			switch chatRequests {
			case 1:
				requestOrder = append(requestOrder, "agent:web_search")
				choice, _ := body["tool_choice"].(map[string]any)
				function, _ := choice["function"].(map[string]any)
				if function["name"] != "web_search" || !assistantAgentRequestHasStrictTool(body, "files_create") {
					t.Errorf("first agent tool catalog/choice = %#v", body)
				}
				writeAssistantAgentToolCall(t, w, "call_search", "web_search", searchArguments)
			case 2:
				requestOrder = append(requestOrder, "agent:files_create")
				if !assistantAgentRequestHasStrictTool(body, "files_create") {
					t.Errorf("files_create missing from second tool catalog: %#v", body["tools"])
				}
				writeAssistantAgentToolCall(t, w, "call_file", "files_create", string(artifactArguments))
			case 3:
				requestOrder = append(requestOrder, "agent:final")
				messages, _ := body["messages"].([]any)
				last, _ := messages[len(messages)-1].(map[string]any)
				if last["role"] != "tool" || last["name"] != "files_create" || !strings.Contains(fmt.Sprint(last["content"]), "latest-ai.pptx") {
					t.Errorf("final agent context missing artifact result: %#v", last)
				}
				fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"已联网检索并生成可编辑 PPT，可在下方下载。"}}]}`+"\n\n")
				fmt.Fprint(w, "data: [DONE]\n\n")
			default:
				t.Errorf("unexpected chat request %d", chatRequests)
				http.Error(w, "unexpected request", http.StatusBadRequest)
			}
		default:
			http.Error(w, "unexpected provider path", http.StatusNotFound)
		}
	}))
	defer provider.Close()

	user, err := store.InsertUser(ctx, st.Pool, "assistant-composite-"+uuid.NewString()+"@test.dev", "composite", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "Composite", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	prompt := "请联网搜索最新 AI 发布资料并生成可编辑 PPT"
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: prompt,
		Kind: "chat", Status: "complete", CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "agent", Status: "running",
		CreatedAt: time.Now().UTC().Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "agent", Prompt: prompt, ReservedCents: 0,
		Params: map[string]any{"workspace": "assistant", "_chatCostCents": 0},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET status='running', stage='thinking' WHERE id=$1`, run.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertAssistantAgentExecutionTrace(ctx, st.Pool, run.ID, user.ID, "gpt-test", "", json.RawMessage(`{}`), json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	worker := &Worker{
		St: st, Storage: objectStorage,
		Cfg: &config.Config{
			AppSecret: "test", Sub2APIBaseURL: provider.URL, Sub2APIAPIKey: "test-key",
			Sub2APIChatModel: "gpt-test", Sub2APIImageModel: "image-test", Sub2APITimeoutSecs: 30,
		},
	}
	if err := worker.executeAssistantRun(ctx, run); err != nil {
		t.Fatal(err)
	}

	if want := []string{"agent:web_search", "web_search", "agent:files_create", "agent:final"}; !reflect.DeepEqual(requestOrder, want) {
		t.Fatalf("request order = %#v, want %#v", requestOrder, want)
	}
	if !bytes.HasPrefix(uploaded, []byte{'P', 'K', 3, 4}) {
		t.Fatalf("uploaded PPTX header = %q", uploaded[:min(len(uploaded), 16)])
	}
	persisted, err := store.GetAssistantMessage(ctx, st.Pool, assistantMessage.ID)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, _ := persisted.Metadata["artifacts"].([]any)
	searches, _ := persisted.Metadata["webSearches"].([]any)
	var artifact map[string]any
	if len(artifacts) > 0 {
		artifact, _ = artifacts[0].(map[string]any)
	}
	if persisted.Status != "complete" || persisted.Content != "已联网检索并生成可编辑 PPT，可在下方下载。" ||
		len(artifacts) != 1 || artifact["format"] != "pptx" || len(searches) != 1 {
		t.Fatalf("persisted composite message = %#v", persisted)
	}

	var traceID uuid.UUID
	var traceStatus string
	var goalContract json.RawMessage
	if err := st.Pool.QueryRow(ctx, `SELECT id,status,goal_contract FROM agent_execution_traces WHERE run_id=$1`, run.ID).
		Scan(&traceID, &traceStatus, &goalContract); err != nil {
		t.Fatal(err)
	}
	steps, err := store.ListAgentToolSteps(ctx, st.Pool, traceID)
	if err != nil {
		t.Fatal(err)
	}
	if traceStatus != "succeeded" || len(steps) != 2 || steps[0].ToolName != "web_search" || steps[0].Status != "succeeded" ||
		steps[1].ToolName != "files_create" || steps[1].Status != "succeeded" {
		t.Fatalf("trace status=%q steps=%#v", traceStatus, steps)
	}
	var goal assistantGoalContract
	if err := json.Unmarshal(goalContract, &goal); err != nil {
		t.Fatal(err)
	}
	if !goal.WebSearchRequested || goal.WebSearchCount != 1 || !goal.ArtifactRequested || goal.ArtifactCount != 1 {
		t.Fatalf("goal contract = %#v", goal)
	}
}
