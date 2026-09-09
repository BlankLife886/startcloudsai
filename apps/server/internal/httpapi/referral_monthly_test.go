package httpapi

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/jackc/pgx/v5"
)

func settleAllReferralRewards(t *testing.T, st *store.Store) {
	t.Helper()
	movePendingReferralsToClosedMonth(t, st)
	if _, err := referral.SettleDue(context.Background(), st); err != nil {
		t.Fatal(err)
	}
}

// This helper only operates on testdb.Setup's disposable database. Production
// settlement has no caller-supplied clock; tests age their accrual fixtures instead.
func movePendingReferralsToClosedMonth(t *testing.T, st *store.Store) {
	t.Helper()
	if _, err := st.Pool.Exec(context.Background(), `UPDATE referral_rewards
 SET created_at=(date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Shanghai')-interval '1 month'+interval '1 day') AT TIME ZONE 'Asia/Shanghai'
 WHERE status='pending_settlement'`); err != nil {
		t.Fatal(err)
	}
}

func TestReferralMonthBoundary(t *testing.T) {
	for _, sample := range []struct{ input, want string }{
		{"2026-09-30T15:59:59Z", "2026-09-30T16:05:00Z"},
		{"2026-09-30T16:00:00Z", "2026-10-31T16:05:00Z"},
		{"2028-02-29T15:59:59Z", "2028-02-29T16:05:00Z"},
		{"2026-12-31T15:59:59Z", "2026-12-31T16:05:00Z"},
	} {
		at, _ := time.Parse(time.RFC3339, sample.input)
		if got := referral.SettlementDueAt(at).Format(time.RFC3339); got != sample.want {
			t.Fatalf("%s -> %s want %s", sample.input, got, sample.want)
		}
	}
}

func TestReferralMonthlySettlementNotEarlyAndConcurrent(t *testing.T) {
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
	order = prepareLanjingOrder(t, st, order, "monthly", 990, "alipay")
	s := &Server{St: st, Cfg: config.Load()}
	if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	var due, created time.Time
	if err := st.Pool.QueryRow(ctx, `SELECT settlement_due_at,created_at FROM referral_rewards WHERE order_id=$1`, order.ID).Scan(&due, &created); err != nil {
		t.Fatal(err)
	}
	if !due.Equal(referral.SettlementDueAt(created)) {
		t.Fatal("SQL and Go month boundary differ")
	}
	if count, err := referral.SettleDue(ctx, st); err != nil || count != 0 {
		t.Fatalf("early payment: %d %v", count, err)
	}
	// Closing the campaign or changing its price cannot erase an already earned accrual.
	saveReferralControls(t, st, referral.Config{Enabled: false, Mode: "fixed", Percent: 99, FixedPoints: 999})
	movePendingReferralsToClosedMonth(t, st)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := referral.SettleDue(ctx, st); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	balance, err := store.GetWallet(ctx, st.Pool, inviter.ID)
	if err != nil || balance.BalanceCents != 100 {
		t.Fatalf("monthly balance %+v %v", balance, err)
	}
	var batches int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM referral_settlements WHERE inviter_id=$1`, inviter.ID).Scan(&batches); err != nil || batches != 1 {
		t.Fatalf("duplicate batches: %d %v", batches, err)
	}
}

func TestReferralUnsettledCancellationDoesNotDebit(t *testing.T) {
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
	order = prepareLanjingOrder(t, st, order, "void-monthly", 990, "alipay")
	s := &Server{St: st, Cfg: config.Load()}
	if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "monthly-admin@example.com", "admin", "test-only-hash")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		state, err := referral.ReverseWithExpected(ctx, tx, order.ID, admin.ID, "核实取消此笔待结算奖励", "pending_settlement")
		if err == nil && state != "voided" {
			t.Fatalf("got %s", state)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	settleAllReferralRewards(t, st)
	balance, err := store.GetWallet(ctx, st.Pool, inviter.ID)
	if err != nil || balance.BalanceCents != 0 {
		t.Fatalf("canceled accrual changed balance %+v %v", balance, err)
	}
	var entries int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger WHERE user_id=$1`, inviter.ID).Scan(&entries); err != nil || entries != 0 {
		t.Fatalf("unexpected ledger entries %d %v", entries, err)
	}
}
