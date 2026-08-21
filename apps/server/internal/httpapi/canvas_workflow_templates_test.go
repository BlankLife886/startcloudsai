package httpapi

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

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
	if summary["coverUrl"] != nil {
		t.Fatalf("public summary coverUrl = %#v, want empty until uploaded", summary["coverUrl"])
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

func TestCanvasWorkflowTemplateCoverURLAndUploadValidation(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")

	createdResponse := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", validCanvasWorkflowTemplatePayload(), adminToken)
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create template: status %d body %s", createdResponse.Code, createdResponse.Body.String())
	}
	created, _ := decode(t, createdResponse)
	templateID, _ := created["id"].(string)
	if created["coverUrl"] != nil {
		t.Fatalf("created coverUrl = %#v, want empty", created["coverUrl"])
	}

	coverKey := "canvas-template-covers/" + templateID + ".png"
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE canvas_workflow_templates SET cover_key = $1 WHERE id = $2`, coverKey, templateID); err != nil {
		t.Fatalf("set cover_key: %v", err)
	}
	publicListResponse := env.do(t, http.MethodGet, "/api/v1/canvas-workflow-templates", nil, "")
	publicList, _ := decode(t, publicListResponse)
	items, _ := publicList["items"].([]any)
	summary, _ := items[0].(map[string]any)
	if summary["coverUrl"] != "/api/v1/files/"+coverKey {
		t.Fatalf("public coverUrl = %#v, want /api/v1/files/%s", summary["coverUrl"], coverKey)
	}

	missingFile := env.do(t, http.MethodPut, "/api/v1/admin/canvas-workflow-templates/"+templateID+"/cover", nil, adminToken)
	if missingFile.Code != http.StatusUnprocessableEntity {
		t.Fatalf("missing cover file: status %d body %s", missingFile.Code, missingFile.Body.String())
	}

	unknownID := uuid.NewString()
	unknown := env.do(t, http.MethodPut, "/api/v1/admin/canvas-workflow-templates/"+unknownID+"/cover", nil, adminToken)
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown template cover: status %d body %s", unknown.Code, unknown.Body.String())
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "cover.txt")
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write([]byte("not an image")); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/canvas-workflow-templates/"+templateID+"/cover", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: adminToken})
	w := httptest.NewRecorder()
	env.engine.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unsupported cover: status %d body %s", w.Code, w.Body.String())
	}
}

func TestCanvasWorkflowTemplatesReorder(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")

	firstPayload := validCanvasWorkflowTemplatePayload()
	firstPayload["slug"] = "template-first"
	firstPayload["title"] = "模板甲"
	firstPayload["sort"] = 10
	firstResponse := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", firstPayload, adminToken)
	if firstResponse.Code != http.StatusCreated {
		t.Fatalf("create first template: status %d body %s", firstResponse.Code, firstResponse.Body.String())
	}
	first, _ := decode(t, firstResponse)

	secondPayload := validCanvasWorkflowTemplatePayload()
	secondPayload["slug"] = "template-second"
	secondPayload["title"] = "模板乙"
	secondPayload["sort"] = 20
	secondResponse := env.do(t, http.MethodPost, "/api/v1/admin/canvas-workflow-templates", secondPayload, adminToken)
	if secondResponse.Code != http.StatusCreated {
		t.Fatalf("create second template: status %d body %s", secondResponse.Code, secondResponse.Body.String())
	}
	second, _ := decode(t, secondResponse)

	firstID, _ := first["id"].(string)
	secondID, _ := second["id"].(string)
	if firstID == "" || secondID == "" {
		t.Fatalf("created ids = first %#v second %#v", first, second)
	}

	reorderResponse := env.do(t, http.MethodPatch, "/api/v1/admin/canvas-workflow-templates/order", gin.H{
		"ids": []string{secondID, firstID},
	}, adminToken)
	if reorderResponse.Code != http.StatusOK {
		t.Fatalf("reorder templates: status %d body %s", reorderResponse.Code, reorderResponse.Body.String())
	}

	listResponse := env.do(t, http.MethodGet, "/api/v1/admin/canvas-workflow-templates", nil, adminToken)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list after reorder: status %d body %s", listResponse.Code, listResponse.Body.String())
	}
	list, _ := decode(t, listResponse)
	items, _ := list["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items after reorder = %#v, want 2", items)
	}
	firstItem, _ := items[0].(map[string]any)
	secondItem, _ := items[1].(map[string]any)
	if firstItem["id"] != secondID || secondItem["id"] != firstID {
		t.Fatalf("order after reorder = %#v, want %s then %s", items, secondID, firstID)
	}
	if firstItem["sort"] != float64(10) || secondItem["sort"] != float64(20) {
		t.Fatalf("sort after reorder = %#v, want 10 then 20", items)
	}

	unknown := env.do(t, http.MethodPatch, "/api/v1/admin/canvas-workflow-templates/order", gin.H{
		"ids": []string{uuid.NewString()},
	}, adminToken)
	if unknown.Code != http.StatusConflict {
		t.Fatalf("unknown id reorder: status %d body %s", unknown.Code, unknown.Body.String())
	}
}
