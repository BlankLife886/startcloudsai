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
		// multipart 中包含图片等二进制数据，不需要写入审计详情，也不能为了
		// 截取摘要提前消费请求体。之前这里只把前 64KB 放回 Body，导致所有
		// 超过 64KB 的后台上传都在 handler 中得到 unexpected EOF。
		if !strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
			original := c.Request.Body
			body, _ = io.ReadAll(io.LimitReader(original, auditBodyReadLimit))
			// 把已读取的前缀和尚未读取的剩余流重新拼接，业务 handler 仍能读取
			// 完整正文；关闭新 Body 时同时关闭原始网络流。
			c.Request.Body = struct {
				io.Reader
				io.Closer
			}{
				Reader: io.MultiReader(bytes.NewReader(body), original),
				Closer: original,
			}
		}
	}
	c.Next()

	adminVal, exists := c.Get(ctxAdminUserKey)
	if !exists {
		return // 未通过管理员鉴权，无操作者可归属
	}
	admin := adminVal.(*store.User)
	entry := buildAuditEntry(admin, c.Request.Method, c.Request.URL.Path, c.Param("id"),
		c.Writer.Status(), c.ClientIP(), body)
	s.writeAuditEntry(entry)
}

func (s *Server) writeAuditEntry(entry *store.AdminAuditLog) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.InsertAuditLog(ctx, s.St.Pool, entry); err != nil {
			log.Printf("write audit log for %s %s: %v", entry.Method, entry.Path, err)
		}
	}()
}

func (s *Server) writeAdminAuthAudit(action, email, method, path string, status int, ip string, admin *store.AdminAccount) {
	entry := &store.AdminAuditLog{
		AdminEmail: email,
		Method:     method,
		Path:       path,
		Action:     action,
		Status:     status,
	}
	if admin != nil {
		id := admin.ID
		entry.AdminID = &id
		entry.AdminEmail = admin.Email
	}
	if ip != "" {
		entry.IP = &ip
	}
	s.writeAuditEntry(entry)
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

// auditAction derives a stable resource.operation label from a REST path.
// UUID path segments are identifiers; the nearest named segment is the resource.
func auditAction(method, path string) string {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/v1/admin"), "/")
	if trimmed == "" {
		return strings.ToLower(method)
	}
	segs := strings.Split(trimmed, "/")
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
	case "GET":
		return resource + ".read"
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
		out, _ := json.Marshal(gin.H{"invalidJson": true, "bytes": len(trimmed)})
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

// sanitizeAuditValue 递归把字段名含 password/secret/apikey/token 的值替换为 "***"。
func sanitizeAuditValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			lower := strings.ReplaceAll(strings.ToLower(k), "_", "")
			if strings.Contains(lower, "password") || strings.Contains(lower, "secret") ||
				strings.Contains(lower, "apikey") || strings.Contains(lower, "token") {
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
