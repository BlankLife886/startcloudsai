package httpapi

import (
	"bytes"
	"net/http"
	"testing"
)

func TestDecodeHandheldProductClassification(t *testing.T) {
	got, err := decodeHandheldProductClassification("```json\n{\"category\":\"skincare\",\"label\":\"蓝色按压精华瓶\",\"sizeMm\":{\"length\":32.4,\"width\":32,\"height\":128}}\n```")
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Category != "skincare" || got.Label != "蓝色按压精华瓶" || got.SizeMm == nil || got.SizeMm.Length != 32 || got.SizeMm.Height != 128 {
		t.Fatalf("unexpected result: %+v %+v", got, got.SizeMm)
	}
}

func TestDecodeHandheldProductClassificationRejectsUnknownCategory(t *testing.T) {
	if _, err := decodeHandheldProductClassification(`{"category":"shoes","label":"运动鞋"}`); err == nil {
		t.Fatal("expected unknown category to be rejected")
	}
}

func TestDecodeHandheldProductClassificationDropsBadSize(t *testing.T) {
	got, err := decodeHandheldProductClassification(`{"category":"cup","label":"白色马克杯","sizeMm":{"length":80,"width":0,"height":95}}`)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.SizeMm != nil {
		t.Fatalf("invalid size should be dropped: %+v", got.SizeMm)
	}
}

func TestClassifyHandheldProductRequiresLogin(t *testing.T) {
	env := newCommunityEnv(t)
	w := env.do(t, http.MethodPost, "/api/v1/commerce/handheld/product-classifications", map[string]any{
		"inputKey": "uploads/someone/product.png",
	}, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", w.Code, w.Body.String())
	}
}

func TestAdminCanDisableHandheldProductClassify(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	_, userToken := env.newUserSession(t, "user")

	// 默认开启：没配置过也要能识别
	w := env.do(t, http.MethodPost, "/api/v1/commerce/handheld/product-classifications",
		map[string]any{"inputKey": "  "}, userToken)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("classify should be enabled by default, got %d: %s", w.Code, w.Body.String())
	}

	w = env.do(t, http.MethodPut, "/api/v1/admin/ecommerce/ai-assists/handheld-product-classify",
		map[string]any{"enabled": false}, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("disable status = %d: %s", w.Code, w.Body.String())
	}
	w = env.do(t, http.MethodPost, "/api/v1/commerce/handheld/product-classifications",
		map[string]any{"inputKey": "uploads/x/product.png"}, userToken)
	if w.Code != http.StatusForbidden || !bytes.Contains(w.Body.Bytes(), []byte("feature_disabled")) {
		t.Fatalf("classify when disabled = %d: %s", w.Code, w.Body.String())
	}
	// 关掉手持识别不影响试衣识别
	w = env.do(t, http.MethodPost, "/api/v1/commerce/tryon/garment-classifications",
		map[string]any{"inputKey": "  "}, userToken)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("tryon classify should stay enabled, got %d", w.Code)
	}

	w = env.do(t, http.MethodPut, "/api/v1/admin/ecommerce/ai-assists/handheld-product-classify",
		map[string]any{"enabled": true}, adminToken)
	if w.Code != http.StatusOK {
		t.Fatalf("enable status = %d", w.Code)
	}
	w = env.do(t, http.MethodPost, "/api/v1/commerce/handheld/product-classifications",
		map[string]any{"inputKey": "  "}, userToken)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("classify when enabled should reach validation, got %d", w.Code)
	}
}
