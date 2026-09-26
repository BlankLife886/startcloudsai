package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/platformlog"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
)

func setPlatformLogSetting(t *testing.T, st *store.Store, key string, value json.RawMessage) {
	t.Helper()
	if err := settings.Set(context.Background(), st.Pool, key, value); err != nil {
		t.Fatal(err)
	}
}

func TestPlatformLoggingMiddlewareHonorsMasterAndCategorySwitches(t *testing.T) {
	st := testdb.Setup(t)
	recorder := platformlog.New(st.Pool, "api-test")
	srv := &Server{St: st, Logs: recorder}
	engine := gin.New()
	engine.Use(srv.platformLoggingMiddleware)
	engine.POST("/api/v1/items", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	engine.GET("/api/v1/private", func(c *gin.Context) { c.Status(http.StatusUnauthorized) })

	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/items", nil))
	stats, err := store.GetPlatformLogStats(context.Background(), st.Pool)
	if err != nil || stats.Count != 0 || response.Header().Get("X-Request-ID") != "" {
		t.Fatalf("disabled request stats=%#v requestID=%q err=%v", stats, response.Header().Get("X-Request-ID"), err)
	}

	setPlatformLogSetting(t, st, "platform_logging_enabled", json.RawMessage(`true`))
	setPlatformLogSetting(t, st, "platform_log_security_enabled", json.RawMessage(`true`))
	setPlatformLogSetting(t, st, "platform_log_user_enabled", json.RawMessage(`false`))
	recorder.Invalidate()
	response = httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/items", nil))
	stats, err = store.GetPlatformLogStats(context.Background(), st.Pool)
	if err != nil || stats.Count != 0 || response.Header().Get("X-Request-ID") == "" {
		t.Fatalf("disabled user category stats=%#v requestID=%q err=%v", stats, response.Header().Get("X-Request-ID"), err)
	}

	response = httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/private", nil)
	request.Header.Set("User-Agent", "curl/8.7.1")
	engine.ServeHTTP(response, request)
	items, err := store.ListPlatformLogs(context.Background(), st.Pool, store.PlatformLogFilter{Category: "security", Limit: 10})
	if err != nil || len(items) != 1 || items[0].Event != "security.access_denied" {
		t.Fatalf("security items=%#v err=%v", items, err)
	}
	if items[0].Metadata["client"] != "api-client" || items[0].Metadata["outcome"] != "client-error" {
		t.Fatalf("security diagnostics=%#v", items[0].Metadata)
	}

	setPlatformLogSetting(t, st, "platform_log_user_enabled", json.RawMessage(`true`))
	recorder.Invalidate()
	response = httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/items", nil))
	items, err = store.ListPlatformLogs(context.Background(), st.Pool, store.PlatformLogFilter{Category: "user", Limit: 10})
	if err != nil || len(items) != 1 || items[0].Event != "user.action" {
		t.Fatalf("user items=%#v err=%v", items, err)
	}
}

func TestAdminPlatformLogListStatsAndDelete(t *testing.T) {
	st := testdb.Setup(t)
	recorder := platformlog.New(st.Pool, "api-test")
	setPlatformLogSetting(t, st, "platform_logging_enabled", json.RawMessage(`true`))
	setPlatformLogSetting(t, st, "platform_log_security_enabled", json.RawMessage(`true`))
	recorder.Invalidate()
	recorder.Record(context.Background(), platformlog.Event{Category: "security", Level: "warning", Event: "security.test", Message: "denied"})
	srv := &Server{St: st, Logs: recorder}

	call := func(method, target string, handler func(*gin.Context, *store.User)) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(method, target, nil)
		handler(c, nil)
		return response
	}

	if response := call(http.MethodGet, "/api/v1/admin/platform-logs?range=invalid", srv.adminPlatformLogs); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid range status=%d body=%s", response.Code, response.Body.String())
	}
	if response := call(http.MethodGet, "/api/v1/admin/platform-logs?category=security&range=all", srv.adminPlatformLogs); response.Code != http.StatusOK || !containsJSON(response.Body.Bytes(), `"event":"security.test"`) {
		t.Fatalf("list status=%d body=%s", response.Code, response.Body.String())
	}
	if response := call(http.MethodGet, "/api/v1/admin/platform-logs/stats?range=24h", srv.adminPlatformLogStats); response.Code != http.StatusOK || !containsJSON(response.Body.Bytes(), `"count":1`) || !containsJSON(response.Body.Bytes(), `"p95DurationMs"`) {
		t.Fatalf("stats status=%d body=%s", response.Code, response.Body.String())
	}
	if response := call(http.MethodDelete, "/api/v1/admin/platform-logs", srv.adminDeletePlatformLogs); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unsafe clear status=%d body=%s", response.Code, response.Body.String())
	}
	if response := call(http.MethodDelete, "/api/v1/admin/platform-logs?all=true", srv.adminDeletePlatformLogs); response.Code != http.StatusOK || !containsJSON(response.Body.Bytes(), `"deleted":1`) {
		t.Fatalf("clear status=%d body=%s", response.Code, response.Body.String())
	}
}

func containsJSON(body []byte, fragment string) bool {
	var value any
	if json.Unmarshal(body, &value) != nil {
		return false
	}
	encoded, err := json.Marshal(value)
	return err == nil && strings.Contains(string(encoded), fragment)
}
