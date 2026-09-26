package subscription_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func rollingPlan(t *testing.T, st *store.Store, tier int, daily, price int64) *store.Plan {
	t.Helper()
	policy := store.DefaultSubscriptionPolicy()
	policy.Tier = tier
	p, err := store.InsertPlan(context.Background(), st.Pool, &store.Plan{Code: "rolling-" + uuid.NewString(), Name: "24小时订阅", Kind: "subscription", DurationDays: 3, DailyGrantCents: daily, PriceCents: price, Active: true, SubscriptionPolicy: policy})
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func rollingSubscription(t *testing.T, st *store.Store, u *store.User, p *store.Plan, at time.Time) *store.Subscription {
	t.Helper()
	o := newOrder(t, st, u.ID, p)
	if _, err := store.CompleteOrderUpdate(context.Background(), st.Pool, o.ID, at); err != nil {
		t.Fatal(err)
	}
	return applyOrder(t, st, o, p, at)
}
func rollingBalance(t *testing.T, st *store.Store, u uuid.UUID, expected int64) {
	t.Helper()
	w, err := store.GetWallet(context.Background(), st.Pool, u)
	if err != nil || w.SubscriptionBalanceCents != expected {
		t.Fatalf("subscription wallet=%+v error=%v want=%d", w, err, expected)
	}
}
func TestRollingSubscriptionUsesExact24HourIntervals(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	start := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, p, start)
	rollingBalance(t, st, u.ID, 100)
	for _, step := range []struct {
		elapsed time.Duration
		balance int64
	}{{time.Hour, 100}, {24*time.Hour - time.Second, 100}, {24 * time.Hour, 100}, {48 * time.Hour, 100}, {72 * time.Hour, 0}, {96 * time.Hour, 0}} {
		for range 2 {
			if err := subscription.Tick(ctx, st, start.Add(step.elapsed)); err != nil {
				t.Fatal(err)
			}
			rollingBalance(t, st, u.ID, step.balance)
		}
	}
	if !sub.EndsAt.Equal(start.Add(72 * time.Hour)) {
		t.Fatal("expiry is not 72 hours")
	}
	if balance(t, st, u.ID) != 0 {
		t.Fatal("scoped subscription credits leaked into normal balance")
	}
}
func TestScopedSubscriptionFundingAndPartialRelease(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	p.SubscriptionPolicy.Channels = []string{"api"}
	p.SubscriptionPolicy.FeatureKeys = []string{"text_to_image"}
	p.SubscriptionPolicy.ModelIDs = []string{"image-model"}
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	rollingSubscription(t, st, u, p, time.Now())
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, u.ID, 50, "grant", "test", "normal", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []struct{ channel, model, feature string }{{"web", "image-model", "text_to_image"}, {"api", "other-model", "text_to_image"}, {"api", "image-model", "ui_design"}} {
		err := st.Tx(ctx, func(tx pgx.Tx) error {
			_, err := wallet.FreezeFeatureCredits(wallet.WithSubscriptionScope(ctx, scope.channel, scope.model), tx, u.ID, 100, scope.feature, "test", uuid.NewString(), nil)
			return err
		})
		if err == nil {
			t.Fatal("scope mismatch was allowed")
		}
		rollingBalance(t, st, u.ID, 100)
	}
	billing := wallet.WithSubscriptionScope(ctx, "api", "image-model")
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(billing, tx, u.ID, 120, "text_to_image", "test", "mixed", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 0)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 40, "test", "mixed", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 80, "test", "mixed", nil)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	rollingBalance(t, st, u.ID, 40)
	w, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil || w.BalanceCents != 30 || w.FrozenCents != 0 || w.SubscriptionFrozenCents != 0 {
		t.Fatalf("mixed wallet=%+v %v", w, err)
	}
}
func TestUpgradeRestartsFullPeriodAndRefundRevokesOnlySubscription(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	target := rollingPlan(t, st, 2, 200, 600)
	at := time.Now().UTC().Truncate(time.Second)
	start := at.Add(-12 * time.Hour)
	sub := rollingSubscription(t, st, u, p, start)
	if _, _, err := store.GetOrInsertPendingOrder(ctx, st, u.ID, target.ID, target.PriceCents, 0, 0, "lanjing"); err != store.ErrAlreadySubscribed {
		t.Fatalf("second subscription accepted: %v", err)
	}
	quote, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	if quote.AmountCents != 350 {
		t.Fatalf("quote=%d", quote.AmountCents)
	}
	order, created, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, quote.ID)
	if err != nil || !created {
		t.Fatalf("upgrade order: %v", err)
	}
	for range 2 {
		err = st.Tx(ctx, func(tx pgx.Tx) error {
			if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, at); err != nil {
				return err
			}
			_, err := subscription.ApplyUpgrade(ctx, tx, order, at)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	rollingBalance(t, st, u.ID, 200)
	current, err := store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil || !current.StartsAt.Equal(at) || !current.EndsAt.Equal(at.Add(72*time.Hour)) || current.PlanID != target.ID {
		t.Fatalf("upgrade=%+v %v", current, err)
	}
	if err := subscription.Tick(ctx, st, start.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 200)
	if err := subscription.Tick(ctx, st, at.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 200)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, u.ID, 75, "grant", "test", "topup", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	refund, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "测试购买错误申请退款", at)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "refund@example.com", "reviewer", "test")
	if err != nil {
		t.Fatal(err)
	}
	if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "approve", "审核确认未使用订阅积分", "", at); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 0)
	if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "confirm_external_refund", "已核查模拟渠道退款完成", "refund-test-reference", at); err != nil {
		t.Fatal(err)
	}
	current, err = store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil || current.Status != "cancelled" {
		t.Fatalf("refund subscription=%+v %v", current, err)
	}
	if balance(t, st, u.ID) != 75 {
		t.Fatal("refund touched topup credits")
	}
	if err := subscription.Tick(ctx, st, at.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 0)
}

func TestUsedSubscriptionCreditsCannotBeRefunded(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	at := time.Now().UTC().Truncate(time.Second)
	sub := rollingSubscription(t, st, u, p, at.Add(-24*time.Hour))
	if err := subscription.Tick(ctx, st, at); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 1, "text_to_image", "test", "consume", nil); err != nil {
			return err
		}
		_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 1, "test", "consume", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	amount, err := subscription.PreviewRefund(ctx, st, u.ID, sub.ID, at)
	if err == nil || amount != 0 {
		t.Fatalf("used credits allowed refund=%d %v", amount, err)
	}
	calculation, err := subscription.RefundCalculation(ctx, st.Pool, sub, at)
	if err != nil || calculation.SpentPoints != 1 || calculation.MaxRefundCents != 0 || calculation.Rule != "subscription_credits_used" {
		t.Fatalf("partial-use breakdown=%+v %v", calculation, err)
	}
	if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "测试剩余服务期间退款", at); err == nil {
		t.Fatal("accepted refund after subscription credits were used")
	}
	current, err := store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil || current.Status != "active" {
		t.Fatalf("rejected request changed subscription: %+v %v", current, err)
	}
}

func TestManualRefundOverridesUsageButPreservesSettlementGuards(t *testing.T) {
	for _, reject := range []bool{false, true} {
		t.Run(fmt.Sprint(reject), func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			u := newUser(t, st)
			p := rollingPlan(t, st, 1, 100, 300)
			at := time.Now().UTC().Truncate(time.Second)
			sub := rollingSubscription(t, st, u, p, at)
			admin, err := store.UpsertAdminAccount(ctx, st.Pool, "manual-admin@example.com", "reviewer", "hash")
			if err != nil {
				t.Fatal(err)
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 40, "text_to_image", "test", "used", nil); err != nil {
					return err
				}
				_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 40, "test", "used", nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "用户仍然不能自助退款", at); err == nil {
				t.Fatal("user bypassed usage rule")
			}
			if _, err := subscription.RequestManualRefund(ctx, st, admin.ID, *sub.OrderID, 301, "协商例外退款超出实付", at); err == nil {
				t.Fatal("accepted excessive manual refund")
			}
			rollingBalance(t, st, u.ID, 60)
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 10, "text_to_image", "test", "pending", nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if _, err := subscription.RequestManualRefund(ctx, st, admin.ID, *sub.OrderID, 200, "协商例外退款等待任务", at); err == nil {
				t.Fatal("ignored pending subscription task")
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 10, "test", "pending", nil); err != nil {
					return err
				}
				_, err := wallet.Grant(ctx, tx, u.ID, 500, "grant", "test", "topup", nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			refund, err := subscription.RequestManualRefund(ctx, st, admin.ID, *sub.OrderID, 200, "INTERNAL-ONLY 客服协商保留已使用费用", at)
			if err != nil {
				t.Fatal(err)
			}
			if refund.Status != "processing" || !refund.Snapshot.ManualRefund || refund.AmountCents != 200 || refund.RefundCalculation.SpentPoints != 40 {
				t.Fatalf("manual refund=%+v", refund)
			}
			rollingBalance(t, st, u.ID, 0)
			w, err := store.GetWallet(ctx, st.Pool, u.ID)
			if err != nil || w.SubscriptionHeldCents != 60 || w.BalanceCents != 500 {
				t.Fatalf("manual hold=%+v %v", w, err)
			}
			if _, err := subscription.RequestManualRefund(ctx, st, admin.ID, *sub.OrderID, 200, "重复协商例外退款申请", at); err == nil {
				t.Fatal("accepted duplicate manual refund")
			}
			events, err := store.ListSubscriptionChangeEvents(ctx, st.Pool, refund.ID)
			if err != nil || len(events) != 1 || events[0].Action != "manual_approved" || events[0].ActorID == nil || *events[0].ActorID != admin.ID {
				t.Fatalf("missing manual audit: %+v %v", events, err)
			}
			if reject {
				if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "reject", "协商终止未向渠道退款", "", at); err != nil {
					t.Fatal(err)
				}
				rollingBalance(t, st, u.ID, 60)
				if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "人工驳回仍不能自助退款", at); err == nil {
					t.Fatal("manual rejection erased usage history")
				}
				return
			}
			if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "confirm_external_refund", "缺失真实退款流水不能确认", "", at); err == nil {
				t.Fatal("confirmed without provider reference")
			}
			if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "confirm_external_refund", "已核对模拟退款流水与金额", "manual-refund-test-reference", at); err != nil {
				t.Fatal(err)
			}
			if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "confirm_external_refund", "重复确认不应二次回收", "manual-refund-test-reference", at); err == nil {
				t.Fatal("confirmed twice")
			}
			current, err := store.GetSubscription(ctx, st.Pool, sub.ID)
			if err != nil || current.Status != "cancelled" {
				t.Fatalf("manual completion=%+v %v", current, err)
			}
			if balance(t, st, u.ID) != 500 {
				t.Fatal("manual refund changed topup credits")
			}
			var spent, revoked int64
			if err := st.Pool.QueryRow(ctx, `SELECT sum(spent_points),sum(revoked_points) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&spent, &revoked); err != nil || spent != 40 || revoked != 60 {
				t.Fatalf("manual accounting spent=%d revoked=%d %v", spent, revoked, err)
			}
		})
	}
}

func TestRefundRequestFreezesImmediatelyAndRejectionRestoresCredits(t *testing.T) {
	for _, approve := range []bool{false, true} {
		t.Run(fmt.Sprint(approve), func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			u := newUser(t, st)
			p := rollingPlan(t, st, 1, 100, 300)
			at := time.Now().UTC().Truncate(time.Second)
			sub := rollingSubscription(t, st, u, p, at)
			refund, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "购买错误申请退订退款", at)
			if err != nil {
				t.Fatal(err)
			}
			rollingBalance(t, st, u.ID, 0)
			w, err := store.GetWallet(ctx, st.Pool, u.ID)
			if err != nil || w.SubscriptionHeldCents != 100 {
				t.Fatalf("request hold=%+v %v", w, err)
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 1, "text_to_image", "test", "during-review", nil)
				return err
			}); err == nil {
				t.Fatal("spent credits held for review")
			}
			if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "重复提交申请退订退款", at); err == nil {
				t.Fatal("accepted duplicate request")
			}
			if err := subscription.Tick(ctx, st, at.Add(24*time.Hour)); err != nil {
				t.Fatal(err)
			}
			w, err = store.GetWallet(ctx, st.Pool, u.ID)
			if err != nil || w.SubscriptionHeldCents != 100 {
				t.Fatalf("grants continued during review: %+v %v", w, err)
			}
			admin, err := store.UpsertAdminAccount(ctx, st.Pool, "reject@example.com", "reviewer", "hash")
			if err != nil {
				t.Fatal(err)
			}
			if approve {
				if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "approve", "审核剩余服务可退款", "", at.Add(25*time.Hour)); err != nil {
					t.Fatal(err)
				}
				approved, err := store.GetSubscriptionChange(ctx, st.Pool, refund.ID, false)
				if err != nil || approved.AmountCents != 300 {
					t.Fatalf("review delay reduced refund: %+v %v", approved, err)
				}
			}
			var freezes int
			if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger WHERE source_type='subscription_refund_hold' AND source_id=$1 AND kind='freeze'`, refund.ID.String()).Scan(&freezes); err != nil || freezes != 1 {
				t.Fatalf("freeze ledger count=%d %v", freezes, err)
			}
			if err := subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "reject", "渠道尚未退款，恢复订阅权益", "", at); err != nil {
				t.Fatal(err)
			}
			if err := subscription.Tick(ctx, st, at.Add(24*time.Hour)); err != nil {
				t.Fatal(err)
			}
			rollingBalance(t, st, u.ID, 100)
			current, err := store.GetSubscription(ctx, st.Pool, sub.ID)
			if err != nil || current.Status != "active" {
				t.Fatalf("rejection did not restore subscription: %+v %v", current, err)
			}
		})
	}
}

func TestSubscriptionCollateralRejectsLegacySettlement(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	rollingSubscription(t, st, u, p, time.Now())
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 100, "text_to_image", "test", "protected", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE wallets SET frozen_cents=frozen_cents-100 WHERE user_id=$1`, u.ID)
		return err
	})
	if err == nil {
		t.Fatal("legacy settlement bypassed scoped allocation accounting")
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 100, "test", "protected", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	rollingBalance(t, st, u.ID, 100)
}

func TestClosedUpgradeClearsPendingChange(t *testing.T) {
	for _, status := range []string{"cancelled", "expired", "failed", "not_created"} {
		t.Run(status, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			u := newUser(t, st)
			base, target := rollingPlan(t, st, 1, 100, 300), rollingPlan(t, st, 2, 200, 600)
			at := time.Now().UTC()
			sub := rollingSubscription(t, st, u, base, at)
			quote, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
			if err != nil {
				t.Fatal(err)
			}
			order, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, quote.ID)
			if err != nil {
				t.Fatal(err)
			}
			if status == "not_created" {
				if _, err := store.PrepareOrderPayment(ctx, st.Pool, order.ID, "alipay"); err != nil {
					t.Fatal(err)
				}
				if _, err := store.ResolveUnboundOrderNotCreated(ctx, st.Pool, order.ID); err != nil {
					t.Fatal(err)
				}
			} else if changed, err := store.TransitionPendingOrderStatus(ctx, st.Pool, order.ID, status); err != nil || !changed {
				t.Fatalf("close: %v %v", changed, err)
			}
			change, err := store.GetSubscriptionChange(ctx, st.Pool, quote.ID, false)
			if err != nil || change.Status != "cancelled" {
				t.Fatalf("stale change: %+v %v", change, err)
			}
			rollingBalance(t, st, u.ID, 100)
		})
	}
}

func TestRollingFailureDoesNotBlockOtherSubscriptions(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	at := time.Now().UTC()
	bad, good, legacy := newUser(t, st), newUser(t, st), newUser(t, st)
	p := rollingPlan(t, st, 1, 100, 300)
	rollingSubscription(t, st, bad, p, at)
	rollingSubscription(t, st, good, p, at)
	oldPlan := newSubPlan(t, st, 3, 100)
	applyOrder(t, st, newOrder(t, st, legacy.ID, oldPlan), oldPlan, at)
	if _, err := st.Pool.Exec(ctx, `DELETE FROM wallets WHERE user_id=$1`, bad.ID); err != nil {
		t.Fatal(err)
	}
	if err := subscription.Tick(ctx, st, at.Add(24*time.Hour)); err == nil {
		t.Fatal("missing wallet failure was hidden")
	}
	rollingBalance(t, st, good.ID, 100)
	if balance(t, st, legacy.ID) != 200 {
		t.Fatal("rolling failure blocked legacy grants")
	}
}

func TestRefundWaitsOnlyForItsOwnSubscriptionReservations(t *testing.T) {
	for _, related := range []bool{true, false} {
		t.Run(fmt.Sprint(related), func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			u := newUser(t, st)
			p := rollingPlan(t, st, 1, 100, 300)
			p.SubscriptionPolicy.FeatureKeys = []string{"text_to_image"}
			if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
				t.Fatal(err)
			}
			at := time.Now().UTC()
			sub := rollingSubscription(t, st, u, p, at)
			feature := "text_to_image"
			if !related {
				feature = "ui_design"
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := wallet.Grant(ctx, tx, u.ID, 200, "grant", "test", "normal-funds", nil); err != nil {
					return err
				}
				_, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 50, feature, "test", "in-progress", nil)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			refund, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "测试部分冻结的退款审核", at)
			if related {
				if err == nil {
					t.Fatal("accepted refund before its task settled")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			admin, err := store.UpsertAdminAccount(ctx, st.Pool, "hold-admin@example.com", "reviewer", "hash")
			if err != nil {
				t.Fatal(err)
			}
			err = subscription.ReviewRefund(ctx, st, refund.ID, admin.ID, "approve", "内部检查冻结积分来源", "", at)
			if err != nil {
				t.Fatalf("unrelated normal task blocked refund: %v", err)
			}
		})
	}
}

func TestRestartUpgradeRefundDoesNotDoubleCountPastServicePayments(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	base, target := rollingPlan(t, st, 1, 100, 300), rollingPlan(t, st, 2, 1000, 3000)
	at := time.Now().UTC().Truncate(time.Second)
	start := at.Add(-48 * time.Hour)
	sub := rollingSubscription(t, st, u, base, start)
	if err := subscription.Tick(ctx, st, start.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	pastCtx := store.WithBillingTime(ctx, start.Add(24*time.Hour))
	if err := st.Tx(pastCtx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(pastCtx, tx, u.ID, 100, "text_to_image", "test", "previous-cycles", nil); err != nil {
			return err
		}
		_, err := wallet.SettleFeatureCredits(pastCtx, tx, u.ID, 100, "test", "previous-cycles", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	quote, err := subscription.QuoteUpgrade(ctx, st, u.ID, sub.ID, target.ID, at)
	if err != nil {
		t.Fatal(err)
	}
	if quote.AmountCents != 2900 {
		t.Fatalf("upgrade charge=%d", quote.AmountCents)
	}
	order, _, err := store.GetOrInsertUpgradeOrder(ctx, st, u.ID, quote.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := store.CompleteOrderUpdate(ctx, tx, order.ID, at); err != nil {
			return err
		}
		_, err := subscription.ApplyUpgrade(ctx, tx, order, at)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	sub, err = store.GetSubscription(ctx, st.Pool, sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	calculation, err := subscription.RefundCalculation(ctx, st.Pool, sub, at)
	if err != nil || calculation.PaidCents != 3200 || calculation.SpentPoints != 100 || calculation.TimeValueCents != 3000 || calculation.MaxRefundCents != 0 || calculation.Rule != "subscription_credits_used" || len(calculation.Payments) != 2 {
		t.Fatalf("upgrade refund was double-prorated: %+v %v", calculation, err)
	}
}
