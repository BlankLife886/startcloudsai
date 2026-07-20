// 后台操作审计：admin 路由组中间件，非 GET 请求完成后异步写 admin_audit_logs。
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const ctxAdminUserKey = "adminUser"

// auditDetailMaxBytes 请求体摘要上限（2KB）。
const auditDetailMaxBytes = 2048

// auditBodyReadLimit 中间件缓存请求体的读取上限，避免恶意超大 body 占用内存。
const auditBodyReadLimit = 64 << 10

// adminAudit 缓存请求体，待 handler 完成后异步落审计日志。
// 仅记录已通过管理员鉴权的请求（成功与否均记录响应状态码）。
func (s *Server) adminAudit(c *gin.Context) {
	if c.Request.Method == "GET" {
		c.Next()
		return
	}
	var body []byte
	if c.Request.Body != nil {
		body, _ = io.ReadAll(io.LimitReader(c.Request.Body, auditBodyReadLimit))
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
	}
	c.Next()

	adminVal, exists := c.Get(ctxAdminUserKey)
	if !exists {
		return // 未通过管理员鉴权，无操作者可归属
	}
	admin := adminVal.(*store.User)
	entry := buildAuditEntry(admin, c.Request.Method, c.Request.URL.Path, c.Param("id"),
		c.Writer.Status(), c.ClientIP(), body)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.InsertAuditLog(ctx, s.St.Pool, entry); err != nil {
			log.Printf("write audit log for %s %s: %v", entry.Method, entry.Path, err)
		}
	}()
}

func buildAuditEntry(admin *store.User, method, path, targetID string, status int, ip string, body []byte) *store.AdminAuditLog {
	adminID := admin.ID
	entry := &store.AdminAuditLog{
		AdminID:    &adminID,
		AdminEmail: admin.Email,
		Method:     method,
		Path:       path,
		Action:     auditAction(method, path),
		Status:     status,
		Detail:     auditDetail(body),
	}
	if targetID != "" {
		entry.TargetID = &targetID
	}
	if ip != "" {
		entry.IP = &ip
	}
	return entry
}

// auditAction 从 method+path 归纳动作名：资源段.动词。
// 资源段取离末尾最近的非 id 段（嵌套路径归属子资源，如
// POST /api/admin/gallery/submissions/:id/violation → submissions.violation）。
// POST /api/admin/plans → plans.create；PATCH/PUT → .update；DELETE → .delete；
// 末段为动词（非 id）时直接采用，如 POST /api/admin/tasks/:id/requeue → tasks.requeue。
func auditAction(method, path string) string {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/admin"), "/")
	if trimmed == "" {
		return strings.ToLower(method)
	}
	segs := strings.Split(trimmed, "/")
	last := segs[len(segs)-1]
	if len(segs) > 1 && !isUUIDSegment(last) {
		resource := segs[0]
		for i := len(segs) - 2; i >= 0; i-- {
			if !isUUIDSegment(segs[i]) {
				resource = segs[i]
				break
			}
		}
		return resource + "." + last
	}
	resource := segs[0]
	for i := len(segs) - 1; i >= 0; i-- {
		if !isUUIDSegment(segs[i]) {
			resource = segs[i]
			break
		}
	}
	switch method {
	case "POST":
		return resource + ".create"
	case "PATCH", "PUT":
		return resource + ".update"
	case "DELETE":
		return resource + ".delete"
	}
	return resource + "." + strings.ToLower(method)
}

func isUUIDSegment(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}

// auditDetail 请求体 → jsonb 摘要：敏感字段脱敏 + 截断 2KB（截断后仍为合法 JSON）。
func auditDetail(body []byte) []byte {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(trimmed, &v); err != nil {
		raw := string(trimmed)
		if len(raw) > auditDetailMaxBytes {
			raw = raw[:auditDetailMaxBytes]
		}
		out, _ := json.Marshal(gin.H{"raw": raw})
		return out
	}
	out, err := json.Marshal(sanitizeAuditValue(v))
	if err != nil {
		return nil
	}
	if len(out) > auditDetailMaxBytes {
		out, _ = json.Marshal(gin.H{"truncated": true, "raw": string(out[:auditDetailMaxBytes])})
	}
	return out
}

// sanitizeAuditValue 递归把字段名含 password/secret 的值替换为 "***"。
func sanitizeAuditValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			lower := strings.ToLower(k)
			if strings.Contains(lower, "password") || strings.Contains(lower, "secret") {
				t[k] = "***"
			} else {
				t[k] = sanitizeAuditValue(val)
			}
		}
		return t
	case []any:
		for i := range t {
			t[i] = sanitizeAuditValue(t[i])
		}
		return t
	}
	return v
}
