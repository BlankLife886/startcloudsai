// 社区运营（v3）：违规禁投、投稿开关/每日限额、autoApprove 直通、curate 幂等。
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
		req.AddCookie(&http.Cookie{Name: e.cfg.SessionCookieName, Value: token})
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
