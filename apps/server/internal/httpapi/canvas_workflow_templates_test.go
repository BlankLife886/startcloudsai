package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func validCanvasWorkflowTemplatePayload() gin.H {
	return gin.H{
		"slug":          "ecommerce-main-image",
		"title":         "电商主图生产线",
		"category":      "commerce",
		"categoryLabel": "电商",
		"industry":      "零售",
		"summary":       "从商品图生成主图和文案",
		"platforms":     []string{"淘宝", "Amazon"},
		"deliverables":  []string{"商品主图", "商品文案"},
		"accent":        "#16a34a",
		"sort":          20,
		"enabled":       true,
		"document": gin.H{
			"version": 3,
			"nodes": []gin.H{
				{"id": "input-1", "type": "image", "title": "商品图", "position": gin.H{"x": 40, "y": 80}, "width": 320, "height": 240},
				{"id": "output-1", "type": "config", "title": "生成主图", "position": gin.H{"x": 440, "y": 80}, "width": 320, "height": 240},
			},
			"connections": []gin.H{
				{"id": "edge-1", "fromNodeId": "input-1", "toNodeId": "output-1"},
			},
			"backgroundMode": "dots",
			"showImageInfo":  true,
			"viewport":       gin.H{"x": 120, "y": 160, "k": 0.8},
		},
	}
}

func TestCanvasWorkflowTemplatesAdminLifecycleAndPublicVisibility(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")

	createdResponse := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", validCanvasWorkflowTemplatePayload(), adminToken)
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create template: status %d body %s", createdResponse.Code, createdResponse.Body.String())
	}
	created, _ := decode(t, createdResponse)
	templateID, _ := created["id"].(string)
	if templateID == "" || created["nodeCount"] != float64(2) || created["document"] == nil {
		t.Fatalf("created template = %#v", created)
	}

	publicListResponse := env.do(t, http.MethodGet, "/api/v1/canvas-workflow-templates", nil, "")
	if publicListResponse.Code != http.StatusOK {
		t.Fatalf("public list: status %d body %s", publicListResponse.Code, publicListResponse.Body.String())
	}
	publicList, _ := decode(t, publicListResponse)
	items, _ := publicList["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("public items = %#v, want one template", items)
	}
	summary, _ := items[0].(map[string]any)
	if summary["id"] != templateID || summary["document"] != nil {
		t.Fatalf("public summary = %#v, want matching metadata without document", summary)
	}

	publicDetailResponse := env.do(t, http.MethodGet, "/api/v1/canvas-workflow-templates/"+templateID, nil, "")
	if publicDetailResponse.Code != http.StatusOK {
		t.Fatalf("public detail: status %d body %s", publicDetailResponse.Code, publicDetailResponse.Body.String())
	}
	publicDetail, _ := decode(t, publicDetailResponse)
	if publicDetail["document"] == nil {
		t.Fatalf("public detail = %#v, want document", publicDetail)
	}

	patchResponse := env.do(t, http.MethodPatch, "/api/v1/admin/canvas-workflow-templates/"+templateID, gin.H{
		"title": "更新后的模板", "enabled": false, "sort": -10,
	}, adminToken)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("patch template: status %d body %s", patchResponse.Code, patchResponse.Body.String())
	}
	patched, _ := decode(t, patchResponse)
	if patched["title"] != "更新后的模板" || patched["enabled"] != false || patched["sort"] != float64(-10) {
		t.Fatalf("patched template = %#v", patched)
	}

	hiddenListResponse := env.do(t, http.MethodGet, "/api/v1/canvas-workflow-templates", nil, "")
	hiddenList, _ := decode(t, hiddenListResponse)
	hiddenItems, _ := hiddenList["items"].([]any)
	if len(hiddenItems) != 0 {
		t.Fatalf("disabled template is public: %#v", hiddenItems)
	}
	hiddenDetailResponse := env.do(t, http.MethodGet, "/api/v1/canvas-workflow-templates/"+templateID, nil, "")
	if hiddenDetailResponse.Code != http.StatusNotFound {
		t.Fatalf("disabled public detail: status %d body %s", hiddenDetailResponse.Code, hiddenDetailResponse.Body.String())
	}

	adminListResponse := env.do(t, http.MethodGet, "/api/v1/admin/canvas-workflow-templates", nil, adminToken)
	adminList, _ := decode(t, adminListResponse)
	adminItems, _ := adminList["items"].([]any)
	if len(adminItems) != 1 {
		t.Fatalf("admin items = %#v, want disabled template", adminItems)
	}

	deleteResponse := env.do(t, http.MethodDelete, "/api/v1/admin/canvas-workflow-templates/"+templateID, nil, adminToken)
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("delete template: status %d body %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	adminListResponse = env.do(t, http.MethodGet, "/api/v1/admin/canvas-workflow-templates", nil, adminToken)
	adminList, _ = decode(t, adminListResponse)
	adminItems, _ = adminList["items"].([]any)
	if len(adminItems) != 0 {
		t.Fatalf("deleted template remains: %#v", adminItems)
	}
}

func TestCanvasWorkflowTemplateRejectsInvalidDocument(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	payload := validCanvasWorkflowTemplatePayload()
	payload["document"] = gin.H{"version": 2, "nodes": []gin.H{}, "connections": []gin.H{}}

	response := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", payload, adminToken)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid document: status %d body %s", response.Code, response.Body.String())
	}
	_, code := decode(t, response)
	if code != "validation_error" {
		t.Fatalf("invalid document code = %q", code)
	}
}

func TestCanvasWorkflowTemplateRejectsInvalidNodeAndDuplicateSlug(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	payload := validCanvasWorkflowTemplatePayload()
	document := payload["document"].(gin.H)
	document["nodes"] = []gin.H{{
		"id": "broken", "type": "image", "title": "无尺寸节点", "position": gin.H{"x": 0, "y": 0},
	}}
	document["connections"] = []gin.H{}

	invalidResponse := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", payload, adminToken)
	if invalidResponse.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid node: status %d body %s", invalidResponse.Code, invalidResponse.Body.String())
	}

	validPayload := validCanvasWorkflowTemplatePayload()
	first := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", validPayload, adminToken)
	if first.Code != http.StatusCreated {
		t.Fatalf("first create: status %d body %s", first.Code, first.Body.String())
	}
	duplicate := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", validPayload, adminToken)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate slug: status %d body %s", duplicate.Code, duplicate.Body.String())
	}
}

func TestDefaultCanvasWorkflowTemplatesSeedOnce(t *testing.T) {
	env := newCommunityEnv(t)
	inserted, err := store.SeedDefaultCanvasWorkflowTemplates(context.Background(), env.st)
	if err != nil {
		t.Fatalf("seed defaults: %v", err)
	}
	if inserted != 41 {
		t.Fatalf("inserted defaults = %d, want 41", inserted)
	}

	response := env.do(t, http.MethodGet, "/api/v1/canvas-workflow-templates", nil, "")
	if response.Code != http.StatusOK {
		t.Fatalf("list seeded templates: status %d body %s", response.Code, response.Body.String())
	}
	data, _ := decode(t, response)
	items, _ := data["items"].([]any)
	if len(items) != 41 {
		t.Fatalf("seeded public templates = %d, want 41", len(items))
	}

	inserted, err = store.SeedDefaultCanvasWorkflowTemplates(context.Background(), env.st)
	if err != nil || inserted != 0 {
		t.Fatalf("second seed inserted = %d, err = %v", inserted, err)
	}
}
