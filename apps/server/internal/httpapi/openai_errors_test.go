package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/gin-gonic/gin"
)

func readOpenAIErrorForTest(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON error, got %q: %v", response.Body.String(), err)
	}
	if len(body) != 1 {
		t.Fatalf("compatibility error must have only its error field: %#v", body)
	}
	apiErr, ok := body["error"].(map[string]any)
	if !ok || len(apiErr) != 4 {
		t.Fatalf("expected message/type/param/code error object: %#v", body)
	}
	for _, field := range []string{"message", "type", "param", "code"} {
		if _, exists := apiErr[field]; !exists {
			t.Errorf("missing error.%s: %#v", field, apiErr)
		}
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Error("compatibility error must include X-Request-ID")
	}
	return apiErr
}

func TestOpenAIErrorEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name, code, message, param, wantType, wantCode string
		status, wantStatus                             int
	}{
		{"missing key", "api_key_required", "API Key required", "", "authentication_error", "invalid_api_key", 401, 401},
		{"expired key", "api_key_invalid", "API Key expired", "", "authentication_error", "invalid_api_key", 401, 401},
		{"scope", "api_key_scope_denied", "Missing tasks:write", "", "permission_error", "api_key_scope_denied", 403, 403},
		{"model", "validation_error", "Unknown model", "model", "invalid_request_error", "validation_error", 422, 400},
		{"quota", "insufficient_balance", "Insufficient balance", "", "invalid_request_error", "insufficient_balance", 400, 400},
		{"rate limit", "rate_limited", "Rate limit reached", "", "rate_limit_error", "rate_limited", 429, 429},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
			if test.status == http.StatusTooManyRequests {
				c.Header("Retry-After", "37")
			}
			failOpenAI(c, apperr.E(test.code, test.message, test.status), test.param)
			body := readOpenAIErrorForTest(t, response)
			if response.Code != test.wantStatus || body["type"] != test.wantType || body["code"] != test.wantCode || body["message"] != test.message {
				t.Fatalf("unexpected status=%d body=%#v", response.Code, body)
			}
			if test.param == "" && body["param"] != nil || test.param != "" && body["param"] != test.param {
				t.Errorf("unexpected param: %#v", body["param"])
			}
			if test.status == http.StatusTooManyRequests && response.Header().Get("Retry-After") != "37" {
				t.Error("rate limit response lost Retry-After")
			}
			if !c.IsAborted() || c.GetString(ctxPlatformErrorKey) != test.wantCode {
				t.Error("failure must abort and retain its code for platform logs")
			}
		})
	}
}

func TestOpenAIErrorNamespacePreservesLegacyEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, path := range []string{"/api/open/v1/models", "/api/v1/tasks", "/v10/models", "/v1-other"} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Request = httptest.NewRequest(http.MethodGet, path, nil)
			fail(c, apperr.E("api_key_required", "API Key required", http.StatusUnauthorized))
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if len(body) != 3 || body["success"] != false || body["code"] != "api_key_required" || body["error"] != "API Key required" {
				t.Fatalf("legacy envelope changed: %#v", body)
			}
			if response.Header().Get("X-Request-ID") != "" {
				t.Error("legacy fail unexpectedly created a request ID")
			}
		})
	}
}

func TestOpenAIErrorRedactsServerFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var logs bytes.Buffer
	previousWriter := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previousWriter) })
	for _, err := range []error{
		errors.New("database connection contained secret-password"),
		apperr.E("provider_failure", "https://provider.invalid?api_key=secret-password", http.StatusBadGateway),
	} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
		fail(c, err)
		body := readOpenAIErrorForTest(t, response)
		if body["type"] != "server_error" || strings.Contains(response.Body.String(), "secret-password") {
			t.Fatalf("server detail leaked: %#v", body)
		}
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	c.Header("X-Task-ID", "existing-image-task")
	failOpenAI(c, apperr.E("image_generation_timeout", "private upstream timeout detail", http.StatusGatewayTimeout), "")
	body := readOpenAIErrorForTest(t, response)
	if response.Code != http.StatusGatewayTimeout || body["code"] != "image_generation_timeout" || !strings.Contains(body["message"].(string), "同一 Idempotency-Key") || response.Header().Get("X-Task-ID") != "existing-image-task" {
		t.Fatalf("pending-task timeout must explain safe retries: %#v", body)
	}
	if strings.Contains(logs.String(), "secret-password") || strings.Contains(logs.String(), "private upstream") || strings.Contains(logs.String(), "provider.invalid") {
		t.Fatal("server errors must not disclose their original details in logs")
	}
	if !strings.Contains(logs.String(), "request_id=") || !strings.Contains(logs.String(), "status=504 code=image_generation_timeout") {
		t.Fatal("safe request/status/code metadata must remain available for diagnostics")
	}
}

func TestOpenAIErrorCanceledRequestWritesNothing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(ctx)
	failOpenAI(c, fmt.Errorf("wrapped cancellation: %w", context.Canceled), "")
	if !c.IsAborted() || response.Body.Len() != 0 {
		t.Fatalf("canceled client should receive no response body: %q", response.Body.String())
	}
}

func TestOpenAIRequestIDReusesPlatformID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	c.Request.Header.Set("X-Request-ID", "untrusted-client-value")
	c.Set(ctxRequestIDKey, "existing-platform-request")
	ensureOpenAIRequestID(c)
	if response.Header().Get("X-Request-ID") != "existing-platform-request" || requestIDFromContext(c.Request.Context()) != "existing-platform-request" {
		t.Fatal("compatibility API must reuse platform logging's request ID")
	}
}

func TestOpenAIImageRetryHintRequiresClientIdempotencyKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		method, path, key, want string
	}{
		{"POST", "/v1/images/generations", "", "false"},
		{"POST", "/v1/images/edits", "   ", "false"},
		{"POST", "/v1/images/generations", "client-attempt-123", ""},
		{"POST", "/v1/images/edits", "client-attempt-123", ""},
		{"GET", "/v1/models", "", ""},
		{"POST", "/api/v1/tasks", "", ""},
	} {
		t.Run(test.method+test.path+test.key, func(t *testing.T) {
			engine := gin.New()
			engine.Use(openAICompatRequestMiddleware)
			engine.Handle(test.method, test.path, func(c *gin.Context) { c.Status(http.StatusServiceUnavailable) })
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Header.Set("Idempotency-Key", test.key)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			if got := response.Header().Get("X-Should-Retry"); got != test.want {
				t.Fatalf("retry hint = %q, want %q", got, test.want)
			}
		})
	}
}

func TestOpenAIRouterFailuresAndBodyLimits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var logs bytes.Buffer
	previousWriter, previousGinWriter := log.Writer(), gin.DefaultErrorWriter
	log.SetOutput(&logs)
	gin.DefaultErrorWriter = &logs
	t.Cleanup(func() { log.SetOutput(previousWriter); gin.DefaultErrorWriter = previousGinWriter })
	server := &Server{Cfg: &config.Config{
		AppEnv: "test", AllowedOrigins: "http://allowed.invalid", UploadMaxBytes: 15 << 20,
	}}
	// Avoid database fixtures: these cases all fail before a key lookup, while
	// using the production router/middleware chain and public page gate.
	server.pageControls = pageControlCache{
		controls:  map[string]settings.PageControl{"developer_api": {Status: settings.PageStatusNormal}},
		expiresAt: time.Now().Add(time.Hour),
	}
	router := server.Router()
	router.POST("/v1/limit-fixture", func(c *gin.Context) {
		if _, err := io.Copy(io.Discard, c.Request.Body); err != nil {
			fail(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})
	router.GET("/v1/panic-fixture", func(c *gin.Context) { panic("private provider detail") })
	for _, test := range []struct {
		name, method, path, authorization, origin string
		length                                    int64
		status                                    int
		code                                      string
	}{
		{"root not found", "GET", "/v1", "", "", 0, 404, "not_found"},
		{"route not found", "GET", "/v1/not-implemented", "", "", 0, 404, "not_found"},
		{"wrong method", "POST", "/v1/models", "", "", 0, 405, "bad_request"},
		{"missing key", "GET", "/v1/models", "", "", 0, 401, "invalid_api_key"},
		{"retrieve model missing key", "GET", "/v1/models/demo-image", "", "", 0, 401, "invalid_api_key"},
		{"invalid generation key", "POST", "/v1/images/generations", "Bearer demo_invalid", "", 0, 401, "invalid_api_key"},
		{"invalid edit key", "POST", "/v1/images/edits", "Bearer demo_invalid", "", 0, 401, "invalid_api_key"},
		{"origin guard", "POST", "/v1/images/generations", "", "http://denied.invalid", 0, 403, "origin_not_allowed"},
		{"generation too large", "POST", "/v1/images/generations", "", "", (1 << 20) + 1, 413, "request_too_large"},
		{"edit too large", "POST", "/v1/images/edits", "", "", (33 << 20) + 1, 413, "request_too_large"},
		{"edit accepts upload-sized body", "POST", "/v1/images/edits", "", "", 2 << 20, 401, "invalid_api_key"},
		{"panic", "GET", "/v1/panic-fixture", "", "", 0, 500, "internal_error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			request.ContentLength = test.length
			request.Header.Set("Authorization", test.authorization)
			request.Header.Set("Origin", test.origin)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			body := readOpenAIErrorForTest(t, response)
			if response.Code != test.status || body["code"] != test.code {
				t.Fatalf("unexpected status=%d error=%#v", response.Code, body)
			}
		})
	}

	t.Run("chunked request limit", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodPost, "/v1/limit-fixture", strings.NewReader(strings.Repeat("x", (1<<20)+1)))
		request.ContentLength = -1
		request.TransferEncoding = []string{"chunked"}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		body := readOpenAIErrorForTest(t, response)
		if response.Code != http.StatusRequestEntityTooLarge || body["code"] != "request_too_large" {
			t.Fatalf("chunked body escaped request size limit: status=%d error=%#v", response.Code, body)
		}
	})
	if platformRequestScope("/v1/images/generations") != "open-api" || platformRequestScope("/v10/models") != "user" {
		t.Fatal("compatibility API logging scope must match only its namespace")
	}
	if strings.Contains(logs.String(), "private provider detail") {
		t.Fatal("compatibility recovery must not log panic values")
	}
}
