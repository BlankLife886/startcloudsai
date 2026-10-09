package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func newCORSTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.Use(openAICORSMiddleware)
	r.POST("/v1/images/generations", func(c *gin.Context) { c.Status(http.StatusUnauthorized) })
	r.POST("/api/v1/tasks", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func TestOpenAICORSPreflight(t *testing.T) {
	r := newCORSTestRouter()
	req := httptest.NewRequest(http.MethodOptions, "/v1/images/generations", nil)
	req.Header.Set("Origin", "https://canvas.best")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "authorization, content-type, x-stainless-os")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Headers"); got != "authorization, content-type, x-stainless-os" {
		t.Fatalf("allow headers = %q", got)
	}
	if w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("credentials must never be allowed")
	}
}

func TestOpenAICORSOnResponsesOnlyForV1(t *testing.T) {
	r := newCORSTestRouter()
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	req.Header.Set("Origin", "https://canvas.best")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized || w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("v1 error response: status %d, allow origin %q", w.Code, w.Header().Get("Access-Control-Allow-Origin"))
	}

	for _, method := range []string{http.MethodOptions, http.MethodPost} {
		req = httptest.NewRequest(method, "/api/v1/tasks", nil)
		req.Header.Set("Origin", "https://canvas.best")
		req.Header.Set("Access-Control-Request-Method", "POST")
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s /api/v1 must not get CORS headers", method)
		}
	}
}
