package httpapi

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestUserAssetTrashRestoreAndPermanentCleanup(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	fileKey := "uploads/" + user.ID.String() + "/original/asset.png"
	thumbnailKey := "uploads/" + user.ID.String() + "/thumb/asset.jpg"
	asset, err := store.InsertUserAsset(context.Background(), env.st.Pool, user.ID,
		"待删除素材", fileKey, thumbnailKey, "image/png", 128, nil)
	if err != nil {
		t.Fatalf("insert asset: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/me/assets/"+asset.ID.String(), nil, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete asset: status %d body %s", w.Code, w.Body.String())
	}
	var cleanupJobs int
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = ANY($1::text[])`,
		[]string{fileKey, thumbnailKey}).Scan(&cleanupJobs); err != nil {
		t.Fatalf("count deferred cleanup jobs: %v", err)
	}
	if cleanupJobs != 0 {
		t.Fatalf("soft delete queued %d cleanup jobs, want 0", cleanupJobs)
	}
	w = env.do(t, http.MethodPost, "/api/v1/me/assets/"+asset.ID.String()+"/restore", map[string]any{}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("restore asset: status %d body %s", w.Code, w.Body.String())
	}
	w = env.do(t, http.MethodDelete, "/api/v1/me/assets/"+asset.ID.String(), nil, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("trash again: status %d body %s", w.Code, w.Body.String())
	}
	w = env.do(t, http.MethodDelete, "/api/v1/me/assets/"+asset.ID.String()+"/permanent", nil, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("permanent delete: status %d body %s", w.Code, w.Body.String())
	}
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM object_cleanup_jobs WHERE object_key = ANY($1::text[])`, []string{fileKey, thumbnailKey}).Scan(&cleanupJobs); err != nil {
		t.Fatalf("count permanent cleanup jobs: %v", err)
	}
	if cleanupJobs != 2 {
		t.Fatalf("permanent cleanup jobs = %d, want 2", cleanupJobs)
	}
}

func TestEcommerceProductCRUDAndOwnership(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	asset, err := store.InsertUserAsset(context.Background(), env.st.Pool, user.ID,
		"榨汁杯正面", "uploads/"+user.ID.String()+"/original/product.png",
		"uploads/"+user.ID.String()+"/thumb/product.jpg", "image/png", 128, nil)
	if err != nil {
		t.Fatalf("insert asset: %v", err)
	}

	w := env.do(t, http.MethodPost, "/api/v1/commerce/products", map[string]any{
		"sku": "blender-01", "title": "便携榨汁杯", "brand": "星云生活",
		"category": "小家电", "sellingPoints": "轻便、易清洁", "platform": "Amazon",
		"market": "美国", "language": "英文", "assetIds": []string{asset.ID.String()},
	}, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: status %d body %s", w.Code, w.Body.String())
	}
	created, _ := decode(t, w)
	productID := created["id"].(string)
	if created["title"] != "便携榨汁杯" || len(created["assets"].([]any)) != 1 {
		t.Fatalf("created = %#v", created)
	}
	if protected, ok := created["protectedElements"].([]any); !ok || len(protected) != 0 {
		t.Fatalf("protectedElements default = %#v", created["protectedElements"])
	}

	w = env.do(t, http.MethodGet, "/api/v1/commerce/products", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("list: status %d body %s", w.Code, w.Body.String())
	}
	listed, _ := decode(t, w)
	if len(listed["items"].([]any)) != 1 {
		t.Fatalf("listed = %#v", listed)
	}
	w = env.do(t, http.MethodGet, "/api/v1/commerce/products?q=%25", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("literal wildcard search: status %d body %s", w.Code, w.Body.String())
	}
	literalWildcard, _ := decode(t, w)
	if len(literalWildcard["items"].([]any)) != 0 {
		t.Fatalf("literal wildcard search matched products: %#v", literalWildcard)
	}

	w = env.do(t, http.MethodGet, "/api/v1/commerce/products/"+productID, nil, otherToken)
	if w.Code != http.StatusNotFound {
		t.Fatalf("other user read: status %d body %s", w.Code, w.Body.String())
	}

	w = env.do(t, http.MethodPatch, "/api/v1/commerce/products/"+productID, map[string]any{
		"title": "便携榨汁杯 Pro", "sellingPoints": "静音、易清洁",
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("patch: status %d body %s", w.Code, w.Body.String())
	}
	updated, _ := decode(t, w)
	if updated["title"] != "便携榨汁杯 Pro" || updated["sku"] != "BLENDER-01" {
		t.Fatalf("updated = %#v", updated)
	}

	w = env.do(t, http.MethodDelete, "/api/v1/me/assets/"+asset.ID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "asset_in_use" {
		t.Fatalf("delete referenced asset: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	w = env.do(t, http.MethodPatch, "/api/v1/commerce/products/"+productID, map[string]any{
		"status": "archived",
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("archive: status %d body %s", w.Code, w.Body.String())
	}
	w = env.do(t, http.MethodDelete, "/api/v1/me/assets/"+asset.ID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "asset_in_use" {
		t.Fatalf("delete archived reference: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	w = env.do(t, http.MethodDelete, "/api/v1/commerce/products/"+productID, nil, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: status %d body %s", w.Code, w.Body.String())
	}
}

func TestEcommerceProductRejectsForeignAsset(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")
	other, _ := env.newUserSession(t, "user")
	asset, err := store.InsertUserAsset(context.Background(), env.st.Pool, other.ID,
		"他人的商品图", "uploads/"+other.ID.String()+"/original/foreign.png",
		"uploads/"+other.ID.String()+"/thumb/foreign.jpg", "image/png", 128, nil)
	if err != nil {
		t.Fatalf("insert foreign asset: %v", err)
	}
	w := env.do(t, http.MethodPost, "/api/v1/commerce/products", map[string]any{
		"title": "越权商品", "assetIds": []string{asset.ID.String()},
	}, token)
	if _, code := decode(t, w); w.Code != http.StatusUnprocessableEntity || code != "validation_error" {
		t.Fatalf("foreign asset: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestEcommerceAssetReviewLifecycleAndOwnership(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	task, err := store.InsertTask(context.Background(), env.st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "test-image",
		Prompt: "商品场景图", Params: map[string]any{"_kind": "ui-design-ecommerce-shoot-generation"},
		Count: 1, InputKeys: []string{"uploads/source.png"}, CostCents: 2,
	})
	if err != nil {
		t.Fatalf("insert ecommerce task: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE tasks SET status='succeeded',output_keys='["outputs/result.png"]'::jsonb,finished_at=now() WHERE id=$1`, task.ID); err != nil {
		t.Fatalf("complete ecommerce task: %v", err)
	}

	checklist := map[string]bool{
		"identity": true, "copy": true, "color": true,
		"physics": true, "channel": true, "rights": true,
	}
	w := env.do(t, http.MethodPut, "/api/v1/commerce/reviews/"+task.ID.String(), map[string]any{
		"status": "approved", "checklist": checklist, "note": "商品事实与渠道规范均已确认", "channel": "Amazon US",
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("approve review: status %d body %s", w.Code, w.Body.String())
	}
	review, _ := decode(t, w)
	if review["status"] != "approved" || review["channel"] != "Amazon US" || review["reviewedAt"] == nil {
		t.Fatalf("review = %#v", review)
	}

	w = env.do(t, http.MethodGet, "/api/v1/commerce/reviews?status=approved", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("list reviews: status %d body %s", w.Code, w.Body.String())
	}
	listed, _ := decode(t, w)
	if len(listed["items"].([]any)) != 1 {
		t.Fatalf("listed reviews = %#v", listed)
	}

	w = env.do(t, http.MethodPut, "/api/v1/commerce/reviews/"+task.ID.String(), map[string]any{
		"status": "changes_requested", "checklist": map[string]bool{"identity": true}, "note": "包装文字需要复核",
	}, otherToken)
	if w.Code != http.StatusNotFound {
		t.Fatalf("other user review: status %d body %s", w.Code, w.Body.String())
	}
}

func TestEcommerceAssetReviewRequiresCompleteChecklist(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	task, err := store.InsertTask(context.Background(), env.st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "test-image",
		Prompt: "商品图", Params: map[string]any{}, Count: 1, CostCents: 1,
	})
	if err != nil {
		t.Fatalf("insert ecommerce task: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `UPDATE tasks SET status='succeeded',output_keys='["outputs/result.png"]'::jsonb WHERE id=$1`, task.ID); err != nil {
		t.Fatalf("complete ecommerce task: %v", err)
	}
	w := env.do(t, http.MethodPut, "/api/v1/commerce/reviews/"+task.ID.String(), map[string]any{
		"status": "approved", "checklist": map[string]bool{"identity": true},
	}, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "review_incomplete" {
		t.Fatalf("incomplete review: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestEcommerceProductLimitAdmissionIsSerialized(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	asset, err := store.InsertUserAsset(context.Background(), env.st.Pool, user.ID,
		"并发测试素材", "uploads/"+user.ID.String()+"/original/concurrency.png",
		"uploads/"+user.ID.String()+"/thumb/concurrency.jpg", "image/png", 128, nil)
	if err != nil {
		t.Fatalf("insert asset: %v", err)
	}
	_, err = env.st.Pool.Exec(context.Background(), `
		INSERT INTO ecommerce_products (user_id, sku, title, asset_ids)
		SELECT $1, 'seed-' || n::text, 'seed-' || n::text, jsonb_build_array($2::text)
		FROM generate_series(1, 999) AS n`, user.ID, asset.ID.String())
	if err != nil {
		t.Fatalf("seed products: %v", err)
	}

	responses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, title := range []string{"并发商品 A", "并发商品 B"} {
		wg.Add(1)
		go func(title string) {
			defer wg.Done()
			response := env.do(t, http.MethodPost, "/api/v1/commerce/products", map[string]any{
				"title": title, "assetIds": []string{asset.ID.String()},
			}, token)
			responses <- response.Code
		}(title)
	}
	wg.Wait()
	close(responses)

	created, rejected := 0, 0
	for code := range responses {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			rejected++
		default:
			t.Fatalf("unexpected concurrent create status: %d", code)
		}
	}
	if created != 1 || rejected != 1 {
		t.Fatalf("concurrent admission = created %d rejected %d, want 1/1", created, rejected)
	}
	var count int64
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ecommerce_products WHERE user_id = $1`, user.ID).Scan(&count); err != nil {
		t.Fatalf("count products: %v", err)
	}
	if count != 1000 {
		t.Fatalf("product count = %d, want 1000", count)
	}
}

func TestAssetUpdatesReturnNotFoundForMissingRows(t *testing.T) {
	env := newCommunityEnv(t)
	_, token := env.newUserSession(t, "user")

	checks := []struct {
		path string
		body map[string]any
	}{
		{path: "/api/v1/me/assets/" + uuid.NewString(), body: map[string]any{"title": "新名称"}},
		{path: "/api/v1/me/asset-groups/" + uuid.NewString(), body: map[string]any{"name": "新分组"}},
	}
	for _, check := range checks {
		w := env.do(t, http.MethodPatch, check.path, check.body, token)
		if _, code := decode(t, w); w.Code != http.StatusNotFound || code != "not_found" {
			t.Fatalf("missing update %s: status %d code %s body %s", check.path, w.Code, code, w.Body.String())
		}
	}
}
