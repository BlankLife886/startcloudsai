package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestPatchProfilePersistsCostConfirmationPreference(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	if !user.RequireCostConfirm {
		t.Fatal("new users should require cost confirmation by default")
	}

	w := env.do(t, http.MethodPatch, "/api/v1/me/profile", map[string]any{
		"requireCostConfirm": false,
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("patch profile: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	userData := data["user"].(map[string]any)
	if userData["requireCostConfirm"] != false {
		t.Fatalf("response preference = %v, want false", userData["requireCostConfirm"])
	}

	stored, err := store.GetUserByID(context.Background(), env.st.Pool, user.ID)
	if err != nil {
		t.Fatalf("read stored user: %v", err)
	}
	if stored == nil || stored.RequireCostConfirm {
		t.Fatalf("stored preference = %#v, want false", stored)
	}
}
