package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
)

func TestCancellationRemainsDistinctAndVerifiedReconciliationRecovers(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, order := makeOrder(t, st)
	order = prepareLanjingOrder(t, st, order, "cancel-test", order.AmountCents, "alipay")
	var state, closes atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/closeOrder":
			closes.Add(1)
			state.Store(-1)
			_ = json.NewEncoder(w).Encode(gin.H{"code": 1})
		case "/checkOrder":
			_ = json.NewEncoder(w).Encode(gin.H{"code": -1, "msg": "not paid"})
		case "/getOrder":
			_ = json.NewEncoder(w).Encode(gin.H{"code": 1, "data": gin.H{
				"payId": order.ID.String(), "orderId": "cancel-test", "payType": 2,
				"price": "9.90", "reallyPrice": "9.90", "state": state.Load(),
				"isAuto": 0, "timeOut": 5, "date": time.Now().UnixMilli(),
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	client, err := lanjingpay.New(provider.URL, "test", provider.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err := store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Cfg: cfg, St: st, LanjingPay: client}
	router := srv.Router()
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	for range 2 {
		response := authRequest(t, router, "POST", "/api/v1/orders/"+order.ID.String()+"/close", nil, cookie)
		var body struct {
			Data struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || body.Data.Status != "cancelled" {
			t.Fatalf("cancel: %d %s", response.Code, response.Body.String())
		}
	}
	if closes.Load() != 1 {
		t.Fatalf("close calls=%d", closes.Load())
	}
	response := authRequest(t, router, "GET", "/api/v1/orders?status=cancelled", nil, cookie)
	var list struct {
		Data struct {
			Items []struct {
				Status string `json:"status"`
			} `json:"items"`
			Summary store.OrderSummary `json:"summary"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || len(list.Data.Items) != 1 || list.Data.Items[0].Status != "cancelled" || list.Data.Summary.Cancelled != 1 || list.Data.Summary.Expired != 0 {
		t.Fatalf("cancelled filter/summary: %s", response.Body.String())
	}
	fresh, err := store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := srv.completeOrder(ctx, fresh); err == nil {
		t.Fatal("unverified completion accepted for cancelled order")
	}
	result, err := srv.reconcilePaymentOrder(ctx, fresh)
	if err != nil || result.Outcome != "matched" {
		t.Fatalf("closed reconciliation: %+v %v", result, err)
	}
	fresh, err = store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil || fresh.Status != "cancelled" {
		t.Fatalf("cancellation overwritten: %+v %v", fresh, err)
	}
	wallet, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != 0 {
		t.Fatalf("cancel granted credit: %+v %v", wallet, err)
	}
	if delay := reconciliationDelay(fresh, result, false); delay != 24*time.Hour {
		t.Fatalf("cancelled audit delay: %s", delay)
	}
	state.Store(1)
	for range 2 {
		fresh, err = store.GetOrder(ctx, st.Pool, order.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := srv.reconcilePaymentOrder(ctx, fresh); err != nil {
			t.Fatal(err)
		}
	}
	fresh, err = store.GetOrder(ctx, st.Pool, order.ID)
	if err != nil || fresh.Status != "completed" {
		t.Fatalf("verified recovery failed: %+v %v", fresh, err)
	}
	wallet, err = store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || wallet.BalanceCents != 1200 {
		t.Fatalf("recovery balance: %+v %v", wallet, err)
	}
}
