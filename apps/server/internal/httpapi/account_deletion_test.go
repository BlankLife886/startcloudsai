package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func createEmailAccount(t *testing.T, email string) (*Server, *store.Store, *store.User, *http.Cookie) {
	t.Helper()
	st := testdb.Setup(t)
	s := newUserLoginTestServer(st)
	engine := s.Router()
	code := requestDevelopmentCode(t, engine, email)
	response := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{
		"email": email,
		"code":  code,
	})
	if response.Code != http.StatusCreated {
		t.Fatalf("create account: status %d body %s", response.Code, response.Body.String())
	}
	user, err := store.GetUserByEmail(context.Background(), st.Pool, email)
	if err != nil || user == nil {
		t.Fatalf("load account: user=%v err=%v", user, err)
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == s.Cfg.SessionCookieName {
			return s, st, user, cookie
		}
	}
	t.Fatal("login response did not set a session cookie")
	return nil, nil, nil, nil
}

func TestDeleteAccountRequiresReauthenticationAndAnonymizesIdentity(t *testing.T) {
	email := "delete.account@qq.com"
	s, st, user, sessionCookie := createEmailAccount(t, email)
	engine := s.Router()
	ctx := context.Background()
	if _, err := st.Pool.Exec(ctx, `UPDATE users SET username = '待注销用户', bio = '私密简介',
		location = '上海', website_url = 'https://example.com', avatar_url = '/avatar.jpg'
		WHERE id = $1`, user.ID); err != nil {
		t.Fatal(err)
	}
	var taskID string
	if err := st.Pool.QueryRow(ctx, `INSERT INTO tasks
		(user_id, type, status, prompt, cost_cents, output_keys)
		VALUES ($1, 't2i', 'succeeded', 'private prompt', 1, '["result.jpg"]') RETURNING id`,
		user.ID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `INSERT INTO gallery_submissions
		(user_id, task_id, title, status, cover_key, media_keys, reject_reason)
		VALUES ($1, $2, '公开标题', 'approved', 'cover.jpg', '["result.jpg"]', '旧审核信息')`,
		user.ID, taskID); err != nil {
		t.Fatal(err)
	}

	deleteCode := requestDevelopmentCode(t, engine, email)
	missingConfirmation := authRequest(t, engine, http.MethodDelete, "/api/v1/me/account", gin.H{
		"code": deleteCode,
	}, sessionCookie)
	if missingConfirmation.Code != http.StatusUnprocessableEntity {
		t.Fatalf("missing confirmation = %d %s", missingConfirmation.Code, missingConfirmation.Body.String())
	}
	wrongCode := authRequest(t, engine, http.MethodDelete, "/api/v1/me/account", gin.H{
		"code":         "000000",
		"confirmation": "DELETE",
	}, sessionCookie)
	if wrongCode.Code != http.StatusUnauthorized || !strings.Contains(wrongCode.Body.String(), `"code":"invalid_code"`) {
		t.Fatalf("wrong code = %d %s", wrongCode.Code, wrongCode.Body.String())
	}
	success := authRequest(t, engine, http.MethodDelete, "/api/v1/me/account", gin.H{
		"code":         deleteCode,
		"confirmation": "DELETE",
	}, sessionCookie)
	if success.Code != http.StatusNoContent {
		t.Fatalf("delete account = %d %s", success.Code, success.Body.String())
	}

	if original, err := store.GetUserByEmail(ctx, st.Pool, email); err != nil || original != nil {
		t.Fatalf("original email still resolves: user=%v err=%v", original, err)
	}
	anonymized, err := store.GetUserByID(ctx, st.Pool, user.ID)
	if err != nil || anonymized == nil {
		t.Fatalf("load anonymized account: user=%v err=%v", anonymized, err)
	}
	if anonymized.Status != "deleted" || anonymized.DeletedAt == nil || anonymized.Username != "已注销用户" ||
		anonymized.AvatarURL != nil || anonymized.Bio != "" || anonymized.Location != "" || anonymized.WebsiteURL != "" ||
		!strings.HasSuffix(anonymized.Email, "@deleted.invalid") {
		t.Fatalf("account was not fully anonymized: %#v", anonymized)
	}
	var status, title, cover string
	var mediaCount int
	if err := st.Pool.QueryRow(ctx, `SELECT status, COALESCE(title,''), COALESCE(cover_key,''),
		jsonb_array_length(media_keys) FROM gallery_submissions WHERE user_id = $1`, user.ID).
		Scan(&status, &title, &cover, &mediaCount); err != nil {
		t.Fatal(err)
	}
	if status != "removed" || title != "" || cover != "" || mediaCount != 0 {
		t.Fatalf("public submission still visible: status=%s title=%q cover=%q media=%d", status, title, cover, mediaCount)
	}
	session := authRequest(t, engine, http.MethodGet, "/api/v1/auth/session", nil, sessionCookie)
	if session.Code != http.StatusOK || !strings.Contains(session.Body.String(), `"user":null`) {
		t.Fatalf("deleted session still authenticated: %d %s", session.Code, session.Body.String())
	}

	newCode := requestDevelopmentCode(t, engine, email)
	recreated := authRequest(t, engine, http.MethodPost, "/api/v1/auth/session", gin.H{
		"email": email,
		"code":  newCode,
	})
	if recreated.Code != http.StatusCreated {
		t.Fatalf("recreate with released email = %d %s", recreated.Code, recreated.Body.String())
	}
	recreatedBody := decodeVerifyEmailResponse(t, recreated.Body.Bytes())
	if !recreatedBody.Data.IsNewUser || recreatedBody.Data.User.ID == user.ID.String() {
		t.Fatalf("released email did not create a fresh account: %s", recreated.Body.String())
	}
}

func TestDeleteAccountPreservesCodeWhileActiveTaskBlocksDeletion(t *testing.T) {
	email := "delete.active@qq.com"
	s, st, user, sessionCookie := createEmailAccount(t, email)
	engine := s.Router()
	ctx := context.Background()
	var taskID string
	if err := st.Pool.QueryRow(ctx, `INSERT INTO tasks
		(user_id, type, status, prompt, cost_cents)
		VALUES ($1, 't2i', 'queued', 'active prompt', 1) RETURNING id`, user.ID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	code := requestDevelopmentCode(t, engine, email)
	body := gin.H{"code": code, "confirmation": "DELETE"}
	blocked := authRequest(t, engine, http.MethodDelete, "/api/v1/me/account", body, sessionCookie)
	if blocked.Code != http.StatusConflict || !strings.Contains(blocked.Body.String(), "account_has_active_tasks") {
		t.Fatalf("active task deletion = %d %s", blocked.Code, blocked.Body.String())
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status = 'canceled' WHERE id = $1`, taskID); err != nil {
		t.Fatal(err)
	}
	retry := authRequest(t, engine, http.MethodDelete, "/api/v1/me/account", body, sessionCookie)
	if retry.Code != http.StatusNoContent {
		t.Fatalf("retry after cancel = %d %s", retry.Code, retry.Body.String())
	}
}
