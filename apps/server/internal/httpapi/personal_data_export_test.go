package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestPersonalDataExportReturnsOwnedPortableDataWithoutSecrets(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	other, _ := env.newUserSession(t, "user")
	ctx := context.Background()

	if _, err := env.st.Pool.Exec(ctx, `
		UPDATE users SET bio = '仅本人可见的导出简介', location = '杭州'
		WHERE id = $1`, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `
		INSERT INTO wallet_ledger
		(user_id, kind, delta_cents, balance_after_cents, source_type, reason)
		VALUES ($1, 'grant', 25, 25, 'test', '导出测试积分')`, user.ID); err != nil {
		t.Fatal(err)
	}
	var conversationID string
	if err := env.st.Pool.QueryRow(ctx, `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '我的私密对话') RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `
		INSERT INTO assistant_messages (conversation_id, role, content)
		VALUES ($1, 'user', '仅本人可见的消息')`, conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.st.Pool.Exec(ctx, `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '其他用户的私密对话')`, other.ID); err != nil {
		t.Fatal(err)
	}

	response := env.do(t, http.MethodGet, "/api/v1/me/data-export", nil, token)
	if response.Code != http.StatusOK {
		t.Fatalf("export = %d %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("content type = %q", contentType)
	}
	if disposition := response.Header().Get("Content-Disposition"); !strings.Contains(disposition, "starclouds-data-") {
		t.Fatalf("content disposition = %q", disposition)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("cache control = %q", cacheControl)
	}

	var exported map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &exported); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	account := exported["account"].(map[string]any)
	if account["id"] != user.ID.String() || account["bio"] != "仅本人可见的导出简介" {
		t.Fatalf("account = %#v", account)
	}
	if exported["schemaVersion"] != float64(1) || exported["exportedAt"] == nil {
		t.Fatalf("manifest fields = %#v", exported)
	}
	conversations := exported["assistantConversations"].([]any)
	if len(conversations) != 1 || conversations[0].(map[string]any)["title"] != "我的私密对话" {
		t.Fatalf("conversations = %#v", conversations)
	}
	entries := exported["walletEntries"].([]any)
	if len(entries) != 1 || entries[0].(map[string]any)["reason"] != "导出测试积分" {
		t.Fatalf("wallet entries = %#v", entries)
	}
	body := response.Body.String()
	for _, forbidden := range []string{"passwordHash", "password_hash", "tokenHash", "token_hash", "其他用户的私密对话"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("export leaked %q: %s", forbidden, body)
		}
	}
}

func TestPersonalDataExportRequiresAuthentication(t *testing.T) {
	env := newCommunityEnv(t)
	response := env.do(t, http.MethodGet, "/api/v1/me/data-export", nil, "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous export = %d %s", response.Code, response.Body.String())
	}
}
