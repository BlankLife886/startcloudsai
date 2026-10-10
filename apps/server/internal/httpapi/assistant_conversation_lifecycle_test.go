package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func setAssistantConversationSetting(t *testing.T, env *communityEnv, key string, value int) {
	t.Helper()
	if err := settings.Set(context.Background(), env.st.Pool, key, json.RawMessage(fmt.Sprint(value))); err != nil {
		t.Fatal(err)
	}
}

func createAssistantConversationForTest(t *testing.T, env *communityEnv, token, title string) map[string]any {
	t.Helper()
	response := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": title}, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("create %s: %d %s", title, response.Code, response.Body.String())
	}
	payload, _ := decode(t, response)
	return payload
}

func TestAssistantConversationLimitArchivesOldestUnpinned(t *testing.T) {
	env := newCommunityEnv(t)
	setAssistantConversationSetting(t, env, "assistant_conversation_max_count", 3)
	_, token := env.newUserSession(t, "user")

	first := createAssistantConversationForTest(t, env, token, "first")
	second := createAssistantConversationForTest(t, env, token, "second")
	createAssistantConversationForTest(t, env, token, "third")
	// 置顶最旧的那个：满额时应跳过它，归档第二旧的。
	pinned := env.do(t, http.MethodPut, fmt.Sprintf("/api/v1/assistant/conversations/%s/pin", first["id"]), map[string]any{"pinned": true}, token)
	if pinned.Code != http.StatusOK {
		t.Fatalf("pin: %d %s", pinned.Code, pinned.Body.String())
	}

	fourth := createAssistantConversationForTest(t, env, token, "fourth")
	archived, _ := fourth["archived"].([]any)
	if len(archived) != 1 || archived[0].(map[string]any)["id"] != second["id"] {
		t.Fatalf("archived = %#v", fourth["archived"])
	}
	if deleteAt, _ := archived[0].(map[string]any)["deleteAt"].(string); deleteAt == "" {
		t.Fatalf("archived entry should say when it is deleted: %#v", archived[0])
	}
	quota, _ := fourth["quota"].(map[string]any)
	if quota["limit"] != float64(3) || quota["used"] != float64(3) || quota["archived"] != float64(1) || quota["pinned"] != float64(1) {
		t.Fatalf("quota = %#v", quota)
	}

	list := env.do(t, http.MethodGet, "/api/v1/assistant/conversations", nil, token)
	listed, _ := decode(t, list)
	conversations, _ := listed["conversations"].([]any)
	if len(conversations) != 3 {
		t.Fatalf("list should hide archived, got %d", len(conversations))
	}
	for _, entry := range conversations {
		if entry.(map[string]any)["id"] == second["id"] {
			t.Fatalf("archived conversation still listed")
		}
	}

	// 归档的对话不能继续发消息，恢复后回到列表顶部，满额时再归档最旧的未置顶对话。
	blocked := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{"conversationId": second["id"], "prompt": "hi", "mode": "chat"}, token)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("run on archived conversation: %d %s", blocked.Code, blocked.Body.String())
	}
	restored := env.do(t, http.MethodPost, fmt.Sprintf("/api/v1/assistant/conversations/%s/restore", second["id"]), nil, token)
	if restored.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", restored.Code, restored.Body.String())
	}
	restoredPayload, _ := decode(t, restored)
	reArchived, _ := restoredPayload["archived"].([]any)
	if len(reArchived) != 1 || reArchived[0].(map[string]any)["title"] != "third" {
		t.Fatalf("restore should archive the oldest unpinned other conversation: %#v", restoredPayload["archived"])
	}

	archive := env.do(t, http.MethodGet, "/api/v1/assistant/conversation-archive", nil, token)
	archivePayload, _ := decode(t, archive)
	if items, _ := archivePayload["conversations"].([]any); len(items) != 1 || archivePayload["archiveDays"] != float64(7) {
		t.Fatalf("archive list = %#v", archivePayload)
	}
}

func TestAssistantConversationLimitRefusesWhenEverythingIsPinned(t *testing.T) {
	env := newCommunityEnv(t)
	setAssistantConversationSetting(t, env, "assistant_conversation_max_count", 1)
	_, token := env.newUserSession(t, "user")
	only := createAssistantConversationForTest(t, env, token, "only")
	env.do(t, http.MethodPut, fmt.Sprintf("/api/v1/assistant/conversations/%s/pin", only["id"]), map[string]any{"pinned": true}, token)
	refused := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "next"}, token)
	if refused.Code != http.StatusConflict {
		t.Fatalf("expected 409 when only pinned conversations remain: %d %s", refused.Code, refused.Body.String())
	}
	list := env.do(t, http.MethodGet, "/api/v1/assistant/conversations", nil, token)
	listed, _ := decode(t, list)
	if items, _ := listed["conversations"].([]any); len(items) != 1 {
		t.Fatalf("refused creation must roll back, got %d conversations", len(items))
	}
}

func TestAssistantConversationDailyCreateLimit(t *testing.T) {
	env := newCommunityEnv(t)
	setAssistantConversationSetting(t, env, "assistant_conversation_daily_create_limit", 2)
	_, token := env.newUserSession(t, "user")
	first := createAssistantConversationForTest(t, env, token, "a")
	createAssistantConversationForTest(t, env, token, "b")
	// 删除不会退回当天的次数。
	env.do(t, http.MethodDelete, fmt.Sprintf("/api/v1/assistant/conversations/%s", first["id"]), nil, token)
	limited := env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "c"}, token)
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after daily limit: %d %s", limited.Code, limited.Body.String())
	}
	quota := env.do(t, http.MethodGet, "/api/v1/assistant/conversation-quota", nil, token)
	payload, _ := decode(t, quota)
	if q, _ := payload["quota"].(map[string]any); q["createdToday"] != float64(2) || q["dailyLimit"] != float64(2) {
		t.Fatalf("quota = %#v", payload)
	}
}

func TestAssistantConversationMaxMessagesBlocksLongConversations(t *testing.T) {
	env := newCommunityEnv(t)
	setAssistantConversationSetting(t, env, "assistant_conversation_max_messages", 2)
	_, token := env.newUserSession(t, "user")
	created := createAssistantConversationForTest(t, env, token, "long")
	id := uuid.MustParse(fmt.Sprint(created["id"]))
	for index := 0; index < 2; index++ {
		if _, err := env.st.Pool.Exec(context.Background(), `INSERT INTO assistant_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, id, fmt.Sprint(index)); err != nil {
			t.Fatal(err)
		}
	}
	blocked := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{"conversationId": created["id"], "prompt": "more", "mode": "chat"}, token)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a conversation at the message limit: %d %s", blocked.Code, blocked.Body.String())
	}
}

func TestPurgeArchivedAssistantConversationsQueryHonoursRetention(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	created := createAssistantConversationForTest(t, env, token, "old")
	id := uuid.MustParse(fmt.Sprint(created["id"]))
	ctx := context.Background()
	if _, err := store.SetAssistantConversationArchived(ctx, env.st.Pool, user.ID, id, true, time.Now().UTC().AddDate(0, 0, -8)); err != nil {
		t.Fatal(err)
	}
	expired, err := store.ListExpiredArchivedAssistantConversations(ctx, env.st.Pool, time.Now().UTC().AddDate(0, 0, -7), 10)
	if err != nil || len(expired) != 1 || expired[0].ID != id {
		t.Fatalf("expired = %#v err = %v", expired, err)
	}
	notYet, err := store.ListExpiredArchivedAssistantConversations(ctx, env.st.Pool, time.Now().UTC().AddDate(0, 0, -9), 10)
	if err != nil || len(notYet) != 0 {
		t.Fatalf("conversation archived 8 days ago must survive a 9-day window: %#v err = %v", notYet, err)
	}
}
