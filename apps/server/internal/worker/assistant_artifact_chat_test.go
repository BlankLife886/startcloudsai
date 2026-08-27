package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAssistantPPTXRequestCreatesAndPersistsDownload(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "assistant-pptx-"+uuid.NewString()+"@test.dev", "pptx", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "PPTX", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "chat", Status: "running",
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}

	var uploaded []byte
	var uploadedContentType string
	objectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || !strings.HasPrefix(r.URL.Path, "/test-bucket/uploads/") {
			http.Error(w, "unexpected object request", http.StatusBadRequest)
			return
		}
		data, readErr := io.ReadAll(r.Body)
		if readErr != nil {
			http.Error(w, readErr.Error(), http.StatusInternalServerError)
			return
		}
		uploaded = append([]byte(nil), data...)
		uploadedContentType = r.Header.Get("Content-Type")
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

	deckJSON := `{"title":"儿童安全知识","subtitle":"家庭安全教育","slides":[{"title":"安全乘梯","bullets":["不倚靠电梯门","遇到故障先求助"]}]}`
	arguments, err := json.Marshal(map[string]any{"name": "儿童安全知识", "format": "pptx", "content": deckJSON})
	if err != nil {
		t.Fatal(err)
	}
	requestCount := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if requestCount == 1 {
			if body["tool_choice"] != sub2api.RequiredToolChoice {
				t.Errorf("first tool choice = %#v", body["tool_choice"])
			}
			toolCall := map[string]any{
				"index": 0,
				"id":    "call_pptx",
				"function": map[string]any{
					"name": "files_create", "arguments": string(arguments),
				},
			}
			event, _ := json.Marshal(map[string]any{
				"choices": []any{map[string]any{
					"delta": map[string]any{"tool_calls": []any{toolCall}},
				}},
			})
			fmt.Fprintf(w, "data: %s\n\n", event)
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}
		messages, _ := body["messages"].([]any)
		last, _ := messages[len(messages)-1].(map[string]any)
		if last["role"] != "tool" || last["tool_call_id"] != "call_pptx" || !strings.Contains(fmt.Sprint(last["content"]), `"format":"pptx"`) {
			t.Errorf("tool result message = %#v", last)
		}
		fmt.Fprint(w, `data: {"choices":[{"delta":{"content":"PPT 文件已生成，可在下方下载。"}}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()
	client, err := sub2api.New(provider.URL, "test-key", "gpt-test", "image-test", 30)
	if err != nil {
		t.Fatal(err)
	}
	run := &store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, AssistantMessageID: message.ID,
		Prompt: "帮我做成PPT，输出PPT文件",
	}
	worker := &Worker{St: st, Storage: objectStorage}
	streamed := ""
	text, used, artifacts, _, err := worker.requestAssistantArtifactText(ctx, client, run,
		[]sub2api.Message{{Role: "user", Content: run.Prompt}}, func(value, _ string) error {
			streamed = value
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	if requestCount != 2 || len(used) != 1 || used[0] != "files_create" || len(artifacts) != 1 || text != streamed {
		t.Fatalf("requests=%d used=%#v artifacts=%#v text=%q streamed=%q", requestCount, used, artifacts, text, streamed)
	}
	if !bytes.HasPrefix(uploaded, []byte{'P', 'K', 3, 4}) || uploadedContentType != "application/vnd.openxmlformats-officedocument.presentationml.presentation" {
		t.Fatalf("uploaded bytes=%d contentType=%q", len(uploaded), uploadedContentType)
	}
	persisted, err := store.GetAssistantMessage(ctx, st.Pool, message.ID)
	if err != nil {
		t.Fatal(err)
	}
	persistedArtifacts, ok := persisted.Metadata["artifacts"].([]any)
	if !ok || len(persistedArtifacts) != 1 {
		t.Fatalf("persisted artifacts = %#v", persisted.Metadata["artifacts"])
	}
	persistedArtifact, _ := persistedArtifacts[0].(map[string]any)
	if persistedArtifact["format"] != "pptx" || !strings.Contains(fmt.Sprint(persistedArtifact["downloadUrl"]), "download=1") {
		t.Fatalf("persisted artifact = %#v", persistedArtifact)
	}
}
