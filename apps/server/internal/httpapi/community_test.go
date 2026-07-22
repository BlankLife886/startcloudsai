// 社区运营（v3）：违规禁投、投稿开关/每日限额、autoApprove 直通、curate 幂等。
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

type communityEnv struct {
	st     *store.Store
	cfg    *config.Config
	engine *gin.Engine
}

func newCommunityEnv(t *testing.T) *communityEnv {
	t.Helper()
	st := testdb.Setup(t)
	cfg := config.Load()
	// 本地 dummy 端点：presign 为本地签名计算，失败时 presignSafe 会兜底为 nil
	stg, err := storage.New(cfg)
	if err != nil {
		t.Fatalf("init storage: %v", err)
	}
	srv := &Server{Cfg: cfg, St: st, Storage: stg}
	return &communityEnv{st: st, cfg: cfg, engine: srv.Router()}
}

// newUserSession 建用户 + 会话，返回用户与 cookie token。
func (e *communityEnv) newUserSession(t *testing.T, role string) (*store.User, string) {
	t.Helper()
	ctx := context.Background()
	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	if role == "admin" {
		admin, err := store.UpsertAdminAccount(ctx, e.st.Pool, email, "admin", "x")
		if err != nil {
			t.Fatalf("insert admin: %v", err)
		}
		token := auth.NewSessionToken()
		expires := time.Now().UTC().Add(24 * time.Hour)
		if err := store.InsertAdminSession(ctx, e.st.Pool, admin.ID, auth.HashToken(token), expires, nil, nil); err != nil {
			t.Fatalf("insert admin session: %v", err)
		}
		return adminAccountAsUser(admin), token
	}
	user, err := store.InsertUser(ctx, e.st.Pool, email, "tester", "x", role, nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	token := auth.NewSessionToken()
	expires := time.Now().UTC().Add(24 * time.Hour)
	if err := store.InsertSession(ctx, e.st.Pool, user.ID, auth.HashToken(token), expires, nil, nil); err != nil {
		t.Fatalf("insert session: %v", err)
	}
	return user, token
}

// newSucceededTask 直接落库一条带产物的成功任务。
func (e *communityEnv) newSucceededTask(t *testing.T, userID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := e.st.Pool.QueryRow(context.Background(),
		`INSERT INTO tasks (user_id, type, prompt, status, output_keys, cost_cents)
		 VALUES ($1, 't2i', 'test prompt', 'succeeded', to_jsonb(ARRAY['tasks/' || $2::text || '/' || gen_random_uuid() || '.png']), 20)
		 RETURNING id`, userID, userID.String()).Scan(&id)
	if err != nil {
		t.Fatalf("insert succeeded task: %v", err)
	}
	return id
}

// do 发起请求；token 非空时带 sc_session cookie。
func (e *communityEnv) do(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		cookieName := e.cfg.SessionCookieName
		if strings.HasPrefix(path, "/api/admin") {
			cookieName = adminSessionCookieName
		}
		req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	}
	w := httptest.NewRecorder()
	e.engine.ServeHTTP(w, req)
	return w
}

// decode 解析统一响应，返回 (data, code)。
func decode(t *testing.T, w *httptest.ResponseRecorder) (map[string]any, string) {
	t.Helper()
	var resp struct {
		Success bool           `json:"success"`
		Code    string         `json:"code"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response %q: %v", w.Body.String(), err)
	}
	return resp.Data, resp.Code
}

func TestViolationBanThenUnban(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	task1 := env.newSucceededTask(t, user.ID)
	task2 := env.newSucceededTask(t, user.ID)

	// 正常投稿
	w := env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task1.String(), "title": "作品一"}, userToken)
	if w.Code != 200 {
		t.Fatalf("submit: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	submissionID := data["id"].(string)
	if data["status"] != "pending" {
		t.Fatalf("status = %v, want pending", data["status"])
	}

	// 违规下架 + 禁投 7 天
	w = env.do(t, "POST", "/api/admin/gallery/submissions/"+submissionID+"/violation",
		gin.H{"reason": "违规内容", "banDays": 7}, adminToken)
	if w.Code != 200 {
		t.Fatalf("violation: status %d body %s", w.Code, w.Body.String())
	}
	data, _ = decode(t, w)
	if data["status"] != "removed" || data["bannedUntil"] == nil || data["deletedMedia"] != false {
		t.Fatalf("violation resp = %v", data)
	}

	// 禁投期内再投稿被拒
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task2.String()}, userToken)
	if w.Code != 403 {
		t.Fatalf("banned submit: status %d body %s", w.Code, w.Body.String())
	}
	if _, code := decode(t, w); code != "submission_banned" {
		t.Fatalf("code = %s, want submission_banned", code)
	}

	// 用户收到违规通知
	var notified int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE user_id = $1 AND title = '投稿违规处理'`, user.ID).Scan(&notified); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notified != 1 {
		t.Fatalf("notifications = %d, want 1", notified)
	}

	// 解禁后恢复投稿
	w = env.do(t, "POST", "/api/admin/gallery/users/"+user.ID.String()+"/unban", gin.H{}, adminToken)
	if w.Code != 200 {
		t.Fatalf("unban: status %d body %s", w.Code, w.Body.String())
	}
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task2.String()}, userToken)
	if w.Code != 200 {
		t.Fatalf("submit after unban: status %d body %s", w.Code, w.Body.String())
	}
}

func TestSubmissionDisabledAndDailyLimit(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	task1 := env.newSucceededTask(t, user.ID)
	task2 := env.newSucceededTask(t, user.ID)

	// 关闭投稿
	w := env.do(t, "PUT", "/api/admin/gallery/settings", gin.H{"submissionEnabled": false}, adminToken)
	if w.Code != 200 {
		t.Fatalf("put settings: status %d body %s", w.Code, w.Body.String())
	}
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task1.String()}, userToken)
	if _, code := decode(t, w); w.Code != 403 || code != "submission_disabled" {
		t.Fatalf("disabled submit: status %d code %s", w.Code, code)
	}

	// 开启 + 每日限额 1
	w = env.do(t, "PUT", "/api/admin/gallery/settings", gin.H{"submissionEnabled": true, "dailyLimit": 1}, adminToken)
	data, _ := decode(t, w)
	if data["submissionEnabled"] != true || data["dailyLimit"] != float64(1) {
		t.Fatalf("settings resp = %v", data)
	}
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task1.String()}, userToken)
	if w.Code != 200 {
		t.Fatalf("first submit: status %d body %s", w.Code, w.Body.String())
	}
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task2.String()}, userToken)
	if _, code := decode(t, w); w.Code != 429 || code != "submission_daily_limit" {
		t.Fatalf("over-limit submit: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	// dailyLimit 0 = 不限
	w = env.do(t, "PUT", "/api/admin/gallery/settings", gin.H{"dailyLimit": 0}, adminToken)
	if w.Code != 200 {
		t.Fatalf("reset limit: status %d", w.Code)
	}
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task2.String()}, userToken)
	if w.Code != 200 {
		t.Fatalf("submit with no limit: status %d body %s", w.Code, w.Body.String())
	}
}

func TestAutoApprovePassThrough(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	task1 := env.newSucceededTask(t, user.ID)

	w := env.do(t, "PUT", "/api/admin/gallery/settings", gin.H{"autoApprove": true}, adminToken)
	if w.Code != 200 {
		t.Fatalf("put settings: status %d", w.Code)
	}
	w = env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": task1.String()}, userToken)
	data, _ := decode(t, w)
	if w.Code != 200 || data["status"] != "approved" {
		t.Fatalf("auto-approve submit: status %d data %v", w.Code, data)
	}
}

func TestAdminSubmissionsIncludeRenderableMediaURLs(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	taskID := env.newSucceededTask(t, user.ID)

	w := env.do(t, "POST", "/api/gallery/submissions", gin.H{
		"taskId": taskID.String(), "title": "审核图片回归测试",
	}, userToken)
	if w.Code != http.StatusOK {
		t.Fatalf("submit: status %d body %s", w.Code, w.Body.String())
	}

	w = env.do(t, "GET", "/api/admin/gallery/submissions?status=pending&limit=20", nil, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("admin submissions: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	items, ok := data["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v, want one submission", data["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("item = %#v, want object", items[0])
	}
	coverURL, _ := item["coverUrl"].(string)
	mediaURLs, _ := item["mediaUrls"].([]any)
	if !strings.HasPrefix(coverURL, "/api/files/tasks/"+user.ID.String()+"/") {
		t.Fatalf("coverUrl = %q, want an in-app file URL", coverURL)
	}
	if len(mediaURLs) != 1 || mediaURLs[0] != coverURL {
		t.Fatalf("mediaUrls = %#v, want [%q]", mediaURLs, coverURL)
	}
	author, ok := item["author"].(map[string]any)
	if !ok || author["id"] != user.ID.String() || item["userEmail"] != user.Email {
		t.Fatalf("author fields = %#v / %#v", author, item["userEmail"])
	}
}

func TestAdminUserDetailIncludesProfileSecurityAndCompleteCounts(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, _ := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	now := time.Now().UTC()
	banUntil := now.Add(48 * time.Hour)

	_, err := env.st.Pool.Exec(ctx,
		`UPDATE users SET avatar_url = '/api/files/avatar.jpg', bio = '个人简介', location = '上海',
		 website_url = 'https://example.com', last_login_at = $2, submission_banned_until = $3 WHERE id = $1`,
		user.ID, now, banUntil)
	if err != nil {
		t.Fatalf("update profile: %v", err)
	}
	if _, err := store.InsertUserAsset(ctx, env.st.Pool, user.ID, "测试素材", "assets/a.png", "assets/a.jpg", "image/png", 128); err != nil {
		t.Fatalf("insert asset: %v", err)
	}
	env.newSucceededTask(t, user.ID)
	if _, err := env.st.Pool.Exec(ctx,
		`INSERT INTO tasks (user_id, type, prompt, status, cost_cents) VALUES ($1, 't2i', 'canceled', 'canceled', 0)`,
		user.ID); err != nil {
		t.Fatalf("insert canceled task: %v", err)
	}
	ip, agent := "203.0.113.8", "Admin detail test agent"
	if err := store.InsertSession(ctx, env.st.Pool, user.ID, auth.HashToken(auth.NewSessionToken()),
		now.Add(time.Hour), &ip, &agent); err != nil {
		t.Fatalf("insert recent session: %v", err)
	}

	w := env.do(t, "GET", "/api/admin/users/"+user.ID.String(), nil, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("admin user detail: status %d body %s", w.Code, w.Body.String())
	}
	data, _ := decode(t, w)
	userData := data["user"].(map[string]any)
	if userData["bio"] != "个人简介" || userData["location"] != "上海" || userData["websiteUrl"] != "https://example.com" {
		t.Fatalf("profile fields = %#v", userData)
	}
	if userData["lastLoginAt"] == nil || userData["submissionBannedUntil"] == nil {
		t.Fatalf("account timestamps missing: %#v", userData)
	}
	counts := data["counts"].(map[string]any)
	if counts["assets"] != float64(1) || counts["tasksSucceeded"] != float64(1) || counts["tasksCanceled"] != float64(1) {
		t.Fatalf("counts = %#v", counts)
	}
	security := data["security"].(map[string]any)
	if security["activeSessions"] != float64(2) || security["lastSessionIp"] != ip || security["lastSessionUserAgent"] != agent {
		t.Fatalf("security = %#v", security)
	}
}

func TestCurateIdempotentAndFeaturedFilter(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")
	task1 := env.newSucceededTask(t, user.ID)

	// 建分类
	w := env.do(t, "POST", "/api/admin/gallery/categories", gin.H{"name": "插画", "sort": 1}, adminToken)
	data, _ := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("create category: status %d body %s", w.Code, w.Body.String())
	}
	categoryID := data["id"].(string)

	// autoApprove 直通，方便公开画廊断言
	if w := env.do(t, "PUT", "/api/admin/gallery/settings", gin.H{"autoApprove": true}, adminToken); w.Code != 200 {
		t.Fatalf("put settings: status %d", w.Code)
	}
	w = env.do(t, "POST", "/api/gallery/submissions",
		gin.H{"taskId": task1.String(), "categoryId": categoryID}, userToken)
	data, _ = decode(t, w)
	if w.Code != 200 || data["categoryId"] != categoryID {
		t.Fatalf("submit with category: status %d data %v", w.Code, data)
	}
	submissionID := data["id"].(string)

	// curate 两次同一 payload：幂等
	payload := gin.H{"featured": true, "categoryId": categoryID, "sort": 5}
	for i := 0; i < 2; i++ {
		w = env.do(t, "POST", "/api/admin/gallery/submissions/"+submissionID+"/curate", payload, adminToken)
		data, _ = decode(t, w)
		if w.Code != 200 || data["featured"] != true || data["categoryId"] != categoryID || data["sort"] != float64(5) {
			t.Fatalf("curate #%d: status %d data %v", i+1, w.Code, data)
		}
	}

	// 显式 categoryId=null 清除归类，featured 不受影响
	w = env.do(t, "POST", "/api/admin/gallery/submissions/"+submissionID+"/curate",
		gin.H{"categoryId": nil}, adminToken)
	data, _ = decode(t, w)
	if w.Code != 200 || data["featured"] != true || data["categoryId"] != nil {
		t.Fatalf("curate clear category: status %d data %v", w.Code, data)
	}

	// 恢复归类，验证公开画廊 featured/category 筛选与字段
	w = env.do(t, "POST", "/api/admin/gallery/submissions/"+submissionID+"/curate",
		gin.H{"categoryId": categoryID}, adminToken)
	if w.Code != 200 {
		t.Fatalf("curate restore category: status %d", w.Code)
	}
	w = env.do(t, "GET", "/api/gallery?featured=1", nil, "")
	data, _ = decode(t, w)
	items := data["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("featured=1 items = %d, want 1", len(items))
	}
	item := items[0].(map[string]any)
	if item["featured"] != true {
		t.Fatalf("item featured = %v", item["featured"])
	}
	category := item["category"].(map[string]any)
	if category["id"] != categoryID || category["name"] != "插画" {
		t.Fatalf("item category = %v", category)
	}
	// featured=0 时不含精选
	w = env.do(t, "GET", "/api/gallery?featured=0", nil, "")
	data, _ = decode(t, w)
	if n := len(data["items"].([]any)); n != 0 {
		t.Fatalf("featured=0 items = %d, want 0", n)
	}
	// category 筛选
	w = env.do(t, "GET", "/api/gallery?category="+categoryID, nil, "")
	data, _ = decode(t, w)
	if n := len(data["items"].([]any)); n != 1 {
		t.Fatalf("category filter items = %d, want 1", n)
	}

	// 公开分类列表
	w = env.do(t, "GET", "/api/gallery/categories", nil, "")
	data, _ = decode(t, w)
	if n := len(data["items"].([]any)); n != 1 {
		t.Fatalf("public categories = %d, want 1", n)
	}
}

func TestCommunityTagsBatchCurateAndReorder(t *testing.T) {
	env := newCommunityEnv(t)
	user, userToken := env.newUserSession(t, "user")
	_, adminToken := env.newUserSession(t, "admin")

	if w := env.do(t, "PUT", "/api/admin/gallery/settings", gin.H{"autoApprove": true}, adminToken); w.Code != 200 {
		t.Fatalf("put settings: status %d body %s", w.Code, w.Body.String())
	}
	ids := make([]string, 0, 2)
	for range 2 {
		taskID := env.newSucceededTask(t, user.ID)
		w := env.do(t, "POST", "/api/gallery/submissions", gin.H{"taskId": taskID.String()}, userToken)
		data, _ := decode(t, w)
		if w.Code != 200 {
			t.Fatalf("submit: status %d body %s", w.Code, w.Body.String())
		}
		ids = append(ids, data["id"].(string))
	}

	w := env.do(t, "POST", "/api/admin/gallery/submissions/"+ids[0]+"/curate",
		gin.H{"tags": []string{" 人像 ", "电影感", "人像"}}, adminToken)
	data, _ := decode(t, w)
	if w.Code != 200 {
		t.Fatalf("curate tags: status %d body %s", w.Code, w.Body.String())
	}
	tags := data["tags"].([]any)
	if len(tags) != 2 || tags[0] != "人像" || tags[1] != "电影感" {
		t.Fatalf("normalized tags = %#v", tags)
	}

	w = env.do(t, "POST", "/api/admin/gallery/submissions/batch-curate", gin.H{
		"ids": ids, "featured": true, "tags": []string{"精选"}, "tagMode": "add",
	}, adminToken)
	data, _ = decode(t, w)
	if w.Code != 200 || data["updated"] != float64(2) {
		t.Fatalf("batch curate: status %d data %#v", w.Code, data)
	}
	for _, rawID := range ids {
		id := uuid.MustParse(rawID)
		submission, err := store.GetSubmission(context.Background(), env.st.Pool, id)
		if err != nil || submission == nil {
			t.Fatalf("get submission %s: %v", rawID, err)
		}
		if !submission.Featured || !store.Contains(submission.Tags, "精选") {
			t.Fatalf("batch result = featured:%v tags:%v", submission.Featured, submission.Tags)
		}
	}

	w = env.do(t, "POST", "/api/admin/gallery/submissions/reorder", gin.H{
		"ids": []string{ids[1], ids[0]},
	}, adminToken)
	if w.Code != 200 {
		t.Fatalf("reorder: status %d body %s", w.Code, w.Body.String())
	}
	first, _ := store.GetSubmission(context.Background(), env.st.Pool, uuid.MustParse(ids[1]))
	second, _ := store.GetSubmission(context.Background(), env.st.Pool, uuid.MustParse(ids[0]))
	if first.Sort != 10 || second.Sort != 20 {
		t.Fatalf("sorts = %d, %d; want 10, 20", first.Sort, second.Sort)
	}
}

func TestAuditActionCommunityPaths(t *testing.T) {
	id := uuid.NewString()
	cases := []struct {
		method, path, want string
	}{
		{"POST", "/api/admin/prompt-library", "prompt-library.create"},
		{"PATCH", "/api/admin/prompt-library/" + id, "prompt-library.update"},
		{"POST", "/api/admin/prompt-library/" + id + "/cover", "prompt-library.cover"},
		{"POST", "/api/admin/gallery/submissions/" + id + "/violation", "submissions.violation"},
		{"POST", "/api/admin/gallery/submissions/" + id + "/curate", "submissions.curate"},
		{"POST", "/api/admin/gallery/submissions/batch-curate", "submissions.batch-curate"},
		{"POST", "/api/admin/gallery/submissions/reorder", "submissions.reorder"},
		{"POST", "/api/admin/gallery/users/" + id + "/unban", "users.unban"},
		// 集合 POST 沿用既有「resource.末段」约定（同 settings.test-c2a）
		{"POST", "/api/admin/gallery/categories", "gallery.categories"},
		{"PATCH", "/api/admin/gallery/categories/" + id, "categories.update"},
		{"DELETE", "/api/admin/gallery/categories/" + id, "categories.delete"},
		{"PUT", "/api/admin/gallery/settings", "gallery.settings"},
	}
	for _, c := range cases {
		if got := auditAction(c.method, c.path); got != c.want {
			t.Errorf("auditAction(%s %s) = %q, want %q", c.method, c.path, got, c.want)
		}
	}
}
