package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
)

func TestRouterExposesOnlyVersionedRESTContract(t *testing.T) {
	server := &Server{Cfg: &config.Config{AppEnv: "test", TrustedProxies: "127.0.0.1"}}
	registered := make(map[string]bool)
	for _, route := range server.Router().Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	wanted := []string{
		"POST /api/v1/auth/session",
		"GET /api/v1/auth/session",
		"DELETE /api/v1/auth/session",
		"GET /api/v1/tasks",
		"POST /api/v1/tasks",
		"PATCH /api/v1/tasks/:id",
		"DELETE /api/v1/tasks/:id",
		"GET /api/v1/gallery/submissions",
		"GET /api/v1/admin/prompts",
		"POST /api/v1/admin/prompts",
		"PATCH /api/v1/admin/tasks/:id",
	}
	for _, route := range wanted {
		if !registered[route] {
			t.Errorf("REST route is not registered: %s", route)
		}
	}

	removed := []string{
		"GET /api/tasks",
		"GET /api/v1/tasks/batch",
		"POST /api/v1/tasks/:id/cancel",
		"POST /api/v1/admin/tasks/:id/requeue",
		"GET /api/v1/admin/prompt-library",
		"GET /api/v1/gallery",
	}
	for _, route := range removed {
		if registered[route] {
			t.Errorf("removed legacy route is still registered: %s", route)
		}
	}
}
