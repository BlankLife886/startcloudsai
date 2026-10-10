package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAssistantImageToPSDRoutesToEditableFileWithoutChatModel(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "assistant-psd-"+uuid.NewString()+"@test.dev", "psd", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "PSD", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "把这张图片转换为 PSD",
		Kind: "chat", Status: "complete", CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "agent", Status: "queued",
		CreatedAt: time.Now().UTC().Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}

	sourceImage := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	sourceImage.SetNRGBA(0, 0, color.NRGBA{R: 240, G: 10, B: 20, A: 80})
	sourceImage.SetNRGBA(1, 0, color.NRGBA{R: 30, G: 220, B: 40, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, sourceImage); err != nil {
		t.Fatal(err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "agent", Prompt: userMessage.Content, ReservedCents: 0,
		Params: map[string]any{
			"referenceImages": []any{map[string]any{"name": "透明徽标.png", "dataUrl": dataURL}},
			"_chatCostCents":  0, "_imageCostCents": 0, "workspace": "assistant",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET status = 'running', stage = 'thinking' WHERE id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}

	worker := &Worker{St: st}
	err = worker.executeAssistantRun(ctx, run)
	if err == nil || !strings.Contains(err.Error(), "可编辑文件存储不可用") {
		t.Fatalf("PSD conversion error = %v", err)
	}
	persisted, err := store.GetAssistantMessage(ctx, st.Pool, assistantMessage.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := persisted.Metadata["artifacts"]; ok || persisted.Content != "" {
		t.Fatalf("persisted message=%#v", persisted)
	}
}
