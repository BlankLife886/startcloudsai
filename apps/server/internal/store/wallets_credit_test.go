package store_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestGetPlatformCreditTotals(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(
		ctx, st.Pool, fmt.Sprintf("credit-%s@test.dev", uuid.NewString()[:8]), "credit-user", "x", "user", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE wallets
		SET balance_cents = 80, trial_balance_cents = 20, frozen_cents = 15, trial_frozen_cents = 5
		WHERE user_id = $1`, user.ID); err != nil {
		t.Fatal(err)
	}

	insertCreditLedger(t, st, user.ID, "grant", "daily_checkin", 100, "签到奖励")
	insertCreditLedger(t, st, user.ID, "grant", "order", 200, "订单入账")
	insertCreditLedger(t, st, user.ID, "spend", "task", 0, "任务结算：消耗冻结 40 分")
	insertCreditLedger(t, st, user.ID, "admin_adjust", "admin", -10, "人工扣减")
	insertCreditLedger(t, st, user.ID, "release", "task", 12, "任务失败解冻")

	totals, err := store.GetPlatformCreditTotals(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	if totals.IncomeCents != 300 || totals.ConsumedCents != 50 || totals.RefundCents != 12 {
		t.Fatalf("ledger totals = %#v", totals)
	}
	if totals.RemainingCents != 100 || totals.FrozenCents != 20 {
		t.Fatalf("wallet totals = %#v", totals)
	}
}

func insertCreditLedger(t *testing.T, st *store.Store, userID uuid.UUID, kind, sourceType string, delta int64, reason string) {
	t.Helper()
	if _, err := st.Pool.Exec(context.Background(),
		`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, reason)
		 VALUES ($1, $2, $3, 0, $4, $5, $6)`,
		userID, kind, delta, sourceType, uuid.NewString(), reason); err != nil {
		t.Fatal(err)
	}
}
