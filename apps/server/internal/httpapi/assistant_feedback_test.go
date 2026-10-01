package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAssistantMessageFeedbackPersistsAndChecksOwnership(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	ctx := context.Background()

	conversationID := uuid.New()
	if _, err := env.st.Pool.Exec(ctx, `
		INSERT INTO assistant_conversations (id, user_id, title, workspace)
		VALUES ($1, $2, '反馈测试', 'assistant')`, conversationID, user.ID); err != nil {
		t.Fatalf("insert conversation: %v", err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID:             uuid.New(),
		ConversationID: conversationID,
		Role:           "assistant",
		Content:        "这是待评价的回答",
		Kind:           "chat",
		Status:         "complete",
	})
	if err != nil {
		t.Fatalf("insert assistant message: %v", err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID:             uuid.New(),
		ConversationID: conversationID,
		Role:           "user",
		Content:        "这是用户问题",
		Kind:           "chat",
		Status:         "complete",
	})
	if err != nil {
		t.Fatalf("insert user message: %v", err)
	}

	path := "/api/v1/assistant/messages/" + assistantMessage.ID.String() + "/feedback"
	response := env.do(t, http.MethodPut, path, map[string]any{"rating": "positive"}, token)
	if response.Code != http.StatusOK {
		t.Fatalf("set positive feedback: status %d body %s", response.Code, response.Body.String())
	}
	data, _ := decode(t, response)
	if data["feedback"] != "positive" {
		t.Fatalf("feedback response = %#v", data["feedback"])
	}
	var stored string
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT metadata->>'feedback' FROM assistant_messages WHERE id = $1`,
		assistantMessage.ID,
	).Scan(&stored); err != nil {
		t.Fatalf("read stored feedback: %v", err)
	}
	if stored != "positive" {
		t.Fatalf("stored feedback = %q, want positive", stored)
	}
	if err := store.UpdateAssistantMessage(ctx, env.st.Pool, assistantMessage.ID,
		"这是流式检查点后的回答", "chat", "running", map[string]any{"statusStage": "answering", "pending": true}); err != nil {
		t.Fatalf("write streaming checkpoint: %v", err)
	}
	checkpointed, err := store.GetAssistantMessage(ctx, env.st.Pool, assistantMessage.ID)
	if err != nil || checkpointed == nil || checkpointed.Metadata["feedback"] != "positive" ||
		checkpointed.Metadata["statusStage"] != "answering" {
		t.Fatalf("checkpoint lost feedback: message=%#v err=%v", checkpointed, err)
	}

	forbidden := env.do(t, http.MethodPut, path, map[string]any{"rating": "negative"}, otherToken)
	if forbidden.Code != http.StatusNotFound {
		t.Fatalf("other user feedback: status %d body %s", forbidden.Code, forbidden.Body.String())
	}
	userMessagePath := "/api/v1/assistant/messages/" + userMessage.ID.String() + "/feedback"
	userMessageResponse := env.do(t, http.MethodPut, userMessagePath, map[string]any{"rating": "positive"}, token)
	if userMessageResponse.Code != http.StatusNotFound {
		t.Fatalf("user message feedback: status %d body %s", userMessageResponse.Code, userMessageResponse.Body.String())
	}
	invalid := env.do(t, http.MethodPut, path, map[string]any{"rating": "maybe"}, token)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid feedback: status %d body %s", invalid.Code, invalid.Body.String())
	}

	cleared := env.do(t, http.MethodPut, path, map[string]any{"rating": ""}, token)
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear feedback: status %d body %s", cleared.Code, cleared.Body.String())
	}
	clearedData, _ := decode(t, cleared)
	if _, exists := clearedData["feedback"]; exists {
		t.Fatalf("cleared response still has feedback: %#v", clearedData)
	}
}
