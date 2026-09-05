package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/platformlog"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	ctxPlatformUserKey  = "platformUser"
	ctxRequestIDKey     = "platformRequestId"
	ctxPlatformErrorKey = "platformErrorCode"
)

type requestIDContextKey struct{}

func requestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDContextKey{}).(string)
	return value
}

func platformLogRoute(c *gin.Context) string {
	if route := strings.TrimSpace(c.FullPath()); route != "" {
		return route
	}
	return c.Request.URL.Path
}

func platformLogCandidate(method, route string, status int, duration time.Duration) (category, level, event string) {
	if strings.HasPrefix(route, "/api/v1/admin/platform-logs") {
		// Log maintenance is already covered by the immutable admin audit log;
		// excluding it here lets "clear all" actually leave the table empty.
		return "", "", ""
	}
	isWrite := method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete
	isAuth := strings.Contains(route, "/auth/session") || strings.Contains(route, "/email-verification-codes")
	switch {
	case status == http.StatusTooManyRequests:
		return "security", "warning", "security.rate_limited"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "security", "warning", "security.access_denied"
	case isAuth && isWrite:
		if status >= 400 {
			return "security", "warning", "security.authentication_failed"
		}
		if method == http.MethodDelete {
			return "security", "info", "security.logout"
		}
		return "security", "info", "security.authentication_succeeded"
	case status >= 500:
		return "operations", "error", "operations.request_failed"
	case duration >= 2*time.Second:
		return "operations", "warning", "operations.slow_request"
	case strings.HasPrefix(route, "/internal/"):
		return "operations", "info", "operations.internal_callback"
	case strings.HasPrefix(route, "/api/v1/admin/") && isWrite:
		return "operations", "info", "operations.admin_action"
	case strings.HasPrefix(route, "/api/v1/") && isWrite:
		return "user", "info", "user.action"
	default:
		return "", "", ""
	}
}

func platformLogTaskID(c *gin.Context, route string) *uuid.UUID {
	if !strings.Contains(route, "/tasks/") {
		return nil
	}
	id, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		return nil
	}
	return &id
}

func contextUser(c *gin.Context, key string) *store.User {
	value, exists := c.Get(key)
	if !exists {
		return nil
	}
	user, _ := value.(*store.User)
	return user
}

func platformClientKind(userAgent string) string {
	value := strings.ToLower(strings.TrimSpace(userAgent))
	switch {
	case value == "":
		return "unknown"
	case strings.Contains(value, "dart") || strings.Contains(value, "flutter"):
		return "mobile-app"
	case strings.Contains(value, "android") || strings.Contains(value, "iphone") || strings.Contains(value, "ipad"):
		return "mobile-web"
	case strings.Contains(value, "mozilla"):
		return "browser"
	case strings.Contains(value, "curl") || strings.Contains(value, "postman") || strings.Contains(value, "insomnia"):
		return "api-client"
	default:
		return "service-client"
	}
}

func platformRequestScope(route string) string {
	switch {
	case strings.HasPrefix(route, "/api/v1/admin/"):
		return "admin"
	case strings.HasPrefix(route, "/api/open/"):
		return "open-api"
	case strings.HasPrefix(route, "/internal/"):
		return "internal"
	default:
		return "user"
	}
}

func platformRequestOutcome(status int) string {
	switch {
	case status >= 500:
		return "server-error"
	case status >= 400:
		return "client-error"
	case status >= 300:
		return "redirect"
	default:
		return "success"
	}
}

func (s *Server) platformLoggingMiddleware(c *gin.Context) {
	if s.Logs == nil {
		c.Next()
		return
	}
	config := s.Logs.Current(c.Request.Context())
	if !config.Enabled {
		c.Next()
		return
	}
	requestID := uuid.NewString()
	c.Set(ctxRequestIDKey, requestID)
	c.Header("X-Request-ID", requestID)
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestIDContextKey{}, requestID))
	started := time.Now()
	c.Next()

	duration := time.Since(started)
	route := platformLogRoute(c)
	category, level, eventName := platformLogCandidate(c.Request.Method, route, c.Writer.Status(), duration)
	if category == "" || !config.CategoryEnabled(category) {
		return
	}
	durationMs := duration.Milliseconds()
	statusCode := c.Writer.Status()
	var userID, adminID *uuid.UUID
	if user := contextUser(c, ctxPlatformUserKey); user != nil {
		id := user.ID
		userID = &id
	}
	if admin := contextUser(c, ctxAdminUserKey); admin != nil {
		id := admin.ID
		adminID = &id
	}
	message := fmt.Sprintf("%s %s -> %d", c.Request.Method, route, statusCode)
	metadata := map[string]any{
		"method":        c.Request.Method,
		"route":         route,
		"scope":         platformRequestScope(route),
		"client":        platformClientKind(c.Request.UserAgent()),
		"outcome":       platformRequestOutcome(statusCode),
		"responseBytes": c.Writer.Size(),
		"contentLength": max(c.Request.ContentLength, 0),
		"aborted":       c.IsAborted(),
		"slow":          duration >= 2*time.Second,
	}
	if value, exists := c.Get(ctxPlatformErrorKey); exists {
		if code, ok := value.(string); ok && strings.TrimSpace(code) != "" {
			metadata["errorCode"] = code
		}
	}
	attrs := []any{
		"event", eventName, "category", category, "request_id", requestID,
		"method", c.Request.Method, "route", route, "status", statusCode, "duration_ms", durationMs,
	}
	switch level {
	case "error":
		slog.Error("platform_event", attrs...)
	case "warning":
		slog.Warn("platform_event", attrs...)
	default:
		slog.Info("platform_event", attrs...)
	}
	s.Logs.Record(c.Request.Context(), platformlog.Event{
		Category: category, Level: level, Event: eventName, Message: message,
		RequestID: requestID, UserID: userID, AdminID: adminID,
		TaskID: platformLogTaskID(c, route), ClientIP: c.ClientIP(),
		StatusCode: &statusCode, DurationMs: &durationMs, Metadata: metadata,
	})
}
