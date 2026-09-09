package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
)

func TestOriginGuardAcceptsConfiguredDevelopmentFrontend(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{Cfg: &config.Config{
		AllowedOrigins: "http://localhost:3105/, http://127.0.0.1:3105",
	}}
	engine := gin.New()
	engine.Use(server.originGuard)
	engine.POST("/write", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	for _, origin := range []string{
		"http://localhost:3105",
		"http://127.0.0.1:3105",
		"http://localhost:3105/",
	} {
		t.Run(origin, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/write", nil)
			request.Header.Set("Origin", origin)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			if response.Code != http.StatusNoContent {
				t.Fatalf("configured origin %q returned %d: %s", origin, response.Code, response.Body.String())
			}
		})
	}
}

func TestOriginGuardRejectsUnconfiguredOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{Cfg: &config.Config{AllowedOrigins: "http://127.0.0.1:3105"}}
	engine := gin.New()
	engine.Use(server.originGuard)
	engine.POST("/write", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.Header.Set("Origin", "http://localhost:3104")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("unconfigured origin returned %d: %s", response.Code, response.Body.String())
	}
}
