package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
)

func TestRouterRegistersTaskStream(t *testing.T) {
	server := &Server{Cfg: &config.Config{AppEnv: "test", TrustedProxies: "127.0.0.1"}}
	wanted := map[string]bool{
		"/api/v1/tasks":            false,
		"/api/v1/tasks/:id/events": false,
		"/api/v1/me/tasks/events":  false,
	}
	for _, route := range server.Router().Routes() {
		if route.Method == "GET" {
			if _, ok := wanted[route.Path]; ok {
				wanted[route.Path] = true
			}
		}
	}
	for route, found := range wanted {
		if !found {
			t.Fatalf("GET %s is not registered", route)
		}
	}
}
