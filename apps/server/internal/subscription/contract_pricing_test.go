package subscription_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/contractpricing"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func setContractModel(t *testing.T, st *store.Store, price int64) {
	t.Helper()
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://example.invalid", APIKey: "never-copy-secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "locked-model", Name: "Model", ProviderID: "provider", UpstreamModel: "image", Kind: "image", PriceCents: price, Public: true, Enabled: true, Default: true}}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
}

func buyTrackedPack(t *testing.T, st *store.Store, u *store.User, eligible bool, points int64) *store.Order {
	t.Helper()
	ctx := context.Background()
	p, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: uuid.NewString(), Name: "pack", Kind: "topup", PriceCents: 300, GrantCents: points, Active: true, PriceLockEligible: eligible})
	if err != nil {
		t.Fatal(err)
	}
	o := newOrder(t, st, u.ID, p)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := store.CompleteOrderUpdate(ctx, tx, o.ID, time.Now()); err != nil {
			return err
		}
		if _, err := wallet.Grant(ctx, tx, u.ID, points, "grant", "order", o.ID.String(), nil); err != nil {
			return err
		}
		return store.RecordTopupCreditLot(ctx, tx, o)
	}); err != nil {
		t.Fatal(err)
	}
	return o
}

func TestContractPriceAndFundingGates(t *testing.T) {
	for _, tc := range []struct {
		name                                  string
		allow, eligible, lock                 bool
		daily, count, want, subUsed, packUsed int64
	}{
		{"subscription first", false, false, true, 30, 1, 3, 3, 0},
		{"no protection", true, true, false, 30, 1, 5, 5, 0},
		{"ordinary pack", true, false, true, 1, 1, 5, 1, 4},
		{"low subscription", false, true, true, 1, 1, 5, 1, 4},
		{"qualified mixed", true, true, true, 1, 2, 3, 1, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			u := newUser(t, st)
			setContractModel(t, st, 3)
			p := rollingPlan(t, st, 1, tc.daily, 1990)
			p.SubscriptionPolicy.LockModelPrices = &tc.lock
			p.SubscriptionPolicy.AllowTopupPriceLock = tc.allow
			bonus := 7
			p.SubscriptionPolicy.ConcurrencyBonus = &bonus
			if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
				t.Fatal(err)
			}
			sub := rollingSubscription(t, st, u, p, time.Now())
			if sub.Contract == nil || sub.Contract.ExtraConcurrency() != 7 || sub.Contract.PlanRevision != p.Revision {
				t.Fatalf("contract=%+v", sub.Contract)
			}
			buyTrackedPack(t, st, u, tc.eligible, 100)
			setContractModel(t, st, 5)
			var raw string
			if err := st.Pool.QueryRow(ctx, `SELECT snapshot::text FROM billing_price_books WHERE id=$1`, sub.Contract.PriceBookID).Scan(&raw); err != nil || strings.Contains(raw, "never-copy-secret") {
				t.Fatalf("unsafe book: %v", err)
			}
			id := uuid.NewString()
			var d *store.BillingDecision
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				var err error
				d, err = contractpricing.Resolve(ctx, tx, contractpricing.Request{UserID: u.ID, Feature: "text_to_image", Channel: "web", ModelID: "locked-model", PublicUnitPoints: 5, Count: tc.count})
				if err != nil {
					return err
				}
				bctx := store.WithBillingDecision(wallet.WithSubscriptionScope(ctx, "web", "locked-model"), d)
				_, err = wallet.FreezeFeatureCredits(bctx, tx, u.ID, d.UnitPoints*tc.count, "text_to_image", "task", id, nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if d.UnitPoints != tc.want || d.SubscriptionPoints != tc.subUsed || d.TopupPoints != tc.packUsed {
				t.Fatalf("decision=%+v", d)
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, d.UnitPoints*tc.count, "task", id, nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			audit, err := store.ListBillingAudit(ctx, st.Pool, []string{id})
			if err != nil || len(audit[id]) != 1 || audit[id][0].SettledPoints != tc.want*tc.count {
				t.Fatalf("audit=%+v err=%v", audit, err)
			}
			var packSpent int64
			if err := st.Pool.QueryRow(ctx, `SELECT sum(spent_points) FROM topup_credit_lots WHERE user_id=$1`, u.ID).Scan(&packSpent); err != nil || packSpent != tc.packUsed {
				t.Fatalf("spent=%d err=%v", packSpent, err)
			}
		})
	}
}

func TestContractRefundSuspendsProtectionAndUpgradeRebinds(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	at := time.Now().UTC()
	setContractModel(t, st, 3)
	p := rollingPlan(t, st, 1, 100, 1990)
	p.SubscriptionPolicy.AllowTopupPriceLock = true
	bonus := 8
	p.SubscriptionPolicy.ConcurrencyBonus = &bonus
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	sub := rollingSubscription(t, st, u, p, at)
	setContractModel(t, st, 5)
	change, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "测试买错了套餐", at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	buyTrackedPack(t, st, u, true, 100)
	check := func(want int64, concurrency int) {
		t.Helper()
		err := st.Tx(ctx, func(tx pgx.Tx) error {
			d, err := contractpricing.Resolve(ctx, tx, contractpricing.Request{UserID: u.ID, Feature: "text_to_image", Channel: "web", ModelID: "locked-model", PublicUnitPoints: 5, Count: 1})
			if err != nil {
				return err
			}
			if d.UnitPoints != want {
				t.Fatalf("price=%+v", d)
			}
			n, err := store.GetUserConcurrency(ctx, tx, u.ID)
			if n.Limit != concurrency {
				t.Fatalf("concurrency=%d want=%d", n.Limit, concurrency)
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	check(5, 4)
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "contract-reviewer@example.com", "reviewer", "test")
	if err != nil {
		t.Fatal(err)
	}
	if err := subscription.ReviewRefund(ctx, st, change.ID, admin.ID, "reject", "用户保留订阅", "", at.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	check(3, 12)
	target := rollingPlan(t, st, 2, 200, 3990)
	if _, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at.Add(3*time.Minute)); err == nil {
		t.Fatal("upgrade silently removed concurrency and pack protection")
	}
	target.SubscriptionPolicy.ConcurrencyBonus = &bonus
	target.SubscriptionPolicy.AllowTopupPriceLock = true
	if err := store.UpdatePlan(ctx, st.Pool, target); err != nil {
		t.Fatal(err)
	}
	quote, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if quote.Snapshot.Contract == nil || quote.Snapshot.Contract.PriceBookID == sub.Contract.PriceBookID {
		t.Fatalf("upgrade contract=%+v", quote.Snapshot.Contract)
	}
	order, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, quote.ID, at.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, at.Add(4*time.Minute)); err != nil {
			return err
		}
		_, err := subscription.ApplyUpgrade(ctx, tx, order, at.Add(4*time.Minute))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	latest, err := store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil || latest.Contract.ID == sub.Contract.ID || !latest.EndsAt.Equal(at.Add(4*time.Minute+72*time.Hour)) {
		t.Fatalf("latest=%+v err=%v", latest, err)
	}
}

func TestContractRetryCannotReplayPriceDuringRefund(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	at := time.Now().UTC()
	setContractModel(t, st, 3)
	p := rollingPlan(t, st, 1, 100, 1990)
	sub := rollingSubscription(t, st, u, p, at)
	task, _, err := taskflow.CreateTask(ctx, st, u.ID, taskflow.CreateInput{Type: "t2i", Prompt: "contract test", Count: 1, Params: map[string]any{"publicModelKey": "locked-model"}})
	if err != nil {
		t.Fatal(err)
	}
	if task.CostCents != 3 {
		t.Fatalf("cost=%d", task.CostCents)
	}
	if _, err := taskflow.FailQueuedTask(ctx, st, task.ID, "test_failure", "test"); err != nil {
		t.Fatal(err)
	}
	setContractModel(t, st, 5)
	if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "任务失败后申请退订", at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	buyTrackedPack(t, st, u, true, 100)
	if _, err := taskflow.RequeueTask(ctx, st, task.ID); err == nil || !strings.Contains(err.Error(), "当前价格") {
		t.Fatalf("retry must require new confirmation: %v", err)
	}
	latest, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil || latest.Status != "failed" {
		t.Fatalf("task=%+v err=%v", latest, err)
	}
}

func TestContractProtectedPackUsageBlocksUnusedRefund(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	at := time.Now().UTC()
	setContractModel(t, st, 3)
	p := rollingPlan(t, st, 1, 1, 1990)
	p.SubscriptionPolicy.AllowTopupPriceLock = true
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	sub := rollingSubscription(t, st, u, p, at)
	buyTrackedPack(t, st, u, true, 100)
	setContractModel(t, st, 5)
	// The previous quota has expired, while the next scheduler grant has not arrived yet.
	ctx = store.WithBillingTime(ctx, at.Add(24*time.Hour))
	id := uuid.NewString()
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		d, err := contractpricing.Resolve(ctx, tx, contractpricing.Request{UserID: u.ID, Feature: "text_to_image", Channel: "web", ModelID: "locked-model", PublicUnitPoints: 5, Count: 2})
		if err != nil {
			return err
		}
		if d.UnitPoints != 3 {
			t.Fatalf("price=%+v", d)
		}
		_, err = wallet.FreezeFeatureCredits(store.WithBillingDecision(wallet.WithSubscriptionScope(ctx, "web", "locked-model"), d), tx, u.ID, 6, "text_to_image", "task", id, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	c, err := subscription.RefundCalculation(ctx, st.Pool, sub, store.BillingTime(ctx))
	if err != nil || c.ProtectedTopupFrozenPoints != 6 || c.TaskFrozenPoints != 0 {
		t.Fatalf("refund=%+v err=%v", c, err)
	}
	if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "测试待结算锁价权益", store.BillingTime(ctx)); err == nil {
		t.Fatal("pending protected task allowed refund")
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 3, "task", id, nil); err != nil {
			return err
		}
		_, err := wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 3, "task", id, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	c, err = subscription.RefundCalculation(ctx, st.Pool, sub, store.BillingTime(ctx))
	if err != nil || c.ProtectedUsagePoints != 3 || c.SpentPoints != 0 || c.MaxRefundCents != 0 {
		t.Fatalf("refund=%+v err=%v", c, err)
	}
	if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "测试已用锁价权益退款", store.BillingTime(ctx)); err == nil {
		t.Fatal("used protection allowed unused refund")
	}
	w, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil || w.BalanceCents != 97 || w.EligibleTopupPoints != 97 {
		t.Fatalf("wallet=%+v err=%v", w, err)
	}
}
