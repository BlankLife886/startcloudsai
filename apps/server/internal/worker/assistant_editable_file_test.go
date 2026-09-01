package worker

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
)

func testPPTXBytes(t *testing.T) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	for _, name := range []string{"[Content_Types].xml", "ppt/presentation.xml"} {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write([]byte("content"))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func testZipBytes(t *testing.T) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zip.NewWriter(&out)
	entry, err := w.Create("assets/cover.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = entry.Write([]byte("asset"))
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestValidEditablePrimary(t *testing.T) {
	if err := validEditablePrimary("ppt", testPPTXBytes(t)); err != nil {
		t.Fatalf("valid PPTX rejected: %v", err)
	}
	psd := append([]byte("8BPS"), make([]byte, 22)...)
	if err := validEditablePrimary("psd", psd); err != nil {
		t.Fatalf("valid PSD rejected: %v", err)
	}
	if err := validEditablePrimary("ppt", []byte("not a pptx")); err == nil {
		t.Fatal("invalid PPTX accepted")
	}
	if err := validEditablePrimary("psd", []byte("not a psd")); err == nil {
		t.Fatal("invalid PSD accepted")
	}
}

func TestEditableFileDetectionDoesNotStealQuestions(t *testing.T) {
	if got := assistanttools.EditableFileKindRequested("PPT 和普通文档有什么区别？"); got != "" {
		t.Fatalf("question routed as %q", got)
	}
	if got := assistanttools.EditableFileKindRequested("制作一份品牌介绍 PPT"); got != "ppt" {
		t.Fatalf("PPT request routed as %q", got)
	}
}

func TestExecuteAssistantEditableFileStoresPPTXAndAssets(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "editable-ppt-"+uuid.NewString()+"@test.dev", "ppt", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "PPT", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "制作一份产品 PPT", Kind: "chat", Status: "complete", CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "chat", Status: "queued", CreatedAt: time.Now().UTC().Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID, UserMessageID: userMessage.ID,
		AssistantMessageID: assistantMessage.ID, Mode: "chat", Prompt: userMessage.Content, ReservedCents: 0,
		Params: map[string]any{"_chatCostCents": 0, "workspace": "assistant"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET status = 'running', stage = 'thinking' WHERE id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}

	pptxData := testPPTXBytes(t)
	zipData := testZipBytes(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/editable-file-tasks":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				http.Error(w, "invalid", http.StatusBadRequest)
				return
			}
			if body["client_task_id"] != run.ID.String() || body["kind"] != "ppt" {
				t.Errorf("submit payload = %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": run.ID.String(), "status": "success", "kind": "ppt",
				"result": map[string]any{"primary_url": "/files/deck.pptx", "zip_url": "/files/assets.zip"},
			})
		case "/files/deck.pptx":
			w.Header().Set("Content-Disposition", `attachment; filename="product.pptx"`)
			_, _ = w.Write(pptxData)
		case "/files/assets.zip":
			w.Header().Set("Content-Disposition", `attachment; filename="product-assets.zip"`)
			_, _ = w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()

	var uploaded [][]byte
	objectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || !strings.HasPrefix(r.URL.Path, "/test-bucket/uploads/") {
			http.Error(w, "unexpected object request", http.StatusBadRequest)
			return
		}
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			http.Error(w, "read failed", http.StatusInternalServerError)
			return
		}
		uploaded = append(uploaded, data)
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
	const masterKey = "editable-file-test-master-key"
	encryptedKey, err := settings.EncryptSecret("secret", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := modelconfig.Save(ctx, st.Pool, modelconfig.Config{
		Version: modelconfig.Version,
		Providers: []modelconfig.Provider{{
			ID: "editable-provider", Name: "Editable Provider", Adapter: modelconfig.AdapterOpenAI, Enabled: true,
			Routes: []modelconfig.ProviderRoute{{
				ID: "editable-route", Name: "Editable Route", BaseURL: provider.URL,
				APIKey: encryptedKey, MaxConcurrency: 2, Enabled: true,
			}},
		}},
		EditableFiles: modelconfig.EditableFileConfig{
			Enabled: true, ProviderID: "editable-provider", RouteID: "editable-route",
		},
	}); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{AppEnv: "development", AppSecret: masterKey, C2ABaseURL: provider.URL, C2AAPIKey: "secret", C2ATimeoutSecs: 30}
	worker := &Worker{Cfg: cfg, St: st, Storage: objectStorage, C2A: c2a.NewWithPolicy(provider.URL, "secret", 30, true)}
	if err := worker.executeAssistantEditableFile(ctx, run, nil, "ppt"); err != nil {
		t.Fatal(err)
	}
	if len(uploaded) != 2 || !bytes.Equal(uploaded[0], pptxData) || !bytes.Equal(uploaded[1], zipData) {
		t.Fatalf("uploaded files = %d", len(uploaded))
	}
	persisted, err := store.GetAssistantMessage(ctx, st.Pool, assistantMessage.ID)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, _ := persisted.Metadata["artifacts"].([]any)
	if persisted.Status != "complete" || len(artifacts) != 2 || !strings.Contains(persisted.Content, "可编辑 PPT") {
		t.Fatalf("persisted message = %#v", persisted)
	}
}
