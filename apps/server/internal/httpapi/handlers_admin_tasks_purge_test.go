package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAdminPurgeFinishedTasks(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	succeededID := env.newSucceededTask(t, user.ID)
	galleryID := env.newSucceededTask(t, user.ID)
	failedID := insertAdminTask(t, env, user.ID, "failed", "upstream_error")
	queuedID := insertAdminTask(t, env, user.ID, "queued", "")
	runningID := insertAdminTask(t, env, user.ID, "running", "")

	if _, err := env.st.Pool.Exec(ctx, `
		INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason)
		VALUES ($1, 'spend', -20, 0, 'task', $2, '无限画布结算：消耗冻结 3 分')`,
		user.ID, succeededID.String()); err != nil {
		t.Fatalf("insert ledger: %v", err)
	}
	if w := env.do(t, http.MethodPost, "/api/v1/gallery/submissions",
		map[string]any{"taskId": galleryID.String(), "title": "保留投稿"}, userToken); w.Code != http.StatusCreated {
		t.Fatalf("submit gallery: status %d body %s", w.Code, w.Body.String())
	}

	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "清空测试", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "你好",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Content: "你好",
		Kind: "chat", Status: "complete", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "chat", Prompt: "你好",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE assistant_runs SET status = 'succeeded' WHERE id = $1`, run.ID); err != nil {
		t.Fatal(err)
	}

	forbidden := env.do(t, http.MethodDelete, "/api/v1/admin/tasks", nil, userToken)
	if forbidden.Code != http.StatusUnauthorized && forbidden.Code != http.StatusForbidden {
		t.Fatalf("user purge: status %d body %s", forbidden.Code, forbidden.Body.String())
	}

	queuedPurge := env.do(t, http.MethodDelete, "/api/v1/admin/tasks?status=queued", nil, adminToken)
	if queuedPurge.Code != http.StatusUnprocessableEntity {
		t.Fatalf("queued purge: status %d body %s", queuedPurge.Code, queuedPurge.Body.String())
	}

	w := env.do(t, http.MethodDelete, "/api/v1/admin/tasks?user="+user.Email, nil, adminToken)
	data, code := decode(t, w)
	if w.Code != http.StatusOK || code != "" {
		t.Fatalf("purge: status %d code %s body %s", w.Code, code, w.Body.String())
	}
	deleted := int(data["deleted"].(float64))
	skipped := int(data["skipped"].(float64))
	if deleted != 4 {
		t.Fatalf("deleted = %d, want 4 (succeeded + failed + gallery + assistant run)", deleted)
	}
	if skipped != 0 {
		t.Fatalf("skipped = %d, want 0", skipped)
	}

	assertTaskExists(t, env, succeededID, true)
	assertTaskExists(t, env, failedID, true)
	assertTaskExists(t, env, galleryID, true)
	assertTaskExists(t, env, queuedID, true)
	assertTaskExists(t, env, runningID, true)
	assertAdminCleared(t, env, succeededID, true)
	assertAdminCleared(t, env, failedID, true)
	assertAdminCleared(t, env, galleryID, true)
	assertAdminCleared(t, env, queuedID, false)
	assertAdminCleared(t, env, runningID, false)

	listed := env.do(t, http.MethodGet, "/api/v1/tasks", nil, userToken)
	listedData, _ := decode(t, listed)
	if listed.Code != http.StatusOK {
		t.Fatalf("user tasks status=%d body=%s", listed.Code, listed.Body.String())
	}
	items, _ := listedData["items"].([]any)
	seen := map[string]bool{}
	for _, item := range items {
		row, _ := item.(map[string]any)
		id, _ := row["id"].(string)
		seen[id] = true
	}
	if !seen[succeededID.String()] || !seen[galleryID.String()] {
		t.Fatalf("user history missing cleared tasks: %#v", seen)
	}

	adminListed := env.do(t, http.MethodGet, "/api/v1/admin/tasks?user="+user.Email, nil, adminToken)
	adminData, _ := decode(t, adminListed)
	if adminListed.Code != http.StatusOK {
		t.Fatalf("admin tasks status=%d body=%s", adminListed.Code, adminListed.Body.String())
	}
	adminItems, _ := adminData["items"].([]any)
	for _, item := range adminItems {
		row, _ := item.(map[string]any)
		id, _ := row["id"].(string)
		if id == succeededID.String() || id == failedID.String() || id == galleryID.String() || id == run.ID.String() {
			t.Fatalf("admin list still contains cleared task %s", id)
		}
	}

	var runExists, runCleared, ledgerExists bool
	if err := env.st.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assistant_runs WHERE id = $1)`, run.ID).Scan(&runExists); err != nil {
		t.Fatal(err)
	}
	if !runExists {
		t.Fatal("assistant run was deleted instead of hidden from admin")
	}
	if err := env.st.Pool.QueryRow(ctx, `SELECT admin_cleared_at IS NOT NULL FROM assistant_runs WHERE id = $1`, run.ID).Scan(&runCleared); err != nil {
		t.Fatal(err)
	}
	if !runCleared {
		t.Fatal("assistant run was not marked admin_cleared_at")
	}
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM wallet_ledger WHERE source_id = $1)`, succeededID.String()).Scan(&ledgerExists); err != nil {
		t.Fatal(err)
	}
	if !ledgerExists {
		t.Fatal("wallet ledger row was deleted")
	}
}

func insertAdminTask(t *testing.T, env *communityEnv, userID uuid.UUID, status, errorCode string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := env.st.Pool.QueryRow(context.Background(),
		`INSERT INTO tasks (user_id, type, prompt, status, error_code, cost_cents)
		 VALUES ($1, 't2i', $2, $3, NULLIF($4, ''), 0)
		 RETURNING id`, userID, status+" prompt", status, errorCode).Scan(&id)
	if err != nil {
		t.Fatalf("insert %s task: %v", status, err)
	}
	return id
}

func assertTaskExists(t *testing.T, env *communityEnv, id uuid.UUID, want bool) {
	t.Helper()
	var exists bool
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1)`, id).Scan(&exists); err != nil {
		t.Fatalf("check task %s: %v", id, err)
	}
	if exists != want {
		t.Fatalf("task %s exists = %v, want %v", id, exists, want)
	}
}

func assertAdminCleared(t *testing.T, env *communityEnv, id uuid.UUID, want bool) {
	t.Helper()
	var cleared bool
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT admin_cleared_at IS NOT NULL FROM tasks WHERE id = $1`, id).Scan(&cleared); err != nil {
		t.Fatalf("check admin_cleared_at %s: %v", id, err)
	}
	if cleared != want {
		t.Fatalf("task %s admin_cleared = %v, want %v", id, cleared, want)
	}
}
