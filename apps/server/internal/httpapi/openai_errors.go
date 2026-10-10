package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Restrict the OpenAI error envelope to the developer API namespace; all
// application routes keep their original shape.
func isOpenAICompatPath(path string) bool {
	return path == "/v1" || strings.HasPrefix(path, "/v1/")
}

func ensureOpenAIRequestID(c *gin.Context) {
	requestID := c.GetString(ctxRequestIDKey)
	if requestID == "" && c.Request != nil {
		requestID = requestIDFromContext(c.Request.Context())
	}
	if requestID == "" {
		requestID = uuid.NewString()
	}
	c.Set(ctxRequestIDKey, requestID)
	c.Header("X-Request-ID", requestID)
	if c.Request != nil {
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestIDContextKey{}, requestID))
	}
}

func openAICompatRequestMiddleware(c *gin.Context) {
	if isOpenAICompatPath(c.Request.URL.Path) {
		// Request IDs are part of the public API even when platform logging is off.
		ensureOpenAIRequestID(c)
		if c.Request.Method == http.MethodPost &&
			(c.Request.URL.Path == "/v1/images/generations" || c.Request.URL.Path == "/v1/images/edits" || c.Request.URL.Path == "/v1/chat/completions") {
			// Paid requests are never retried: a failure is final and released,
			// and a blind SDK retry would start a second paid request.
			c.Header("X-Should-Retry", "false")
		}
	}
	c.Next()
}

func openAIErrorType(status int) string {
	switch {
	case status == http.StatusUnauthorized:
		return "authentication_error"
	case status == http.StatusForbidden:
		return "permission_error"
	case status == http.StatusTooManyRequests:
		return "rate_limit_error"
	case status >= http.StatusInternalServerError:
		return "server_error"
	default:
		return "invalid_request_error"
	}
}

// failOpenAI writes the error object expected by OpenAI-compatible clients.
// An empty param is serialized as null; handlers can identify a rejected input
// with failOpenAI(c, err, "model") without changing shared business errors.
// openAIExplainedServerErrors are 5xx codes whose messages the developer API
// writes itself (see developerUpstreamError) and that are safe to show.
var openAIExplainedServerErrors = map[string]bool{
	"upstream_error": true, "upstream_unreachable": true, "upstream_misconfigured": true,
	"request_timeout": true, "provider_misconfigured": true, "image_result_unavailable": true,
	"model_zero_price_blocked": true, "model_price_inverted": true, "security_limit_unavailable": true,
	"billing_settlement_failed": true, "open_api_disabled": true, "developer_api_disabled": true,
	"model_unavailable": true,
}

func failOpenAI(c *gin.Context, err error, param string) {
	if errors.Is(err, context.Canceled) ||
		(c.Request != nil && errors.Is(c.Request.Context().Err(), context.Canceled)) {
		c.Abort()
		return
	}
	ensureOpenAIRequestID(c)
	status, code, message := http.StatusInternalServerError, "internal_error", "服务器内部错误"
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &tooLarge):
		status, code, message = http.StatusRequestEntityTooLarge, "request_too_large", "请求体超过允许的大小"
	case errors.Is(err, context.DeadlineExceeded):
		status, code, message = http.StatusGatewayTimeout, "request_timeout", "请求处理超时，本次请求不扣费"
	default:
		if appErr, ok := apperr.As(err); ok {
			status, code, message = appErr.Status, appErr.Code, appErr.Message
			if code == "api_key_required" || code == "api_key_invalid" {
				code = "invalid_api_key"
			}
			// Shared task validation uses 422; the compatibility API uses 400.
			if status == http.StatusUnprocessableEntity {
				status = http.StatusBadRequest
			}
		}
	}
	if status >= http.StatusInternalServerError {
		// Only the developer API's own server-side errors explain themselves;
		// shared code may build messages from provider or database text, so
		// everything else is generic. The request ID locates the logged cause.
		if !openAIExplainedServerErrors[code] {
			message = "服务器内部错误"
		}
		message += "（请求 ID：" + c.GetString(ctxRequestIDKey) + "）"
		log.Printf("OpenAI-compatible request failed request_id=%s status=%d code=%s", c.GetString(ctxRequestIDKey), status, code)
	}
	var field any
	if param != "" {
		field = param
	}
	if status == http.StatusUnauthorized {
		c.Header("WWW-Authenticate", "Bearer")
	}
	if code == "model_unavailable" {
		// Rejected before any credits are reserved, so a retry cannot pay twice.
		c.Header("Retry-After", "60")
		c.Header("X-Should-Retry", "true")
	}
	c.Set(ctxPlatformErrorKey, code)
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{
		"message": message, "type": openAIErrorType(status), "param": field, "code": code,
	}})
}
