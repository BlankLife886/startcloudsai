// 审计：action 归纳、敏感字段脱敏、截断，以及写入/查询往返。
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAdminAuditPreservesRequestBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name        string
		contentType string
		body        []byte
	}{
		{
			name:        "multipart upload",
			contentType: "multipart/form-data; boundary=test-boundary",
			body:        bytes.Repeat([]byte("upload-data"), 200_000),
		},
		{
			name:        "large json",
			contentType: "application/json",
			body:        []byte(`{"payload":"` + strings.Repeat("x", auditBodyReadLimit*2) + `"}`),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use((&Server{}).adminAudit)
			engine.POST("/api/admin/test", func(c *gin.Context) {
				got, err := io.ReadAll(c.Request.Body)
				if err != nil {
					t.Fatalf("read body: %v", err)
				}
				if !bytes.Equal(got, test.body) {
					t.Fatalf("body truncated: got %d bytes, want %d", len(got), len(test.body))
				}
				c.Status(http.StatusNoContent)
			})

			req := httptest.NewRequest(http.MethodPost, "/api/admin/test", bytes.NewReader(test.body))
			req.Header.Set("Content-Type", test.contentType)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			if w.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", w.Code, http.StatusNoContent)
			}
		})
	}
}

func TestAuditAction(t *testing.T) {
	id := uuid.NewString()
	cases := []struct {
		method, path, want string
	}{
		{"POST", "/api/admin/plans", "plans.create"},
		{"PATCH", "/api/admin/plans/" + id, "plans.update"},
		{"DELETE", "/api/admin/plans/" + id, "plans.delete"},
		{"POST", "/api/admin/tasks/" + id + "/requeue", "tasks.requeue"},
		{"POST", "/api/admin/tasks/" + id + "/cancel", "tasks.cancel"},
		{"POST", "/api/admin/tasks/" + id + "/force-fail", "tasks.force-fail"},
		{"POST", "/api/admin/users/" + id + "/reset-password", "users.reset-password"},
		{"POST", "/api/admin/users/" + id + "/wallet-adjust", "users.wallet-adjust"},
		{"POST", "/api/admin/orders/" + id + "/complete", "orders.complete"},
		{"PUT", "/api/admin/settings", "settings.update"},
		{"POST", "/api/admin/settings/test-c2a", "settings.test-c2a"},
		{"POST", "/api/admin/settings/test-sub2api", "settings.test-sub2api"},
		{"POST", "/api/admin/settings/test-crun", "settings.test-crun"},
		{"PUT", "/api/admin/model-config", "model-config.update"},
		{"POST", "/api/admin/model-config/discover-models", "model-config.discover-models"},
		{"PATCH", "/api/admin/users/" + id, "users.update"},
	}
	for _, c := range cases {
		if got := auditAction(c.method, c.path); got != c.want {
			t.Errorf("auditAction(%s %s) = %q, want %q", c.method, c.path, got, c.want)
		}
	}
}

func TestAuditDetailSanitizeAndTruncate(t *testing.T) {
	body := []byte(`{"newPassword":"super-secret","profile":{"apiSecret":"abc","name":"张三"},"items":[{"password":"x"}]}`)
	detail := auditDetail(body)
	var parsed map[string]any
	if err := json.Unmarshal(detail, &parsed); err != nil {
		t.Fatalf("detail 不是合法 JSON: %v", err)
	}
	if parsed["newPassword"] != "***" {
		t.Fatalf("newPassword = %v, want ***", parsed["newPassword"])
	}
	profile := parsed["profile"].(map[string]any)
	if profile["apiSecret"] != "***" || profile["name"] != "张三" {
		t.Fatalf("profile 脱敏错误: %v", profile)
	}
	item := parsed["items"].([]any)[0].(map[string]any)
	if item["password"] != "***" {
		t.Fatalf("数组内 password 未脱敏: %v", item)
	}
	if strings.Contains(string(detail), "super-secret") {
		t.Fatal("detail 泄漏了明文密码")
	}

	// 超长 body 截断后仍为合法 JSON
	big := []byte(`{"reason":"` + strings.Repeat("a", 5000) + `"}`)
	detail = auditDetail(big)
	var truncated map[string]any
	if err := json.Unmarshal(detail, &truncated); err != nil {
		t.Fatalf("截断后的 detail 不是合法 JSON: %v", err)
	}
	if truncated["truncated"] != true {
		t.Fatalf("expected truncated flag, got %v", truncated)
	}

	// 空 body → nil
	if auditDetail(nil) != nil || auditDetail([]byte("  ")) != nil {
		t.Fatal("空 body 应返回 nil detail")
	}

	// 非法 JSON 只记录元数据，绝不回落到可能包含凭据的原文。
	invalid := auditDetail([]byte(`{"password":"leaked"`))
	if strings.Contains(string(invalid), "leaked") || !strings.Contains(string(invalid), `"invalidJson":true`) {
		t.Fatalf("非法 JSON 摘要不安全: %s", invalid)
	}
}

func TestAuditLogInsertAndList(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	adminAccount, err := store.UpsertAdminAccount(ctx, st.Pool, "admin@test.dev", "admin", "x")
	if err != nil {
		t.Fatalf("insert admin: %v", err)
	}
	admin := adminAccountAsUser(adminAccount)

	entry := buildAuditEntry(admin, "POST", "/api/admin/plans", "", 200, "127.0.0.1",
		[]byte(`{"code":"basic","name":"基础包","secretKey":"hush"}`))
	if err := store.InsertAuditLog(ctx, st.Pool, entry); err != nil {
		t.Fatalf("insert audit log: %v", err)
	}

	rows, err := store.ListAuditLogs(ctx, st.Pool, "admin@test", "/plans", 20, nil)
	if err != nil {
		t.Fatalf("list audit logs: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	got := rows[0]
	if got.Action != "plans.create" || got.AdminEmail != "admin@test.dev" || got.Status != 200 {
		t.Fatalf("row = %+v", got)
	}
	if got.AdminID == nil || *got.AdminID != admin.ID {
		t.Fatalf("adminId = %v, want %s", got.AdminID, admin.ID)
	}
	var detail map[string]any
	if err := json.Unmarshal(got.Detail, &detail); err != nil {
		t.Fatalf("detail 不是合法 JSON: %v", err)
	}
	if detail["secretKey"] != "***" || detail["code"] != "basic" {
		t.Fatalf("detail = %v", detail)
	}

	// 筛选不匹配时为空
	rows, err = store.ListAuditLogs(ctx, st.Pool, "nobody", "", 20, nil)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows = %d, want 0", len(rows))
	}
}
