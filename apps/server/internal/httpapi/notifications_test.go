package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
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
