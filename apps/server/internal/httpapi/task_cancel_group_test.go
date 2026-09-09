package httpapi

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
	"net/http"
	"testing"
)

func TestCancelGroupEndpointStopsEveryOwnedQueuedTask(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ids := []string{}
	for range 4 {
		id := uuid.New()
		if _, err := store.InsertTask(context.Background(), env.st.Pool, store.NewTask{ID: id, UserID: user.ID, Type: "t2i", Prompt: "cancel group", Count: 1}); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id.String())
	}
	w := env.do(t, http.MethodPost, "/api/v1/tasks/cancel-group", map[string]any{"ids": ids}, token)
	data, code := decode(t, w)
	if w.Code != http.StatusOK || code != "" {
		t.Fatalf("status=%d code=%s body=%s", w.Code, code, w.Body.String())
	}
	items, _ := data["items"].([]any)
	if len(items) != 4 {
		t.Fatalf("items=%v", items)
	}
	for _, raw := range items {
		row := raw.(map[string]any)
		policy := row["cancelPolicy"].(map[string]any)
		if row["status"] != "canceled" || policy["refunded"] != true || policy["chargedPoints"] != float64(0) {
			t.Fatalf("row=%v", row)
		}
	}
}

func TestCancelGroupEndpointRejectsAnotherUsersTask(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	other, _ := env.newUserSession(t, "user")
	id := uuid.New()
	if _, err := store.InsertTask(context.Background(), env.st.Pool, store.NewTask{ID: id, UserID: other.ID, Type: "t2i", Prompt: "other", Count: 1}); err != nil {
		t.Fatal(err)
	}
	w := env.do(t, http.MethodPost, "/api/v1/tasks/cancel-group", map[string]any{"ids": []string{id.String()}}, token)
	if w.Code != http.StatusNotFound {
		t.Fatalf("user %s cross-owner cancellation: %d", user.ID, w.Code)
	}
}
