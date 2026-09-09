package wallet_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/jackc/pgx/v5"
)

func TestSettlementStatsUseFactsAndRecoverHistoricalReservations(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := newUser(t, st)
	grant(t, st, u.ID, 1000, "summary-funds")
	reason := "自定义备注：消耗冻结 99999 分"
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 100, "text_to_image", "custom_summary", "usage", nil); err != nil {
			return err
		}
		entry, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 40, "custom_summary", "usage", &reason)
		if err != nil {
			return err
		}
		if entry.SettledPoints == nil || *entry.SettledPoints != 40 {
			t.Fatalf("missing settlement fact: %+v", entry)
		}
		_, err = wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 60, "custom_summary", "usage", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		stats, err := store.UserWalletLedgerStats(ctx, st.Pool, u.ID)
		if err != nil || stats.ConsumedCents != 40 || stats.ConsumedCount != 1 || stats.RefundCents != 60 || stats.UnresolvedConsumedCount != 0 {
			t.Fatalf("summary=%+v %v", stats, err)
		}
		if w := getWallet(t, st, u.ID); w.BalanceCents != 960 {
			t.Fatalf("statistics changed balance: %+v", w)
		}
	}
	check()
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 100, "custom_summary", "usage", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check()
	data, err := os.ReadFile("../../migrations/00138_wallet_settled_points.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `ALTER TABLE wallet_ledger DROP COLUMN settled_points`); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, strings.Split(string(data), "-- +goose Down")[0])
		return err
	}); err != nil {
		t.Fatal(err)
	}
	check()
	source, unknownReason := "unknown-record", "历史记录缺少金额"
	if _, err := store.InsertLedgerEntry(ctx, st.Pool, u.ID, "spend", 0, 960, "historical_unknown", &source, &unknownReason, "normal"); err != nil {
		t.Fatal(err)
	}
	stats, err := store.UserWalletLedgerStats(ctx, st.Pool, u.ID)
	if err != nil || stats.ConsumedCents != 40 || stats.UnresolvedConsumedCount != 1 {
		t.Fatalf("invented unknown amount: %+v %v", stats, err)
	}
}
