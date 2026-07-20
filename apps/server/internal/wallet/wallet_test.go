// 账务核心：冻结不超余额、幂等入账、settle/release。
package wallet_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func newUser(t *testing.T, st *store.Store) *store.User {
	t.Helper()
	ctx := context.Background()
	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	user, err := store.InsertUser(ctx, st.Pool, email, "tester", "x", "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	return user
}

func getWallet(t *testing.T, st *store.Store, userID uuid.UUID) *store.Wallet {
	t.Helper()
	w, err := store.GetWallet(context.Background(), st.Pool, userID)
	if err != nil || w == nil {
		t.Fatalf("get wallet: %v", err)
	}
	return w
}

func inTx(t *testing.T, st *store.Store, fn func(tx pgx.Tx) error) error {
	t.Helper()
	return st.Tx(context.Background(), fn)
}

func mustAppErr(t *testing.T, err error, code string) {
	t.Helper()
	e, isApp := apperr.As(err)
	if !isApp {
		t.Fatalf("expected apperr %q, got %v", code, err)
	}
	if e.Code != code {
		t.Fatalf("expected code %q, got %q (%s)", code, e.Code, e.Message)
	}
}

func ledgerCount(t *testing.T, st *store.Store, userID uuid.UUID, kind string) int {
	t.Helper()
	var n int
	sql := `SELECT count(*) FROM wallet_ledger WHERE user_id = $1`
	args := []any{userID}
	if kind != "" {
		sql += ` AND kind = $2`
		args = append(args, kind)
	}
	if err := st.Pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count ledger: %v", err)
	}
	return n
}

func grant(t *testing.T, st *store.Store, userID uuid.UUID, amount int64, sourceID string) *store.LedgerEntry {
	t.Helper()
	var entry *store.LedgerEntry
	err := inTx(t, st, func(tx pgx.Tx) error {
		var gerr error
		entry, gerr = wallet.Grant(context.Background(), tx, userID, amount, "grant", "signup_bonus", sourceID, nil)
		return gerr
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	return entry
}

func TestGrantIdempotentReplay(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)

	entry1 := grant(t, st, user.ID, 100, user.ID.String())
	entry2 := grant(t, st, user.ID, 100, user.ID.String())

	if entry1.ID != entry2.ID {
		t.Fatalf("replay should return the existing entry, got %s vs %s", entry1.ID, entry2.ID)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 {
		t.Fatalf("balance = %d, want 100", w.BalanceCents)
	}
	if n := ledgerCount(t, st, user.ID, ""); n != 1 {
		t.Fatalf("ledger count = %d, want 1", n)
	}
}

func TestSequentialFreezeCannotExceedBalance(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 50, user.ID.String())

	t1, t2 := uuid.New(), uuid.New()
	err := inTx(t, st, func(tx pgx.Tx) error {
		if _, ferr := wallet.FreezeForTask(ctx, tx, user.ID, t1, 20, nil); ferr != nil {
			return ferr
		}
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, t2, 20, nil)
		return ferr
	})
	if err != nil {
		t.Fatalf("freeze: %v", err)
	}

	err = inTx(t, st, func(tx pgx.Tx) error {
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, uuid.New(), 20, nil)
		return ferr
	})
	mustAppErr(t, err, "insufficient_balance")

	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 10 || w.FrozenCents != 40 {
		t.Fatalf("wallet = (%d, %d), want (10, 40)", w.BalanceCents, w.FrozenCents)
	}
}

func TestSettleConsumesFrozenAndIsIdempotent(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, user.ID.String())

	taskID := uuid.New()
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 40, nil)
		return ferr
	}); err != nil {
		t.Fatalf("freeze: %v", err)
	}

	var entry1, entry2 *store.LedgerEntry
	for _, target := range []**store.LedgerEntry{&entry1, &entry2} {
		if err := inTx(t, st, func(tx pgx.Tx) error {
			var serr error
			*target, serr = wallet.SettleForTask(ctx, tx, user.ID, taskID, 40, nil)
			return serr
		}); err != nil {
			t.Fatalf("settle: %v", err)
		}
	}

	if entry1.ID != entry2.ID {
		t.Fatalf("settle replay should return existing entry")
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 60 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (60, 0)", w.BalanceCents, w.FrozenCents)
	}
	if n := ledgerCount(t, st, user.ID, "spend"); n != 1 {
		t.Fatalf("spend count = %d, want 1", n)
	}
}

func TestReleaseReturnsFundsAndIsIdempotent(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, user.ID.String())

	taskID := uuid.New()
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 30, nil)
		return ferr
	}); err != nil {
		t.Fatalf("freeze: %v", err)
	}

	var replay *store.LedgerEntry
	for range 2 {
		if err := inTx(t, st, func(tx pgx.Tx) error {
			var rerr error
			replay, rerr = wallet.ReleaseForTask(ctx, tx, user.ID, taskID, 30, nil)
			return rerr
		}); err != nil {
			t.Fatalf("release: %v", err)
		}
	}

	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0)", w.BalanceCents, w.FrozenCents)
	}
	if replay.Kind != "release" {
		t.Fatalf("replay kind = %s, want release", replay.Kind)
	}
	if n := ledgerCount(t, st, user.ID, "release"); n != 1 {
		t.Fatalf("release count = %d, want 1", n)
	}
}

func TestAdminAdjustNegativeRequiresBalance(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 30, user.ID.String())

	err := inTx(t, st, func(tx pgx.Tx) error {
		_, aerr := wallet.AdminAdjust(ctx, tx, user.ID, -50, uuid.NewString(), "扣减测试")
		return aerr
	})
	mustAppErr(t, err, "insufficient_balance")

	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, aerr := wallet.AdminAdjust(ctx, tx, user.ID, -20, uuid.NewString(), "扣减测试")
		return aerr
	}); err != nil {
		t.Fatalf("adjust: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 10 {
		t.Fatalf("balance = %d, want 10", w.BalanceCents)
	}
}
