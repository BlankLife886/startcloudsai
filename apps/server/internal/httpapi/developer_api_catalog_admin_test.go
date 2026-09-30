package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func (env *openAIImagesIntegrationEnv) adminCall(t *testing.T, token, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "/api/v1/admin/developer-api/models"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: token})
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, request)
	return recorder
}

// An admin creates a second API model on the same site model at a fixed
// price, publishes it, and it is callable under its own name and price; the
// published name is locked, a live price increase is announced rather than
// applied while a decrease applies at once, names are unique under /v1
// comparison, and withdrawing needs a reason. Every change is logged.
func TestDeveloperAPIModelCatalogAdminLifecycle(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	admin, err := store.UpsertAdminAccount(ctx, env.st.Pool, "catalog-admin@test.dev", "admin", "x")
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
	generate := func(model string) *httptest.ResponseRecorder {
		return env.serve(t, env.request("POST", "/v1/images/generations", "application/json", "", strings.NewReader(`{"model":"`+model+`","prompt":"catalog"}`)))
	}
	decode := func(response *httptest.ResponseRecorder) map[string]any {
		var body struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode %s: %v", response.Body.String(), err)
		}
		return body.Data
	}
	expect := func(response *httptest.ResponseRecorder, status int, contains string) {
		t.Helper()
		if response.Code != status || !strings.Contains(response.Body.String(), contains) {
			t.Fatalf("status=%d body=%s; want %d containing %q", response.Code, response.Body.String(), status, contains)
		}
	}

	list := env.adminCall(t, token, "GET", "", "")
	expect(list, http.StatusOK, `"apiName":"compat-image"`)

	created := env.adminCall(t, token, "POST", "", `{"apiName":"compat-vip","targetModelId":"compat-image","priceMode":"fixed","priceCents":5}`)
	expect(created, http.StatusCreated, `"status":"draft"`)
	id := decode(created)["id"].(string)
	requireOpenAIIntegrationStatus(t, generate("compat-vip"), http.StatusNotFound, "model_not_found")

	expect(env.adminCall(t, token, "POST", "", `{"apiName":"COMPAT.IMAGE","targetModelId":"compat-image"}`), http.StatusUnprocessableEntity, "已被 API 模型")
	expect(env.adminCall(t, token, "POST", "/"+id+"/publish", `{}`), http.StatusOK, `"status":"live"`)
	requireOpenAIIntegrationStatus(t, generate("compat-vip"), http.StatusOK, "")
	env.requireWallet(t, 995, 0)

	expect(env.adminCall(t, token, "PATCH", "/"+id, `{"apiName":"compat-vip-2"}`), http.StatusUnprocessableEntity, "已发布的模型名称不能修改")
	raised := env.adminCall(t, token, "PATCH", "/"+id, `{"priceCents":8}`)
	expect(raised, http.StatusOK, `"unitPriceCents":5`)
	if pending, _ := decode(raised)["pendingPrice"].(map[string]any); pending == nil || pending["priceCents"] != float64(8) {
		t.Fatalf("an increase on a live model is announced: %v", decode(raised)["pendingPrice"])
	}
	lowered := env.adminCall(t, token, "PATCH", "/"+id, `{"priceCents":3,"aliases":["vip-legacy"]}`)
	expect(lowered, http.StatusOK, `"unitPriceCents":3`)
	expect(lowered, http.StatusOK, `"pendingPrice":null`)
	requireOpenAIIntegrationStatus(t, generate("vip-legacy"), http.StatusOK, "")
	env.requireWallet(t, 992, 0)

	expect(env.adminCall(t, token, "POST", "/"+id+"/withdraw", `{}`), http.StatusUnprocessableEntity, "请填写原因")
	expect(env.adminCall(t, token, "POST", "/"+id+"/withdraw", `{"reason":"上游故障"}`), http.StatusOK, `"status":"draft"`)
	requireOpenAIIntegrationStatus(t, generate("compat-vip"), http.StatusNotFound, "model_not_found")

	var events int
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM developer_api_model_events WHERE api_model_id=$1`, id).Scan(&events); err != nil || events != 5 {
		t.Fatalf("events=%d err=%v; want create, publish, two updates, withdraw", events, err)
	}
	var calls int
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM developer_api_billing_requests WHERE api_model_id=$1 AND api_model_name='compat-vip'`, id).Scan(&calls); err != nil || calls != 2 {
		t.Fatalf("calls recorded under the catalog entry=%d err=%v", calls, err)
	}
}

// API charges stay out of wallet history, so their totals surface elsewhere:
// the user's monthly API summary, the admin credit-lot split and the order's
// API share for refund accounting.
func TestDeveloperAPISpendIsVisibleOutsideWalletHistory(t *testing.T) {
	env := newOpenAIImagesIntegrationEnv(t)
	ctx := context.Background()
	if _, err := env.st.Pool.Exec(ctx, `UPDATE wallets SET balance_cents=0 WHERE user_id=$1`, env.user.ID); err != nil {
		t.Fatal(err)
	}
	plan, err := store.InsertPlan(ctx, env.st.Pool, &store.Plan{Code: "api-pack-" + env.user.ID.String()[:8], Name: "pack", Kind: "topup", PriceCents: 300, GrantCents: 100, Active: true})
	if err != nil {
		t.Fatal(err)
	}
	order, err := store.InsertOrder(ctx, env.st.Pool, env.user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, time.Now()); err != nil {
			return err
		}
		if _, err := wallet.Grant(ctx, tx, env.user.ID, 100, "grant", "order", order.ID.String(), nil); err != nil {
			return err
		}
		return store.RecordTopupCreditLot(ctx, tx, order)
	}); err != nil {
		t.Fatal(err)
	}
	requireOpenAIIntegrationStatus(t, env.generate(t, `{"model":"compat-image","prompt":"spend"}`), http.StatusOK, "")

	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, env.st.Pool, env.user.ID, auth.HashToken(token), time.Now().Add(30*24*time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me/api-usage-summary", nil)
	request.AddCookie(&http.Cookie{Name: env.srv.Cfg.SessionCookieName, Value: token})
	recorder := httptest.NewRecorder()
	env.router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"monthPoints":20`) || !strings.Contains(recorder.Body.String(), `"monthCalls":1`) {
		t.Fatalf("summary = %d %s", recorder.Code, recorder.Body.String())
	}

	var lots []store.UserCreditLot
	var summary store.CreditLotSummary
	if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
		lots, summary, err = store.ListUserCreditLots(ctx, tx, store.CreditLotFilter{UserID: env.user.ID}, 1, 20)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if len(lots) != 1 || lots[0].SpentPoints != 20 || lots[0].APISpentPoints != 20 || summary.APISpent != 20 {
		t.Fatalf("lots=%+v summary=%+v", lots, summary)
	}
	if spent, err := store.OrderAPISpentPoints(ctx, env.st.Pool, order.ID); err != nil || spent != 20 {
		t.Fatalf("order API spend=%d err=%v", spent, err)
	}
}
