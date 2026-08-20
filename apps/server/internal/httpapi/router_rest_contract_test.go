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
		"GET /api/v1/canvas-projects",
		"POST /api/v1/canvas-projects",
		"GET /api/v1/canvas-projects/:id",
		"PATCH /api/v1/canvas-projects/:id",
		"DELETE /api/v1/canvas-projects/:id",
		"GET /api/v1/canvas-workflow-templates",
		"GET /api/v1/canvas-workflow-templates/:id",
		"GET /api/v1/changelog",
		"GET /api/v1/changelog/latest",
		"GET /api/v1/gallery/submissions",
		"GET /api/v1/prompts/categories",
		"GET /api/v1/admin/prompt-categories",
		"POST /api/v1/admin/prompt-categories",
		"PATCH /api/v1/admin/prompt-categories/:id",
		"DELETE /api/v1/admin/prompt-categories/:id",
		"GET /api/v1/admin/prompt-import-batches",
		"POST /api/v1/admin/prompt-import-batches",
		"POST /api/v1/admin/prompt-import-batches/upload",
		"PUT /api/v1/admin/prompt-import-batches/:id/items/:itemId/cover",
		"POST /api/v1/admin/prompt-import-batches/:id/publish",
		"GET /api/v1/admin/prompts",
		"POST /api/v1/admin/prompts",
		"GET /api/v1/admin/prompts/export",
		"DELETE /api/v1/admin/tasks",
		"PATCH /api/v1/admin/tasks/:id",
		"GET /api/v1/admin/canvas-workflow-templates",
		"POST /api/v1/admin/canvas-workflow-templates",
		"PATCH /api/v1/admin/canvas-workflow-templates/:id",
		"PUT /api/v1/admin/canvas-workflow-templates/:id/cover",
		"DELETE /api/v1/admin/canvas-workflow-templates/:id",
		"GET /api/v1/admin/system/metrics",
		"GET /api/v1/me/wallet",
		"GET /api/v1/me/wallet/summary",
		"GET /api/v1/me/wallet/export",
		"GET /api/v1/commerce/tryon-catalog",
		"GET /api/v1/commerce/handheld/catalog",
		"POST /api/v1/commerce/handheld/quotes",
		"GET /api/v1/commerce/handheld/projects",
		"POST /api/v1/commerce/handheld/projects",
		"GET /api/v1/commerce/handheld/projects/:id",
		"PUT /api/v1/commerce/handheld/projects/:id/draft",
		"POST /api/v1/commerce/handheld/jobs",
		"GET /api/v1/commerce/handheld/jobs/:id",
		"POST /api/v1/commerce/handheld/jobs/:id/cancel",
		"POST /api/v1/commerce/handheld/items/:id/retry",
		"POST /api/v1/commerce/handheld/items/:id/save-asset",
		"GET /api/v1/admin/ecommerce/catalog",
		"POST /api/v1/admin/ecommerce/catalog",
		"PATCH /api/v1/admin/ecommerce/catalog/order",
		"PATCH /api/v1/admin/ecommerce/catalog/:id",
		"PUT /api/v1/admin/ecommerce/catalog/:id/image",
		"DELETE /api/v1/admin/ecommerce/catalog/:id",
		"GET /api/v1/admin/ecommerce/tryon-catalog",
		"POST /api/v1/admin/ecommerce/tryon-catalog",
		"PATCH /api/v1/admin/ecommerce/tryon-catalog/order",
		"PATCH /api/v1/admin/ecommerce/tryon-catalog/:id",
		"PUT /api/v1/admin/ecommerce/tryon-catalog/:id/image",
		"DELETE /api/v1/admin/ecommerce/tryon-catalog/:id",
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
		"GET /api/v1/admin/prompts/asset-audit",
		"PATCH /api/v1/admin/prompts/:id/asset",
		"GET /api/v1/gallery",
		"POST /api/v1/commerce/handheld/items/:id/regenerations",
	}
	for _, route := range removed {
		if registered[route] {
			t.Errorf("removed legacy route is still registered: %s", route)
		}
	}
}
