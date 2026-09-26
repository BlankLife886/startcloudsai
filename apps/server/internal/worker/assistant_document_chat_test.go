package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAssistantDocumentChatRejectsFailedReadAsEvidence(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	requests := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		tools, _ := body["tools"].([]any)
		for _, rawTool := range tools {
			tool, _ := rawTool.(map[string]any)
			function, _ := tool["function"].(map[string]any)
			if function["name"] == "files_create" {
				t.Error("file creation was enabled before successfully reading evidence")
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if requests == 1 {
			fmt.Fprint(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"invalid-read","function":{"name":"files_read","arguments":"{\"file_id\":\"missing-file\"}"}}]}}]}`+"\n\n")
		} else {
			fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"An answer with no file evidence."}}]}`+"\n\n")
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()
	client, err := sub2api.New(provider.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	run := &store.AssistantRun{
		ID: uuid.New(), UserID: uuid.New(), AssistantMessageID: uuid.New(), Prompt: "Summarize the attachment and export a txt file",
		Params: map[string]any{"_assistantFileIds": []string{uuid.NewString()}, "skill": "document_analysis"},
	}
	w := &Worker{St: st}
	streamed := ""
	text, used, artifacts, _, err := w.requestAssistantDocumentText(ctx, client, run,
		[]sub2api.Message{{Role: "user", Content: run.Prompt}}, func(value, _ string) error { streamed = value; return nil })
	if err == nil || !strings.Contains(err.Error(), "without reading file evidence") || text != "" || streamed != "" || len(used) != 0 || len(artifacts) != 0 {
		t.Fatalf("requests=%d text=%q streamed=%q used=%#v artifacts=%#v err=%v", requests, text, streamed, used, artifacts, err)
	}
}

func TestAssistantDocumentChatExecutesAttachedFileSearchBeforeAnswering(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "document-chat-"+uuid.NewString()+"@test.dev", "document", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	fileID := uuid.New()
	key := "uploads/" + user.ID.String() + "/original/" + fileID.String() + ".txt"
	if err := store.RegisterUserUploadObjects(ctx, st.Pool, user.ID, []string{key}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertAssistantFile(ctx, st.Pool, store.AssistantFile{
		ID: fileID, UserID: user.ID, ObjectKey: key, Name: "项目说明.txt", ContentType: "text/plain",
		SizeBytes: 64, SHA256: "hash", CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_files SET status = 'ready', segment_count = 1, char_count = 16 WHERE id = $1`, fileID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `INSERT INTO assistant_file_segments (file_id, ordinal, locator, content)
		VALUES ($1, 0, '{"page":1}', '项目预算是 120 万元。')`, fileID); err != nil {
		t.Fatal(err)
	}

	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if requestCount == 1 {
			if body["tool_choice"] != sub2api.RequiredToolChoice {
				t.Fatalf("first tool choice = %#v", body["tool_choice"])
			}
			fmt.Fprint(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_search","function":{"name":"files_search","arguments":"{\"query\":\"预算\",\"limit\":5}"}}]}}]}`+"\n\n")
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		messages, _ := body["messages"].([]any)
		last, _ := messages[len(messages)-1].(map[string]any)
		if last["role"] != "tool" || last["tool_call_id"] != "call_search" {
			t.Fatalf("tool result message = %#v", last)
		}
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"根据 [项目说明.txt page 1]，预算为 120 万元。"}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	client, err := sub2api.New(server.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	run := &store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, Prompt: "预算是多少？",
		Params: map[string]any{"_assistantFileIds": []any{fileID.String()}, "skill": "document_analysis"},
	}
	worker := &Worker{St: st}
	streamed := ""
	text, used, artifacts, _, err := worker.requestAssistantDocumentText(ctx, client, run,
		[]sub2api.Message{{Role: "user", Content: run.Prompt}}, func(value, _ string) error {
			streamed = value
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if requestCount != 2 || len(used) != 1 || used[0] != "files_search" || len(artifacts) != 0 || text != streamed || text == "" {
		t.Fatalf("requests=%d used=%#v artifacts=%#v text=%q streamed=%q", requestCount, used, artifacts, text, streamed)
	}
}
