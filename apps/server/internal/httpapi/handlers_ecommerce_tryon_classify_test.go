package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func TestDecodeTryonGarmentClassification(t *testing.T) {
	got, err := decodeTryonGarmentClassification("```json\n{\"apparel\":\"全身\",\"label\":\"深蓝蕾丝长礼服\"}\n```")
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Apparel != "全身" || got.Label != "深蓝蕾丝长礼服" {
		t.Fatalf("unexpected result: %+v", got)
	}
}

func TestDecodeTryonGarmentClassificationRejectsUnknownApparel(t *testing.T) {
	if _, err := decodeTryonGarmentClassification(`{"apparel":"鞋子","label":"白色运动鞋"}`); err == nil {
		t.Fatal("expected unknown apparel to be rejected")
	}
}

func TestClassifyTryonGarmentRequiresLogin(t *testing.T) {
	env := newCommunityEnv(t)
	w := env.do(t, http.MethodPost, "/api/v1/commerce/tryon/garment-classifications", map[string]any{
		"inputKey": "uploads/someone/garment.png",
	}, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", w.Code, w.Body.String())
	}
}

func TestClassifyTryonGarmentRejectsEmptyKey(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	w := env.do(t, http.MethodPost, "/api/v1/commerce/tryon/garment-classifications", map[string]any{
		"inputKey": "  ",
	}, token)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422: %s", w.Code, w.Body.String())
	}
}

func TestClassifyTryonGarmentRejectsForeignImage(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	other, _ := env.newUserSession(t, "user")
	w := env.do(t, http.MethodPost, "/api/v1/commerce/tryon/garment-classifications", map[string]any{
		"inputKey": "uploads/" + other.ID.String() + "/garment.png",
	}, token)
	if w.Code < 400 || w.Code >= 500 {
		t.Fatalf("status = %d, want 4xx for another user's image: %s", w.Code, w.Body.String())
	}
}

func TestAdminEcommerceAIAssistsListsAssociations(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	w := env.do(t, http.MethodGet, "/api/v1/admin/ecommerce/ai-assists", nil, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Items []ecommerceAIAssist `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data.Items) != 4 {
		t.Fatalf("items = %d, want 4", len(resp.Data.Items))
	}
	first := resp.Data.Items[0]
	if first.ID != "tryon-garment-classify" || !first.Toggleable || !first.Enabled {
		t.Fatalf("unexpected first item: %+v", first)
	}
	if first.Endpoint != "POST /api/v1/commerce/tryon/garment-classifications" {
		t.Fatalf("endpoint = %q", first.Endpoint)
	}
	for _, item := range resp.Data.Items {
		if item.ModelSource == "" || item.RateLimit == "" || item.Trigger == "" {
			t.Fatalf("item %s missing association info: %+v", item.ID, item)
		}
		// 测试环境没有配置模型：必须明确告诉管理员缺什么，而不是空白
		if item.Model == nil && item.ModelError == "" {
			t.Fatalf("item %s has neither model nor modelError", item.ID)
		}
	}
}

func TestAdminCanDisableTryonGarmentClassify(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	_, userToken := env.newUserSession(t, "user")

	w := env.do(t, http.MethodPut, "/api/v1/admin/ecommerce/ai-assists/tryon-garment-classify",
		map[string]any{"enabled": false}, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("disable status = %d: %s", w.Code, w.Body.String())
	}
	w = env.do(t, http.MethodPost, "/api/v1/commerce/tryon/garment-classifications",
		map[string]any{"inputKey": "uploads/x/garment.png"}, userToken)
	if w.Code != http.StatusForbidden || !bytes.Contains(w.Body.Bytes(), []byte("feature_disabled")) {
		t.Fatalf("classify when disabled = %d: %s", w.Code, w.Body.String())
	}

	w = env.do(t, http.MethodPut, "/api/v1/admin/ecommerce/ai-assists/tryon-garment-classify",
		map[string]any{"enabled": true}, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("enable status = %d", w.Code)
	}
	w = env.do(t, http.MethodPost, "/api/v1/commerce/tryon/garment-classifications",
		map[string]any{"inputKey": "  "}, userToken)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("classify when enabled should reach validation, got %d", w.Code)
	}
}

func TestEcommerceAIAssistsAdminOnly(t *testing.T) {
	env := newCommunityEnv(t)
	_, userToken := env.newUserSession(t, "user")
	w := env.do(t, http.MethodGet, "/api/v1/admin/ecommerce/ai-assists", nil, userToken)
	if w.Code != http.StatusUnauthorized && w.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d", w.Code)
	}
	_, adminToken := env.newUserSession(t, "admin")
	w = env.do(t, http.MethodPut, "/api/v1/admin/ecommerce/ai-assists/product-brief",
		map[string]any{"enabled": false}, adminToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("non-toggleable status = %d", w.Code)
	}
}
