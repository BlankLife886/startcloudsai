package subscription_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/pricerules"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// 订阅锁价与动态调价叠加：锁定价更低时按锁定价，限时降价后当前价更低时按当前价；
// 两种情况都再减订阅优惠，提交任务时扣的就是报价的价格，并从订阅额度里扣。
func TestDynamicPricingWithSubscriptionPriceLock(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	// 订阅时模型 10 积分，锁进价格本；之后公开价涨到 20。
	setContractModel(t, st, 10)
	p := rollingPlan(t, st, 1, 100, 1990)
	lock := true
	p.SubscriptionPolicy.LockModelPrices = &lock
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	sub := rollingSubscription(t, st, u, p, time.Date(2026, 10, 11, 12, 0, 0, 0, pricerules.Beijing))
	if sub.Contract == nil || !sub.Contract.LockModelPrices {
		t.Fatalf("contract = %+v", sub.Contract)
	}
	setContractModel(t, st, 20)
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {ModelIDs: []string{"locked-model"}}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if err := pricerules.Save(ctx, st.Pool, pricerules.Schedule{
		Enabled: true,
		Rules: []pricerules.Rule{
			{ID: "day", Name: "工作日白天", Kind: pricerules.KindWeekday, Enabled: true, StartTime: "09:00", EndTime: "17:00",
				Models: map[string]pricerules.Adjustment{"locked-model": {Mode: pricerules.ModePercent, Value: -30}}},
			{ID: "sale", Name: "大促", Kind: pricerules.KindDate, Enabled: true, StartAt: "2026-10-13T00:00", EndAt: "2026-10-14T00:00",
				Models: map[string]pricerules.Adjustment{"locked-model": {Mode: pricerules.ModePercent, Value: -80}}},
		},
		Subscriber: pricerules.SubscriberDiscount{Enabled: true, Models: map[string]pricerules.Adjustment{"locked-model": {Mode: pricerules.ModePoints, Value: 2}}},
	}); err != nil {
		t.Fatal(err)
	}
	at := func(value string) context.Context {
		when, err := time.ParseInLocation("2006-01-02 15:04", value, pricerules.Beijing)
		if err != nil {
			t.Fatal(err)
		}
		return store.WithBillingTime(ctx, when)
	}
	input := func() taskflow.CreateInput {
		return taskflow.CreateInput{Type: "t2i", Prompt: "lock", Count: 1, Params: map[string]any{"publicModelKey": "locked-model"}}
	}

	for _, tc := range []struct {
		name, at, source string
		public, unit     int64
	}{
		// 公开价 20 × 70% = 14，锁定价 10 更低：按 10，再减订阅 2。
		{"locked price is lower", "2026-10-12 10:00", "subscription_contract", 14, 8},
		// 工作日规则开始前（订阅第一天的额度仍有效）：公开价 20，锁定价 10。
		{"before the weekday window", "2026-10-12 08:00", "subscription_contract", 20, 8},
		// 大促 20 × 20% = 4，比锁定价 10 低：按当前价 4，再减订阅 2。
		{"sale beats the lock", "2026-10-13 10:00", "public", 4, 2},
	} {
		quote, err := taskflow.QuoteTaskPrice(at(tc.at), st.Pool, input(), u.ID)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		d := quote.Billing
		if d == nil || d.PublicUnitPoints != tc.public || d.UnitPoints != tc.unit || d.Source != tc.source || d.SubscriberDiscountPoints != 2 || quote.UnitPriceCents != tc.unit {
			t.Fatalf("%s: quote=%d decision=%+v", tc.name, quote.UnitPriceCents, d)
		}
		if tc.source == "public" && !strings.Contains(d.Reason, "低于锁定") {
			t.Fatalf("%s: reason = %q", tc.name, d.Reason)
		}
	}

	// 提交时扣的就是报价的价格，从订阅额度里扣。
	before, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	expected := int64(8)
	in := input()
	in.ExpectedUnitPriceCents = &expected
	task, _, err := taskflow.CreateTask(at("2026-10-12 10:00"), st, u.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	after, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task.CostCents != 8 || before.SubscriptionBalanceCents-after.SubscriptionBalanceCents != 8 || after.BalanceCents != before.BalanceCents {
		t.Fatalf("task cost=%d subscription %d→%d normal %d→%d", task.CostCents, before.SubscriptionBalanceCents, after.SubscriptionBalanceCents, before.BalanceCents, after.BalanceCents)
	}
}
