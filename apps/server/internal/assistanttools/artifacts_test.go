package assistanttools

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantfiles"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

type artifactMemoryStorage struct {
	key         string
	contentType string
	data        []byte
}

func TestPrepareArtifactBuildsDeterministicPPTX(t *testing.T) {
	content := `{"title":"儿童安全知识大闯关","subtitle":"电梯安全与防溺水","slides":[{"title":"安全乘梯","bullets":["不倚靠电梯门","遇到故障按下求助按钮"]},{"title":"远离危险水域","bullets":["不独自下水","发现同伴落水先呼救"]}]}`
	name, contentType, data, err := prepareArtifact(artifactInput{Name: "安全课堂.ppt", Format: "pptx", Content: content})
	if err != nil {
		t.Fatal(err)
	}
	if name != "安全课堂.pptx" || contentType != "application/vnd.openxmlformats-officedocument.presentationml.presentation" || !bytes.HasPrefix(data, []byte{'P', 'K', 3, 4}) {
		t.Fatalf("name=%q contentType=%q bytes=%d", name, contentType, len(data))
	}
	_, _, repeated, err := prepareArtifact(artifactInput{Name: "安全课堂.ppt", Format: "pptx", Content: content})
	if err != nil || !bytes.Equal(data, repeated) {
		t.Fatalf("PPTX output must be deterministic: equal=%t err=%v", bytes.Equal(data, repeated), err)
	}
	if output := os.Getenv("ASSISTANT_PPTX_QA_OUTPUT"); output != "" {
		if err := os.WriteFile(output, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	format, err := assistantfiles.Detect(name, data)
	if err != nil {
		t.Fatal(err)
	}
	document, err := assistantfiles.Parse(format, data)
	if err != nil || document.PageCount != 3 || len(document.Segments) != 3 ||
		!strings.Contains(document.Segments[0].Content, "儿童安全") ||
		!strings.Contains(document.Segments[2].Content, "远离危险水域") {
		t.Fatalf("parsed PPTX = %#v err=%v", document, err)
	}
}

func TestGeneratedPPTXOpensInLibreOffice(t *testing.T) {
	soffice, err := exec.LookPath("soffice")
	if err != nil {
		t.Skip("LibreOffice is not installed")
	}
	data, err := buildPPTX([]byte(`{"title":"安全知识课堂","subtitle":"适合 6-12 岁儿童","slides":[{"title":"乘坐电梯要记住三件事","bullets":["不倚靠电梯门，不在轿厢内跳跃","遇到故障保持冷静，按下求助按钮","听从工作人员指引，不强行扒门"]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	input := filepath.Join(dir, "qa.pptx")
	if err := os.WriteFile(input, data, 0o600); err != nil {
		t.Fatal(err)
	}
	profile := filepath.Join(dir, "libreoffice-profile")
	command := exec.Command(soffice, "--headless", "-env:UserInstallation=file://"+profile,
		"--convert-to", "pdf", "--outdir", dir, input)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("LibreOffice could not open generated PPTX: %v: %s", err, output)
	}
	if info, err := os.Stat(filepath.Join(dir, "qa.pdf")); err != nil || info.Size() == 0 {
		t.Fatalf("LibreOffice did not produce a PDF: info=%v err=%v", info, err)
	}
}

func TestPrepareArtifactRejectsUnsafePPTXShape(t *testing.T) {
	for _, content := range []string{
		`{"title":"","slides":[{"title":"x","bullets":[]}]}`,
		`{"title":"x","slides":[]}`,
		`{"title":"x","slides":[{"title":"x","bullets":[],"script":"run"}]}`,
	} {
		if _, _, _, err := prepareArtifact(artifactInput{Name: "bad.pptx", Format: "pptx", Content: content}); err == nil {
			t.Fatalf("unsafe PPTX shape should fail: %s", content)
		}
	}
	dense, err := json.Marshal(pptxDeck{
		Title: "x",
		Slides: []pptxSlide{{
			Title:   "x",
			Bullets: []string{strings.Repeat("内容", 80), strings.Repeat("内容", 80), strings.Repeat("内容", 80)},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := prepareArtifact(artifactInput{Name: "dense.pptx", Format: "pptx", Content: string(dense)}); err == nil || !strings.Contains(err.Error(), "too much text") {
		t.Fatalf("dense PPTX should be rejected with a layout error: %v", err)
	}
}

func (s *artifactMemoryStorage) UploadBytes(_ context.Context, key string, data []byte, contentType string) error {
	s.key = key
	s.contentType = contentType
	s.data = append([]byte(nil), data...)
	return nil
}

func (s *artifactMemoryStorage) DeleteKeys(_ context.Context, _ []string) error { return nil }

func TestPrepareArtifactValidatesFormatsAndNeutralizesCSVFormulas(t *testing.T) {
	name, contentType, data, err := prepareArtifact(artifactInput{
		Name: "../季度报表.exe", Format: "csv", Content: "name,value\nrow,=1+1\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	if name != "季度报表.csv" || contentType != "text/csv; charset=utf-8" || !strings.Contains(string(data), "'=1+1") {
		t.Fatalf("name=%q contentType=%q data=%q", name, contentType, data)
	}
	if _, _, _, err := prepareArtifact(artifactInput{Name: "bad.json", Format: "json", Content: "{"}); err == nil {
		t.Fatal("invalid JSON must be rejected")
	}
}

func TestArtifactCreateExecutorStoresOwnedDownload(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "artifact-"+uuid.NewString()+"@test.dev", "artifact", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "artifact", time.Now().UTC())
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
	storage := &artifactMemoryStorage{}
	raw, _ := json.Marshal(artifactInput{Name: "result", Format: "json", Content: `{"ok":true}`})
	runID := uuid.New()
	result, err := artifactCreateExecutor(st, storage)(ctx, Invocation{
		UserID: user.ID, RunID: runID, AssistantMessageID: message.ID, Arguments: raw,
	})
	if err != nil {
		t.Fatal(err)
	}
	artifact, ok := result.Meta["artifact"].(map[string]any)
	if !ok || artifact["name"] != "result.json" || !strings.Contains(artifact["downloadUrl"].(string), "download=1") {
		t.Fatalf("artifact = %#v", artifact)
	}
	if storage.key == "" || string(storage.data) != `{"ok":true}` || storage.contentType != "application/json; charset=utf-8" {
		t.Fatalf("stored key=%q contentType=%q data=%q", storage.key, storage.contentType, storage.data)
	}
	live, err := store.HasLiveUserUploadObject(ctx, st.Pool, user.ID, storage.key)
	if err != nil || !live {
		t.Fatalf("live=%t err=%v", live, err)
	}
	if _, err := artifactCreateExecutor(st, storage)(ctx, Invocation{
		UserID: user.ID, RunID: runID, AssistantMessageID: message.ID, Arguments: raw,
	}); err != nil {
		t.Fatal(err)
	}
	persisted, err := store.GetAssistantMessage(ctx, st.Pool, message.ID)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, ok := persisted.Metadata["artifacts"].([]any)
	if !ok || len(artifacts) != 1 {
		t.Fatalf("persisted artifacts = %#v", persisted.Metadata["artifacts"])
	}
}
