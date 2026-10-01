package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestSubscriptionCheckoutPinsConfirmedPlanRevision(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, seed := makeOrder(t, st)
	if _, err := store.CloseOrder(ctx, st.Pool, seed.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	plan, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: uuid.NewString(), Name: "订阅确认测试", Kind: "subscription", PriceCents: 1990, DurationDays: 3, DailyGrantCents: 100, SubscriptionPolicy: store.DefaultSubscriptionPolicy(), Active: true})
	if err != nil {
		t.Fatal(err)
	}
	previous := plan.Revision
	plan.DailyGrantCents = 200
	if err = store.UpdatePlan(ctx, st.Pool, plan); err != nil {
		t.Fatal(err)
	}
	if _, _, err = store.GetOrInsertPendingOrderAtRevision(ctx, st, user.ID, plan.ID, plan.PriceCents, 0, 0, "lanjing", previous); !errors.Is(err, store.ErrOrderPlanChanged) {
		t.Fatalf("stale rights accepted: %v", err)
	}
	fake := newFakeLanjing(t)
	client := fake.client()
	cfg := config.Load()
	token := auth.NewSessionToken()
	if err = store.InsertSession(ctx, st.Pool, user.ID, auth.HashToken(token), time.Now().Add(time.Hour), nil, nil); err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: cfg.SessionCookieName, Value: token}
	router := (&Server{Cfg: cfg, St: st, LanjingPay: client}).Router()
	create := func(revision int) *httptest.ResponseRecorder {
		return authRequest(t, router, "POST", "/api/v1/orders", gin.H{"planId": plan.ID, "paymentMethod": "alipay", "expectedPlanRevision": revision}, cookie)
	}
	r := create(previous)
	if r.Code != 409 || !strings.Contains(r.Body.String(), "plan_changed") || fake.count("/createOrder") != 0 {
		t.Fatalf("stale checkout=%d %s", r.Code, r.Body.String())
	}
	r = create(plan.Revision)
	if r.Code != 201 {
		t.Fatalf("confirmed checkout=%d %s", r.Code, r.Body.String())
	}
	orders, err := store.ListUnsettledOrdersForUser(ctx, st.Pool, user.ID)
	if err != nil || len(orders) != 1 {
		t.Fatalf("orders=%v %v", orders, err)
	}
	if orders[0].PlanRevision != plan.Revision || orders[0].PlanDailyGrantCents != 200 {
		t.Fatalf("wrong confirmed snapshot: %+v", orders[0])
	}
}
