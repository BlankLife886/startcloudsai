package subscription_test

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/pricerules"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// 订阅用户的额外优惠叠加在时段调价之后，只给站内请求；开发者 API 的报价不受两者影响。
func TestDynamicPricingStacksSubscriberDiscountOnSiteOnly(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	setContractModel(t, st, 20)
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {ModelIDs: []string{"locked-model"}}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	p := rollingPlan(t, st, 1, 100, 1990)
	lock := false
	p.SubscriptionPolicy.LockModelPrices = &lock
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	// 3 天的订阅，覆盖下面用到的 2026-10-12。
	rollingSubscription(t, st, u, p, time.Date(2026, 10, 11, 12, 0, 0, 0, pricerules.Beijing))
	if err := pricerules.Save(ctx, st.Pool, pricerules.Schedule{
		Enabled: true,
		Rules: []pricerules.Rule{{ID: "day", Name: "工作日白天", Kind: pricerules.KindWeekday, Enabled: true, StartTime: "09:00", EndTime: "17:00",
			Models: map[string]pricerules.Adjustment{"locked-model": {Mode: pricerules.ModePercent, Value: -50}}}},
		Subscriber: pricerules.SubscriberDiscount{Enabled: true, Models: map[string]pricerules.Adjustment{"locked-model": {Mode: pricerules.ModePoints, Value: 3}}},
	}); err != nil {
		t.Fatal(err)
	}

	quote := func(at string) int64 {
		t.Helper()
		when, err := time.ParseInLocation("2006-01-02 15:04", at, pricerules.Beijing)
		if err != nil {
			t.Fatal(err)
		}
		q, err := taskflow.QuoteTaskPrice(store.WithBillingTime(ctx, when), st.Pool, taskflow.CreateInput{
			Type: "t2i", Count: 1, Params: map[string]any{"publicModelKey": "locked-model"},
		}, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		return q.UnitPriceCents
	}
	// 2026-10-12 是周一：白天 20 × 50% = 10，再减订阅 3 积分。
	if got := quote("2026-10-12 10:00"); got != 7 {
		t.Fatalf("weekday daytime subscriber price = %d", got)
	}
	if got := quote("2026-10-12 18:00"); got != 17 {
		t.Fatalf("after hours subscriber price = %d", got)
	}

	selection, ok := modelconfig.SelectPublic(cfg, modelconfig.ModelKindImage, "locked-model")
	if !ok {
		t.Fatal("model not selectable")
	}
	when, _ := time.ParseInLocation("2006-01-02 15:04", "2026-10-12 10:00", pricerules.Beijing)
	api, err := taskflow.QuoteSelectedImage(store.WithBillingTime(ctx, when), st.Pool, cfg, modelconfig.WorkspaceT2I, *selection,
		taskflow.CreateInput{Type: "t2i", Count: 1, Params: map[string]any{}}, 20, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if api.UnitPriceCents != 20 || api.Billing.SubscriberDiscountPoints != 0 {
		t.Fatalf("developer API quote = %d (%+v)", api.UnitPriceCents, api.Billing)
	}
}
