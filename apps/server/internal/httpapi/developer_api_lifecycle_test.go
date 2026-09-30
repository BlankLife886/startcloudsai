package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (env *openAIImagesIntegrationEnv) adminToken(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	admin, err := store.UpsertAdminAccount(ctx, env.st.Pool, "lifecycle-admin@test.dev", "admin", "x")
	if err != nil {
		t.Fatal(err)
	}
	token := auth.NewSessionToken()
	if err := store.InsertAdminSession(ctx, env.st.Pool, admin.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	// Let the integration Key call any catalog model.
	if _, err := env.st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_api_model_ids='{}' WHERE id=$1`, env.key.ID); err != nil {
		t.Fatal(err)
	}
	return token
}

func (env *openAIImagesIntegrationEnv) adminRequest(t *testing.T, token, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: token})
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, request)
	return recorder
}

func expectResponse(t *testing.T, response *httptest.ResponseRecorder, status int, contains string) {
	t.Helper()
	if response.Code != status || !strings.Contains(response.Body.String(), contains) {
		t.Fatalf("status=%d body=%s; want %d containing %q", response.Code, response.Body.String(), status, contains)
	}
}

func (env *openAIImagesIntegrationEnv) notificationCount(t *testing.T, title string) int {
	t.Helper()
	var count int
	if err := env.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE user_id=$1 AND title=$2`, env.user.ID, title).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

// Maintenance answers 503 without charging and invites a retry; deprecation
// needs the configured notice, keeps the model callable with Deprecation,
// Sunset and Link headers and notifies its users; retiring answers 410 with
// the replacement; a sunset that passes retires the model at once and the
// sweep records it.
func TestDeveloperAPIModelLifecycle(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	token := env.adminToken(t)
	models := "/api/v1/admin/developer-api/models"
	generate := func(model string) *httptest.ResponseRecorder {
		return env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "", strings.NewReader(`{"model":"`+model+`","prompt":"lifecycle"}`)))
	}
	current := env.apiModel(t, openAIIntegrationModel)
	next := env.adminRequest(t, token, "POST", models, `{"apiName":"compat-next","targetModelId":"compat-image","priceMode":"fixed","priceCents":5}`)
	expectResponse(t, next, http.StatusCreated, `"status":"draft"`)
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(next.Body.Bytes(), &created)
	nextID := created.Data.ID
	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+nextID+"/publish", `{}`), http.StatusOK, `"status":"live"`)

	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+current.ID+"/maintenance", `{"reason":"上游抖动"}`), http.StatusOK, `"status":"maintenance"`)
	paused := generate(openAIIntegrationModel)
	requireOpenAIIntegrationStatus(t, paused, http.StatusServiceUnavailable, "model_unavailable")
	if paused.Header().Get("Retry-After") != "60" || paused.Header().Get("X-Should-Retry") != "true" || !strings.Contains(paused.Body.String(), "稍后重试") {
		t.Fatalf("maintenance invites a retry: headers=%v body=%s", paused.Header(), paused.Body.String())
	}
	env.requireWallet(t, 1000, 0)
	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+current.ID+"/resume", `{}`), http.StatusOK, `"status":"live"`)
	requireOpenAIIntegrationStatus(t, generate(openAIIntegrationModel), http.StatusOK, "")
	env.requireWallet(t, 980, 0)

	soon := time.Now().Add(26 * time.Hour).UTC().Format(time.RFC3339)
	deprecate := `{"sunsetAt":"` + soon + `","replacementId":"` + nextID + `","reason":"换新版"}`
	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+current.ID+"/deprecate", deprecate), http.StatusUnprocessableEntity, "至少要在 7 天之后")
	expectResponse(t, env.adminRequest(t, token, "PUT", "/api/v1/admin/developer-api/model-settings", `{"deprecationNoticeDays":1}`), http.StatusOK, `"deprecationNoticeDays":1`)
	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+current.ID+"/deprecate", deprecate), http.StatusOK, `"status":"deprecated"`)
	if env.notificationCount(t, "开发者 API 模型下线预告") != 1 {
		t.Fatal("users of a deprecated model are notified")
	}
	deprecated := generate(openAIIntegrationModel)
	requireOpenAIIntegrationStatus(t, deprecated, http.StatusOK, "")
	if !strings.HasPrefix(deprecated.Header().Get("Deprecation"), "@") || deprecated.Header().Get("Sunset") == "" ||
		deprecated.Header().Get("Link") != `</v1/models/compat-next>; rel="successor-version"` {
		t.Fatalf("deprecation headers = %v", deprecated.Header())
	}
	listing := env.serve(t, env.request("GET", "/v1/models", "", "", nil))
	if !strings.Contains(listing.Body.String(), `"status":"deprecated"`) || !strings.Contains(listing.Body.String(), `"replacement":"compat-next"`) {
		t.Fatalf("/v1/models = %s", listing.Body.String())
	}

	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+current.ID+"/retire", `{}`), http.StatusUnprocessableEntity, "请填写原因")
	expectResponse(t, env.adminRequest(t, token, "POST", models+"/"+current.ID+"/retire", `{"reason":"上游停服"}`), http.StatusOK, `"status":"retired"`)
	gone := generate(openAIIntegrationModel)
	requireOpenAIIntegrationStatus(t, gone, http.StatusGone, "model_retired")
	if !strings.Contains(gone.Body.String(), "compat-next") {
		t.Fatalf("410 names the replacement: %s", gone.Body.String())
	}
	requireOpenAIIntegrationStatus(t, env.serve(t, env.request("GET", "/v1/models/"+openAIIntegrationModel, "", "", nil)), http.StatusGone, "model_retired")
	expectResponse(t, env.adminRequest(t, token, "PATCH", models+"/"+current.ID, `{"description":"x"}`), http.StatusUnprocessableEntity, "已下线")

	// A sunset that passes retires the model for callers immediately.
	if _, err := env.st.Pool.Exec(ctx, `UPDATE developer_api_models SET status='deprecated', sunset_at=now()-interval '1 minute', deprecated_at=now()-interval '2 days' WHERE id=$1`, nextID); err != nil {
		t.Fatal(err)
	}
	requireOpenAIIntegrationStatus(t, generate("compat-next"), http.StatusGone, "model_retired")
	result, err := apicatalog.Reconcile(ctx, env.st.Pool, time.Now().UTC())
	if err != nil || result.Retired != 1 {
		t.Fatalf("reconcile = %+v, %v", result, err)
	}
	if entry := env.apiModel(t, "compat-next"); entry.Status != store.DeveloperAPIModelRetired || entry.RetiredAt == nil {
		t.Fatalf("sweep records the retirement: %+v", entry)
	}
	if env.notificationCount(t, "开发者 API 模型已下线") != 1 {
		t.Fatal("users of the retired model are notified once")
	}
	env.requireWallet(t, 960, 0)
}

// A following API model holds site increases back for the notice period and
// announces them; site decreases (discounts) apply at once.
func TestDeveloperAPIFollowPriceIncreaseIsAnnounced(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	generate := func() {
		t.Helper()
		requireOpenAIIntegrationStatus(t, env.generate(t, `{"model":"compat-image","prompt":"price"}`), http.StatusOK, "")
	}
	reconcile := func() apicatalog.ReconcileResult {
		t.Helper()
		result, err := apicatalog.Reconcile(ctx, env.st.Pool, time.Now().UTC())
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	reconcile()
	generate()
	env.requireWallet(t, 980, 0)

	env.updateModel(t, func(model *modelconfig.Model) { model.PriceCents = 30 })
	if result := reconcile(); result.Announced != 1 {
		t.Fatalf("site increase announced: %+v", result)
	}
	if env.notificationCount(t, "开发者 API 价格调整预告") != 1 {
		t.Fatal("recent callers hear about the increase")
	}
	generate()
	env.requireWallet(t, 960, 0)
	if result := reconcile(); result.Announced != 0 {
		t.Fatalf("an announced increase is not announced again: %+v", result)
	}

	id := env.apiModel(t, openAIIntegrationModel).ID
	if _, err := env.st.Pool.Exec(ctx, `UPDATE developer_api_models SET pending_price_at=now()-interval '1 second' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	generate()
	env.requireWallet(t, 930, 0)
	if result := reconcile(); result.Applied != 1 {
		t.Fatalf("due price recorded: %+v", result)
	}
	if entry := env.apiModel(t, openAIIntegrationModel); entry.PendingPriceCents != nil || entry.CommittedPriceCents == nil || *entry.CommittedPriceCents != 30 {
		t.Fatalf("applied price = %+v", entry)
	}

	discount := int64(25)
	env.updateModel(t, func(model *modelconfig.Model) { model.DiscountPriceCents = &discount })
	generate()
	env.requireWallet(t, 905, 0)
}

// Saving a model configuration that would stop a callable API model asks for
// confirmation first.
func TestModelConfigSaveWarnsAboutAPIModels(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	token := env.adminToken(t)
	// compat-unbound is on no site page, so only the API depends on it.
	expectResponse(t, env.adminRequest(t, token, "POST", "/api/v1/admin/developer-api/models", `{"apiName":"compat-unbound","targetModelId":"compat-unbound"}`), http.StatusCreated, "")
	unbound := env.apiModel(t, "compat-unbound")
	expectResponse(t, env.adminRequest(t, token, "POST", "/api/v1/admin/developer-api/models/"+unbound.ID+"/publish", `{}`), http.StatusOK, `"status":"live"`)
	generate := func() *httptest.ResponseRecorder {
		return env.generate(t, `{"model":"compat-unbound","prompt":"guard"}`)
	}
	view := env.adminRequest(t, token, "GET", "/api/v1/admin/model-config", "")
	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(view.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, raw := range body.Data["models"].([]any) {
		if model := raw.(map[string]any); model["id"] == "compat-unbound" {
			model["enabled"] = false
		}
	}
	// The fixture binds a private model to text-to-image, which an admin save
	// rejects on its own; unbind it so only the API impact is in play.
	binding := body.Data["workspaces"].(map[string]any)[modelconfig.WorkspaceT2I].(map[string]any)
	kept := []any{}
	for _, id := range binding["modelIds"].([]any) {
		if id != "compat-private" {
			kept = append(kept, id)
		}
	}
	binding["modelIds"] = kept
	payload, _ := json.Marshal(body.Data)
	expectResponse(t, env.adminRequest(t, token, "PUT", "/api/v1/admin/model-config", string(payload)), http.StatusConflict, "compat-unbound")
	requireOpenAIIntegrationStatus(t, generate(), http.StatusOK, "")
	expectResponse(t, env.adminRequest(t, token, "PUT", "/api/v1/admin/model-config?confirmApiImpact=1", string(payload)), http.StatusOK, "")
	requireOpenAIIntegrationStatus(t, generate(), http.StatusServiceUnavailable, "model_unavailable")
}
