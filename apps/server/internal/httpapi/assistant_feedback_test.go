package httpapi

import (
	"context"
	"net/http"
	"strings"
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

	// 点踩后补充原因；不支持的原因、超长说明、点赞带原因都拒绝；再点一次踩不清掉原因。
	withReasons := env.do(t, http.MethodPut, path, map[string]any{
		"rating": "negative", "reasons": []string{"wrong", "too_long", "wrong"}, "note": "数字算错了",
	}, token)
	if withReasons.Code != http.StatusOK {
		t.Fatalf("negative with reasons: status %d body %s", withReasons.Code, withReasons.Body.String())
	}
	reasonData, _ := decode(t, withReasons)
	if reasons, _ := reasonData["feedbackReasons"].([]any); len(reasons) != 2 || reasons[0] != "wrong" || reasonData["feedbackNote"] != "数字算错了" {
		t.Fatalf("reasons response = %#v / %#v", reasonData["feedbackReasons"], reasonData["feedbackNote"])
	}
	for name, body := range map[string]map[string]any{
		"unknown reason":     {"rating": "negative", "reasons": []string{"ugly"}},
		"note too long":      {"rating": "negative", "note": strings.Repeat("长", 201)},
		"reason on positive": {"rating": "positive", "reasons": []string{"wrong"}},
	} {
		if rejected := env.do(t, http.MethodPut, path, body, token); rejected.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%s: status %d body %s", name, rejected.Code, rejected.Body.String())
		}
	}
	again := env.do(t, http.MethodPut, path, map[string]any{"rating": "negative"}, token)
	againData, _ := decode(t, again)
	if againData["feedbackNote"] != "数字算错了" {
		t.Fatalf("a plain thumbs-down dropped the reasons: %#v", againData)
	}

	cleared := env.do(t, http.MethodPut, path, map[string]any{"rating": ""}, token)
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear feedback: status %d body %s", cleared.Code, cleared.Body.String())
	}
	clearedData, _ := decode(t, cleared)
	if _, exists := clearedData["feedback"]; exists {
		t.Fatalf("cleared response still has feedback: %#v", clearedData)
	}
	if _, exists := clearedData["feedbackReasons"]; exists {
		t.Fatalf("cleared response still has reasons: %#v", clearedData)
	}
}
