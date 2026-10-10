package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/notifystream"
)

func TestUserCanDismissOnePersonalOrBroadcastNotification(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	other, _ := env.newUserSession(t, "user")
	ctx := context.Background()

	var personalID, broadcastID, otherID uuid.UUID
	if err := env.st.Pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, kind, title, body)
		VALUES ($1, 'system', '个人通知', '只属于当前用户')
		RETURNING id`, user.ID).Scan(&personalID); err != nil {
		t.Fatalf("insert personal notification: %v", err)
	}
	if err := env.st.Pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, kind, title, body)
		VALUES (NULL, 'system', '全站通知', '所有用户可见')
		RETURNING id`).Scan(&broadcastID); err != nil {
		t.Fatalf("insert broadcast notification: %v", err)
	}
	if err := env.st.Pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, kind, title, body)
		VALUES ($1, 'system', '其他用户通知', '不能被当前用户删除')
		RETURNING id`, other.ID).Scan(&otherID); err != nil {
		t.Fatalf("insert other notification: %v", err)
	}

	response := env.do(t, http.MethodDelete, "/api/v1/me/notifications/"+personalID.String(), nil, token)
	if response.Code != http.StatusNoContent {
		t.Fatalf("dismiss personal: status %d body %s", response.Code, response.Body.String())
	}
	var personalCount int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE id = $1`, personalID).Scan(&personalCount); err != nil {
		t.Fatalf("count personal notification: %v", err)
	}
	if personalCount != 0 {
		t.Fatalf("personal notification count = %d, want 0", personalCount)
	}

	response = env.do(t, http.MethodDelete, "/api/v1/me/notifications/"+broadcastID.String(), nil, token)
	if response.Code != http.StatusNoContent {
		t.Fatalf("dismiss broadcast: status %d body %s", response.Code, response.Body.String())
	}
	var dismissalCount, broadcastCount int
	if err := env.st.Pool.QueryRow(ctx, `
		SELECT count(*) FROM notification_dismissals
		WHERE user_id = $1 AND notification_id = $2`, user.ID, broadcastID).Scan(&dismissalCount); err != nil {
		t.Fatalf("count broadcast dismissal: %v", err)
	}
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE id = $1`, broadcastID).Scan(&broadcastCount); err != nil {
		t.Fatalf("count broadcast notification: %v", err)
	}
	if dismissalCount != 1 || broadcastCount != 1 {
		t.Fatalf("dismissal=%d broadcast=%d, want 1 and 1", dismissalCount, broadcastCount)
	}

	response = env.do(t, http.MethodDelete, "/api/v1/me/notifications/"+otherID.String(), nil, token)
	if response.Code != http.StatusNoContent {
		t.Fatalf("dismiss other user's notification: status %d body %s", response.Code, response.Body.String())
	}
	var otherCount int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE id = $1`, otherID).Scan(&otherCount); err != nil {
		t.Fatalf("count other notification: %v", err)
	}
	if otherCount != 1 {
		t.Fatalf("other user's notification count = %d, want 1", otherCount)
	}

	invalid := env.do(t, http.MethodDelete, "/api/v1/me/notifications/not-a-uuid", nil, token)
	if invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid id: status %d body %s", invalid.Code, invalid.Body.String())
	}
}

func TestNewNotificationSignalsHubAndKeepsLatestHundred(t *testing.T) {
	env := newCommunityEnv(t)
	user, _ := env.newUserSession(t, "user")
	ctx := context.Background()

	hub := notifystream.New()
	hub.Start(env.st.Pool)
	defer hub.Close()
	signals, stop := hub.Subscribe(user.ID)
	defer stop()

	// LISTEN 连接建立是异步的：重复写入直到收到信号。
	deadline := time.After(5 * time.Second)
	for received := false; !received; {
		if _, err := env.st.Pool.Exec(ctx, `
			INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'system', '实时通知')`, user.ID); err != nil {
			t.Fatalf("insert notification: %v", err)
		}
		select {
		case <-signals:
			received = true
		case <-time.After(200 * time.Millisecond):
		case <-deadline:
			t.Fatal("no live signal for new notification")
		}
	}

	if _, err := env.st.Pool.Exec(ctx, `
		INSERT INTO notifications (user_id, kind, title, created_at)
		SELECT $1, 'system', '批量 ' || g, now() + g * interval '1 second'
		FROM generate_series(1, 105) AS g`, user.ID); err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	var count int
	var oldest string
	if err := env.st.Pool.QueryRow(ctx, `
		SELECT count(*), min(title) FILTER (WHERE created_at = (SELECT min(created_at) FROM notifications WHERE user_id = $1))
		FROM notifications WHERE user_id = $1`, user.ID).Scan(&count, &oldest); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if count != 100 || oldest != "批量 6" {
		t.Fatalf("kept %d notifications, oldest %q; want 100 with oldest 批量 6", count, oldest)
	}
}

func TestNotificationPreferencesDefaultSaveAndValidate(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")

	response := env.do(t, http.MethodGet, "/api/v1/me/notification-preferences", nil, token)
	if response.Code != http.StatusOK {
		t.Fatalf("get defaults: status %d body %s", response.Code, response.Body.String())
	}
	defaults, _ := decode(t, response)
	categories, _ := defaults["categories"].(map[string]any)
	if defaults["sound"] != true || categories["task"] != "alert" || len(categories) != 5 {
		t.Fatalf("defaults = %#v", defaults)
	}

	// 只传部分分类：其余补默认值
	response = env.do(t, http.MethodPut, "/api/v1/me/notification-preferences", map[string]any{
		"sound":      false,
		"categories": map[string]string{"other": "silent"},
		"quietHours": map[string]any{"enabled": true, "start": "23:00", "end": "07:30"},
	}, token)
	if response.Code != http.StatusOK {
		t.Fatalf("save: status %d body %s", response.Code, response.Body.String())
	}
	response = env.do(t, http.MethodGet, "/api/v1/me/notification-preferences", nil, token)
	saved, _ := decode(t, response)
	categories, _ = saved["categories"].(map[string]any)
	quiet, _ := saved["quietHours"].(map[string]any)
	if saved["sound"] != false || categories["other"] != "silent" || categories["task"] != "alert" ||
		quiet["enabled"] != true || quiet["start"] != "23:00" || quiet["end"] != "07:30" {
		t.Fatalf("saved = %#v", saved)
	}

	for _, invalid := range []map[string]any{
		{"categories": map[string]string{"task": "loud"}},
		{"categories": map[string]string{"marketing": "alert"}},
		{"quietHours": map[string]any{"enabled": true, "start": "25:00", "end": "07:00"}},
	} {
		if r := env.do(t, http.MethodPut, "/api/v1/me/notification-preferences", invalid, token); r.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid %v: status %d", invalid, r.Code)
		}
	}
}
