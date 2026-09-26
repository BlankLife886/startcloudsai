package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestOrderSearchSummaryAndOwnership(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	_, _ = makeOrder(t, st)
	for _, status := range []string{"completed", "failed"} {
		extra, err := store.InsertOrder(ctx, st.Pool, user.ID, order.PlanID, 990, 1000, 200, "mock")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status=$2 WHERE id=$1`, extra.ID, status); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE plans SET name='updated catalog' WHERE id=$1`, order.PlanID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE orders SET provider_order_id='lookup-channel-123' WHERE id=$1`, order.ID); err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	router := (&Server{Cfg: cfg, St: st}).Router()
	for _, query := range []string{order.ID.String(), "LOOKUP-channel", "基础包"} {
		response := authRequest(t, router, http.MethodGet, "/api/v1/orders?limit=1&status=pending&q="+url.QueryEscape(query), nil, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("query %q: %s", query, response.Body.String())
		}
		var body struct {
			Data struct {
				Items []struct {
					ID       string `json:"id"`
					PlanName string `json:"planName"`
				} `json:"items"`
				Summary store.OrderSummary `json:"summary"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Data.Items) != 1 || body.Data.Items[0].ID != order.ID.String() || body.Data.Items[0].PlanName != "基础包" {
			t.Fatalf("items: %+v", body.Data.Items)
		}
		if body.Data.Summary.Total != 3 || body.Data.Summary.Pending != 1 || body.Data.Summary.Completed != 1 || body.Data.Summary.Failed != 1 {
			t.Fatalf("summary: %+v", body.Data.Summary)
		}
	}
	missing := authRequest(t, router, http.MethodGet, "/api/v1/orders?q=updated", nil, cookie)
	var body struct {
		Data struct {
			Items []any `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(missing.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Items) != 0 {
		t.Fatal("search used edited catalog instead of purchase snapshot")
	}
}

func TestOrderDetailDoesNotExposeUnvalidatedProviderData(t *testing.T) {
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "stored-provider", 990, "alipay")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "data": map[string]any{
			"orderId": "unexpected-provider", "payId": order.ID.String(), "payType": 2, "price": "999.00", "reallyPrice": "999.00", "payUrl": "https://unvalidated.example/pay", "state": 0, "isAuto": 1, "timeOut": 5, "date": time.Now().UnixMilli(),
		}})
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "test-secret", "https://example.com/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(context.Background(), st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	response := authRequest(t, (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router(), http.MethodGet, "/api/v1/orders/"+order.ID.String(), nil, &http.Cookie{Name: cfg.SessionCookieName, Value: token})
	var body struct {
		Data struct {
			PayURL    string `json:"payUrl"`
			SyncError string `json:"syncError"`
			PlanName  string `json:"planName"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || body.Data.PayURL != "https://qr.example/pay" || body.Data.SyncError == "" || body.Data.PlanName != "基础包" {
		t.Fatalf("unsafe detail: %s", response.Body.String())
	}
}

func TestOrderCreationRejectsStalePlanPrice(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, order := makeOrder(t, st)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, order.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE plans SET price_cents=1990 WHERE id=$1`, order.PlanID); err != nil {
		t.Fatal(err)
	}
	_, _, err := store.GetOrInsertPendingOrder(ctx, st, user.ID, order.PlanID, order.AmountCents, order.GrantCents, order.BonusCents, "lanjing")
	if !errors.Is(err, store.ErrOrderPlanChanged) {
		t.Fatalf("expected stale plan rejection, got %v", err)
	}
	count, err := store.CountOrdersByUser(ctx, st.Pool, user.ID)
	if err != nil || count != 1 {
		t.Fatalf("unexpected order inserted: count=%d error=%v", count, err)
	}
}
