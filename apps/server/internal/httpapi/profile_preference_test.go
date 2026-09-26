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

func TestPatchProfileClearsStudioFigureURL(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	if _, err := env.st.Pool.Exec(context.Background(),
		`UPDATE users SET studio_figure_url = $2 WHERE id = $1`,
		user.ID, "/api/v1/files/uploads/"+user.ID.String()+"/original/figure.webp"); err != nil {
		t.Fatalf("seed studio figure: %v", err)
	}

	w := env.do(t, http.MethodPatch, "/api/v1/me/profile", map[string]any{
		"studioFigureUrl": "",
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("patch profile: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	userData := data["user"].(map[string]any)
	if userData["studioFigureUrl"] != nil {
		t.Fatalf("response studioFigureUrl = %#v, want nil", userData["studioFigureUrl"])
	}

	stored, err := store.GetUserByID(context.Background(), env.st.Pool, user.ID)
	if err != nil {
		t.Fatalf("read stored user: %v", err)
	}
	if stored == nil || stored.StudioFigureURL != nil {
		t.Fatalf("stored studioFigureUrl = %#v, want nil", stored)
	}
}

func TestPatchProfilePersistsStudioFigureAcrossSessionReload(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	key := "uploads/" + user.ID.String() + "/original/figure.webp"
	figureURL := "/api/v1/files/" + key
	if err := store.RegisterUserUploadObjects(context.Background(), env.st.Pool, user.ID, []string{key}); err != nil {
		t.Fatalf("register upload: %v", err)
	}

	w := env.do(t, http.MethodPatch, "/api/v1/me/profile", map[string]any{
		"studioFigureUrl": figureURL,
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("patch profile: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	userData := data["user"].(map[string]any)
	if userData["studioFigureUrl"] != figureURL {
		t.Fatalf("patch studioFigureUrl = %#v, want %s", userData["studioFigureUrl"], figureURL)
	}

	stored, err := store.GetUserByID(context.Background(), env.st.Pool, user.ID)
	if err != nil {
		t.Fatalf("read stored user: %v", err)
	}
	if stored == nil || stored.StudioFigureURL == nil || *stored.StudioFigureURL != figureURL {
		t.Fatalf("stored studioFigureUrl = %#v, want %s", stored.StudioFigureURL, figureURL)
	}

	session := env.do(t, http.MethodGet, "/api/v1/auth/session", nil, token)
	if session.Code != http.StatusOK {
		t.Fatalf("auth session: status %d body %s", session.Code, session.Body.String())
	}
	sessionData, _ := decode(t, session)
	sessionUser := sessionData["user"].(map[string]any)
	if sessionUser["studioFigureUrl"] != figureURL {
		t.Fatalf("session studioFigureUrl = %#v, want %s", sessionUser["studioFigureUrl"], figureURL)
	}
}

func TestPatchProfileReleasesPreviousStudioFigureImmediately(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	oldKey := "uploads/" + user.ID.String() + "/original/old.webp"
	newKey := "uploads/" + user.ID.String() + "/original/new.webp"
	if err := store.RegisterUserUploadObjects(ctx, env.st.Pool, user.ID, []string{oldKey, newKey}); err != nil {
		t.Fatalf("register uploads: %v", err)
	}

	first := env.do(t, http.MethodPatch, "/api/v1/me/profile", map[string]any{
		"studioFigureUrl": "/api/v1/files/" + oldKey,
	}, token)
	if first.Code != http.StatusOK {
		t.Fatalf("patch old figure: status %d body %s", first.Code, first.Body.String())
	}
	second := env.do(t, http.MethodPatch, "/api/v1/me/profile", map[string]any{
		"studioFigureUrl": "/api/v1/files/" + newKey,
	}, token)
	if second.Code != http.StatusOK {
		t.Fatalf("patch new figure: status %d body %s", second.Code, second.Body.String())
	}

	var oldRefs, newRefs int
	if err := env.st.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM user_upload_references WHERE object_key = $1`, oldKey).Scan(&oldRefs); err != nil {
		t.Fatalf("count old refs: %v", err)
	}
	if oldRefs != 0 {
		t.Fatalf("old studio figure still referenced: %d", oldRefs)
	}
	if err := env.st.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM user_upload_references WHERE object_key = $1`, newKey).Scan(&newRefs); err != nil {
		t.Fatalf("count new refs: %v", err)
	}
	if newRefs != 1 {
		t.Fatalf("new studio figure refs = %d, want 1", newRefs)
	}

	live, err := store.HasLiveUserUploadObject(ctx, env.st.Pool, user.ID, newKey)
	if err != nil {
		t.Fatalf("new figure live check: %v", err)
	}
	if !live {
		t.Fatal("current studio figure was deleted")
	}
}

func TestPatchProfileAcceptsAbsoluteStudioFigureURL(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	key := "uploads/" + user.ID.String() + "/original/figure.webp"
	figureURL := "/api/v1/files/" + key
	if err := store.RegisterUserUploadObjects(context.Background(), env.st.Pool, user.ID, []string{key}); err != nil {
		t.Fatalf("register upload: %v", err)
	}

	w := env.do(t, http.MethodPatch, "/api/v1/me/profile", map[string]any{
		"studioFigureUrl": "https://app.example/api/v1/files/" + key + "?v=4",
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("patch profile: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	userData := data["user"].(map[string]any)
	if userData["studioFigureUrl"] != figureURL {
		t.Fatalf("patch studioFigureUrl = %#v, want %s", userData["studioFigureUrl"], figureURL)
	}
}
