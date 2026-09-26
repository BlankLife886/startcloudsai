package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestOpenAPIUsageQuoteAndScopes(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, _ := makeOrder(t, st)
	raw, _ := json.Marshal(map[string]settings.PageControl{"developer_api": {Status: settings.PageStatusNormal}})
	if err := settings.Set(ctx, st.Pool, "page_controls", raw); err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://example.com", APIKey: "test-secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "image", Name: "Image", ProviderID: "provider", UpstreamModel: "image-upstream", Kind: modelconfig.ModelKindImage, PriceCents: 20, Public: true, Default: true, Enabled: true}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	secret, _ := newAPISecret()
	key, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{UserID: user.ID, KeyPrefix: secret[:18], KeyHash: hashAPISecret(secret), Label: "test", Scopes: []string{"tasks:read", "tasks:write"}, AllowedModelIDs: []string{"image"}, DailyTaskLimit: 100, MonthlyTaskLimit: 1000, DailySpendLimitCents: 10000, MonthlySpendLimitCents: 100000})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{St: st, Cfg: config.Load()}
	router := server.Router()
	request := func(method, path string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+secret)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	if w := request("GET", "/api/open/v1/usage", nil); w.Code != 200 {
		t.Fatalf("usage: %d %s", w.Code, w.Body.String())
	}
	body := map[string]any{"type": "t2i", "count": 1, "params": map[string]any{"modelId": "image"}}
	if w := request("POST", "/api/open/v1/tasks/quote", body); w.Code != 200 {
		t.Fatalf("quote: %d %s", w.Code, w.Body.String())
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE user_api_keys SET allowed_model_ids=ARRAY['other'] WHERE id=$1`, key.ID); err != nil {
		t.Fatal(err)
	}
	if w := request("POST", "/api/open/v1/tasks/quote", body); w.Code != 403 {
		t.Fatalf("model restriction: %d %s", w.Code, w.Body.String())
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE user_api_keys SET scopes=ARRAY['models:read'] WHERE id=$1`, key.ID); err != nil {
		t.Fatal(err)
	}
	if w := request("GET", "/api/open/v1/usage", nil); w.Code != 403 {
		t.Fatalf("usage scope: %d", w.Code)
	}
	var tasks int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE user_id=$1`, user.ID).Scan(&tasks); err != nil || tasks != 0 {
		t.Fatalf("quote created task: %d %v", tasks, err)
	}
}

func TestOpenAPIWebhookDisabledEndpointsDoNotStarveActive(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, _ := makeOrder(t, st)
	first, err := store.InsertAPIWebhookEndpoint(ctx, st.Pool, &store.APIWebhookEndpoint{UserID: user.ID, Label: "disabled", URL: "https://example.com/off", SecretEncrypted: "test", Events: []string{"task.succeeded"}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.InsertAPIWebhookEndpoint(ctx, st.Pool, &store.APIWebhookEndpoint{UserID: user.ID, Label: "active", URL: "https://example.com/on", SecretEncrypted: "test", Events: []string{"task.succeeded"}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.EnqueueTaskWebhookDeliveries(ctx, st.Pool, &store.Task{ID: uuid.New(), UserID: user.ID, Params: map[string]any{"_apiKeyId": "test"}}, "succeeded", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE api_webhook_endpoints SET enabled=false WHERE id=$1`, first.ID); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimAPIWebhookDeliveries(ctx, st.Pool, "test-owner", time.Now().Add(time.Second), 45*time.Second, 1)
	if err != nil || len(claimed) != 1 || claimed[0].EndpointID != second.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	var locked bool
	if err := st.Pool.QueryRow(ctx, `SELECT locked_until IS NOT NULL FROM api_webhook_deliveries WHERE endpoint_id=$1`, first.ID).Scan(&locked); err != nil || locked {
		t.Fatalf("disabled delivery leased: %v %v", locked, err)
	}
}

func TestOpenAPIFrozenKeyCannotRotate(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, _ := makeOrder(t, st)
	secret, _ := newAPISecret()
	key, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{UserID: user.ID, KeyPrefix: secret[:18], KeyHash: hashAPISecret(secret), Label: "frozen", Scopes: []string{"tasks:read"}, AllowedModelIDs: []string{}, DailyTaskLimit: 100, MonthlyTaskLimit: 1000, DailySpendLimitCents: 10000, MonthlySpendLimitCents: 100000})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE user_api_keys SET status='frozen' WHERE id=$1`, key.ID); err != nil {
		t.Fatal(err)
	}
	s := &Server{St: st, Cfg: config.Load()}
	r := gin.New()
	r.POST("/:id", func(c *gin.Context) { c.Set(ctxOpenAPIUser, user); s.rotateMyAPIKey(c) })
	response := authRequest(t, r, "POST", "/"+key.ID.String(), nil)
	if response.Code != 403 {
		t.Fatalf("rotation: %d %s", response.Code, response.Body.String())
	}
	var count int
	st.Pool.QueryRow(ctx, `SELECT count(*) FROM user_api_keys WHERE user_id=$1`, user.ID).Scan(&count)
	if count != 1 {
		t.Fatal("rotation created another key")
	}
}
