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

// Restrict the compatibility envelope to its own namespace. The existing
// /api/open/v1 contract and all application routes keep their original shape.
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
			(c.Request.URL.Path == "/v1/images/generations" || c.Request.URL.Path == "/v1/images/edits") &&
			strings.TrimSpace(c.GetHeader("Idempotency-Key")) == "" {
			// A client cannot safely replay a paid POST using an ID generated
			// only in the previous response. OpenAI SDKs honor this retry hint.
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
		status, code, message = http.StatusGatewayTimeout, "request_timeout", "请求处理超时，请使用同一 Idempotency-Key 重试"
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
		// Never expose database, provider response bodies, URLs, or credentials.
		message = "服务器暂时无法处理请求，请稍后重试"
		if code == "image_generation_timeout" {
			message = "图片任务仍在处理，请用同一 Idempotency-Key 重试，任务 ID 见 X-Task-ID"
		}
		log.Printf("OpenAI-compatible request failed request_id=%s status=%d code=%s", c.GetString(ctxRequestIDKey), status, code)
	}
	var field any
	if param != "" {
		field = param
	}
	if status == http.StatusUnauthorized {
		c.Header("WWW-Authenticate", "Bearer")
	}
	c.Set(ctxPlatformErrorKey, code)
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{
		"message": message, "type": openAIErrorType(status), "param": field, "code": code,
	}})
}
