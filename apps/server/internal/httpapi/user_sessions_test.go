package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestUserCanListAndRevokeLoginSessions(t *testing.T) {
	env := newCommunityEnv(t)
	user, currentToken := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	otherToken := auth.NewSessionToken()
	otherIP := "203.0.113.24"
	otherUA := "Mozilla/5.0 (Linux; Android 15) StarCloudsAI/1.0"
	if err := store.InsertSession(ctx, env.st.Pool, user.ID, auth.HashToken(otherToken),
		now.Add(24*time.Hour), &otherIP, &otherUA); err != nil {
		t.Fatal(err)
	}

	list := env.do(t, http.MethodGet, "/api/v1/me/sessions", nil, currentToken)
	if list.Code != http.StatusOK {
		t.Fatalf("list sessions = %d %s", list.Code, list.Body.String())
	}
	data, _ := decode(t, list)
	items, ok := data["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("session items = %#v", data["items"])
	}
	currentCount := 0
	var otherID string
	for _, raw := range items {
		item := raw.(map[string]any)
		if item["current"] == true {
			currentCount++
		} else {
			otherID = item["id"].(string)
			if item["ip"] != otherIP || item["userAgent"] != otherUA {
				t.Fatalf("other session metadata = %#v", item)
			}
		}
	}
	if currentCount != 1 || otherID == "" {
		t.Fatalf("current=%d otherID=%q items=%#v", currentCount, otherID, items)
	}

	revoked := env.do(t, http.MethodDelete, "/api/v1/me/sessions/"+otherID, nil, currentToken)
	if revoked.Code != http.StatusNoContent {
		t.Fatalf("revoke other = %d %s", revoked.Code, revoked.Body.String())
	}
	remaining, err := store.ListActiveUserSessions(ctx, env.st.Pool, user.ID, now)
	if err != nil || len(remaining) != 1 {
		t.Fatalf("remaining sessions=%d err=%v", len(remaining), err)
	}

	for index := 0; index < 2; index++ {
		token := auth.NewSessionToken()
		if err := store.InsertSession(ctx, env.st.Pool, user.ID, auth.HashToken(token),
			now.Add(24*time.Hour), nil, nil); err != nil {
			t.Fatal(err)
		}
	}
	bulk := env.do(t, http.MethodDelete, "/api/v1/me/sessions?scope=others", nil, currentToken)
	if bulk.Code != http.StatusOK {
		t.Fatalf("revoke others = %d %s", bulk.Code, bulk.Body.String())
	}
	bulkData, _ := decode(t, bulk)
	if bulkData["revoked"] != float64(2) {
		t.Fatalf("revoked count = %#v", bulkData["revoked"])
	}

	current, err := store.GetSessionByTokenHash(ctx, env.st.Pool, auth.HashToken(currentToken))
	if err != nil || current == nil {
		t.Fatalf("current session missing: %v", err)
	}
	deletedCurrent := env.do(t, http.MethodDelete, "/api/v1/me/sessions/"+current.ID.String(), nil, currentToken)
	if deletedCurrent.Code != http.StatusNoContent {
		t.Fatalf("revoke current = %d %s", deletedCurrent.Code, deletedCurrent.Body.String())
	}
	after := env.do(t, http.MethodGet, "/api/v1/auth/session", nil, currentToken)
	if after.Code != http.StatusOK || !strings.Contains(after.Body.String(), `"user":null`) {
		t.Fatalf("current session still valid = %d %s", after.Code, after.Body.String())
	}
}
