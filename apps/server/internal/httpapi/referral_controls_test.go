package httpapi

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestReferralCookieTamperingExpiryAndPurpose(t *testing.T) {
	now := time.Unix(1800000000, 0)
	code := "A1B2C3D4E5F60708"
	secret := "test-only-attribution-secret"
	token := signReferralCookie(code, secret, now.Add(time.Hour))
	got, expires := readReferralCookie(token, secret, now)
	if got != code || !expires.Equal(now.Add(time.Hour)) {
		t.Fatal("valid attribution not recovered")
	}
	for _, value := range []string{"", token + "x", strings.Repeat("x", 300), signReferralCookie(code, "other", now.Add(time.Hour)), signReferralCookie(code, secret, now), signReferralCookie(code, secret, now.Add(31*24*time.Hour))} {
		if got, _ := readReferralCookie(value, secret, now); got != "" {
			t.Fatalf("accepted invalid token %q", value)
		}
	}
}

func saveReferralControls(t *testing.T, st *store.Store, cfg referral.Config) {
	t.Helper()
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(context.Background(), st.Pool, "referral_config", raw); err != nil {
		t.Fatal(err)
	}
}

func enableReferralFeatureForTest(t *testing.T, st *store.Store) {
	t.Helper()
	saveReferralControls(t, st, referral.Config{Enabled: true, SettlementPaused: false, Mode: "percent", Percent: 10, FixedPoints: 10, MinimumAmountCents: 100, DailyLimitPoints: 1000})
}

func TestReferralDailyCapSerializesDifferentFriends(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	inviter, _ := makeOrder(t, st)
	code, err := referral.Code(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	saveReferralControls(t, st, referral.Config{Enabled: true, Mode: "percent", Percent: 10, FixedPoints: 10, DailyLimitPoints: 150})
	orders := []*store.Order{}
	for i := 0; i < 3; i++ {
		friend, order := makeOrder(t, st)
		if err := referral.BindNewAccount(ctx, st.Pool, friend.ID, code); err != nil {
			t.Fatal(err)
		}
		orders = append(orders, prepareLanjingOrder(t, st, order, uuid.NewString(), 990, "alipay"))
	}
	s := &Server{St: st, Cfg: config.Load()}
	var wg sync.WaitGroup
	for _, order := range orders {
		wg.Add(1)
		go func(order *store.Order) {
			defer wg.Done()
			if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
				t.Error(err)
			}
		}(order)
	}
	wg.Wait()
	balance, err := store.GetWallet(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if balance.BalanceCents != 0 {
		t.Fatalf("accrual funded wallet early: %d", balance.BalanceCents)
	}
	var count int
	var total int64
	if err := st.Pool.QueryRow(ctx, `SELECT count(*),sum(reward_points) FROM referral_rewards WHERE inviter_id=$1`, inviter.ID).Scan(&count, &total); err != nil || count != 3 || total != 150 {
		t.Fatalf("decisions=%d points=%d err=%v", count, total, err)
	}
	settleAllReferralRewards(t, st)
	balance, _ = store.GetWallet(ctx, st.Pool, inviter.ID)
	if balance.BalanceCents != 150 {
		t.Fatal("monthly credit must honor accrual-day cap")
	}
}

func TestReferralMinimumAndFirstRewardPolicies(t *testing.T) {
	st := testdb.Setup(t)
	enableReferralFeatureForTest(t, st)
	ctx := context.Background()
	inviter, _ := makeOrder(t, st)
	friend, order := makeOrder(t, st)
	code, err := referral.Code(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := referral.BindNewAccount(ctx, st.Pool, friend.ID, code); err != nil {
		t.Fatal(err)
	}
	saveReferralControls(t, st, referral.Config{Enabled: true, Mode: "fixed", Percent: 10, FixedPoints: 10, MinimumAmountCents: 1000, FirstRewardOnly: true})
	s := &Server{St: st, Cfg: config.Load()}
	order = prepareLanjingOrder(t, st, order, "under-minimum", 990, "alipay")
	if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	var decision string
	if err := st.Pool.QueryRow(ctx, `SELECT decision_reason FROM referral_rewards WHERE order_id=$1`, order.ID).Scan(&decision); err != nil || decision != "below_minimum" {
		t.Fatalf("minimum decision %s %v", decision, err)
	}
	saveReferralControls(t, st, referral.Config{Enabled: true, Mode: "fixed", Percent: 10, FixedPoints: 10, FirstRewardOnly: true})
	for i := 0; i < 2; i++ {
		next, err := store.InsertOrder(ctx, st.Pool, friend.ID, order.PlanID, 990, 1000, 200, "lanjing")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.completeVerifiedOrder(ctx, next); err != nil {
			t.Fatal(err)
		}
	}
	settleAllReferralRewards(t, st)
	balance, err := store.GetWallet(ctx, st.Pool, inviter.ID)
	if err != nil || balance.BalanceCents != 10 {
		t.Fatalf("first reward only failed: %+v %v", balance, err)
	}
}

func TestReferralRecoveryPendingRetryAndIdempotency(t *testing.T) {
	st := testdb.Setup(t)
	enableReferralFeatureForTest(t, st)
	ctx := context.Background()
	inviter, _ := makeOrder(t, st)
	friend, order := makeOrder(t, st)
	code, err := referral.Code(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := referral.BindNewAccount(ctx, st.Pool, friend.ID, code); err != nil {
		t.Fatal(err)
	}
	order = prepareLanjingOrder(t, st, order, "recover-reward", 990, "alipay")
	s := &Server{St: st, Cfg: config.Load()}
	if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	settleAllReferralRewards(t, st)
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "referral-admin@example.com", "admin", "test-password-hash")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.AdminAdjust(ctx, tx, inviter.ID, -100, "referral-test-spend", "test spend")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	reverse := func() string {
		t.Helper()
		var result string
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			var err error
			result, err = referral.Reverse(ctx, tx, order.ID, admin.ID, "已核实该笔奖励应追回")
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return result
	}
	if got := reverse(); got != "recovery_pending" {
		t.Fatalf("expected pending got %s", got)
	}
	next, err := store.InsertOrder(ctx, st.Pool, friend.ID, order.PlanID, 990, 1000, 200, "lanjing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.completeVerifiedOrder(ctx, next); err != nil {
		t.Fatal(err)
	}
	var decision string
	if err := st.Pool.QueryRow(ctx, `SELECT decision_reason FROM referral_rewards WHERE order_id=$1`, next.ID).Scan(&decision); err != nil || decision != "pending_recovery" {
		t.Fatalf("new rewards not paused: %s %v", decision, err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, inviter.ID, 100, "grant", "test", "restore-balance", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if got := reverse(); got != "reversed" {
		t.Fatalf("expected recovered got %s", got)
	}
	if got := reverse(); got != "reversed" {
		t.Fatalf("repeat mismatch %s", got)
	}
	balance, err := store.GetWallet(ctx, st.Pool, inviter.ID)
	if err != nil || balance.BalanceCents != 0 {
		t.Fatalf("recovery balance %+v %v", balance, err)
	}
	var count int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger WHERE source_id=$1`, "referral-reversal/"+order.ID.String()).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate debit %d %v", count, err)
	}
}
