package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestSingleUnpaidOrderAcrossPlans(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, existing := makeOrder(t, st)
	_, otherPlanOrder := makeOrder(t, st)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "simulated uncertain create", 504)
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
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	router := (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router()
	body := gin.H{"planId": otherPlanOrder.PlanID.String(), "paymentMethod": "alipay"}
	for _, status := range []string{"pending", "uncertain", "paid"} {
		if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status=$2,provider='lanjing' WHERE id=$1`, existing.ID, status); err != nil {
			t.Fatal(err)
		}
		response := authRequest(t, router, "POST", "/api/v1/orders", body, cookie)
		if response.Code != 409 || !strings.Contains(response.Body.String(), "user_unsettled_order") {
			t.Fatalf("%s: %d %s", status, response.Code, response.Body.String())
		}
	}
	if calls.Load() != 0 {
		t.Fatal("blocked checkout contacted provider")
	}
	count, err := store.CountOrdersByUser(ctx, st.Pool, user.ID)
	if err != nil || count != 1 {
		t.Fatalf("blocked checkout inserted an order: %d %v", count, err)
	}
	for _, status := range []string{"cancelled", "expired", "failed", "completed"} {
		if _, err := st.Pool.Exec(ctx, `UPDATE orders SET status=$2 WHERE user_id=$1`, user.ID, status); err != nil {
			t.Fatal(err)
		}
		response := authRequest(t, router, "POST", "/api/v1/orders", body, cookie)
		if response.Code != 202 {
			t.Fatalf("%s should allow a new checkout: %d %s", status, response.Code, response.Body.String())
		}
	}
	if calls.Load() != 4 {
		t.Fatalf("provider calls=%d, want 4", calls.Load())
	}
}

func TestConcurrentCrossPlanCheckoutsCreateOneProviderOrder(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	_, otherPlanOrder := makeOrder(t, st)
	if _, err := store.TransitionPendingOrderStatus(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "simulated uncertain create", 504)
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
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	router := (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router()
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 12)
	var wg sync.WaitGroup
	for n := range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			planID := []uuid.UUID{seed.PlanID, otherPlanOrder.PlanID}[n%2]
			responses <- authRequest(t, router, "POST", "/api/v1/orders", gin.H{"planId": planID.String(), "paymentMethod": "alipay"}, cookie)
		}()
	}
	close(start)
	wg.Wait()
	close(responses)
	var orderID string
	for response := range responses {
		if response.Code == 409 && strings.Contains(response.Body.String(), "user_unsettled_order") {
			continue
		}
		if response.Code != 202 {
			t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
		}
		var body struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if orderID != "" && body.Data.ID != orderID {
			t.Fatal("multiple unsettled orders returned")
		}
		orderID = body.Data.ID
	}
	if calls.Load() != 1 || orderID == "" {
		t.Fatalf("provider calls=%d, order=%s", calls.Load(), orderID)
	}
	var unsettled int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE user_id=$1 AND status IN ('pending','uncertain','paid')`, user.ID).Scan(&unsettled); err != nil {
		t.Fatal(err)
	}
	if unsettled != 1 {
		t.Fatalf("unsettled orders=%d, want 1", unsettled)
	}
}
