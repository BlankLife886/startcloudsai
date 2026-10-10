// 账务核心：冻结不超余额、幂等入账、settle/release。
package wallet_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

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

func activeTrialCampaign(t *testing.T, st *store.Store) *store.TrialCampaign {
	t.Helper()
	item, err := store.GetActiveTrialCampaign(context.Background(), st.Pool)
	if err != nil || item == nil {
		t.Fatalf("active trial campaign = %#v err=%v", item, err)
	}
	return item
}

func ensureTrialEntitlements(t *testing.T, st *store.Store, userID uuid.UUID, featureKeys []string) *store.TrialAccessApplication {
	t.Helper()
	ctx := context.Background()
	campaign := activeTrialCampaign(t, st)
	application, err := store.GetTrialAccessApplicationByUserAndCampaign(ctx, st.Pool, userID, campaign.ID)
	if err != nil {
		t.Fatal(err)
	}
	if application == nil {
		application, err = store.InsertTrialAccessApplication(
			ctx, st.Pool, userID, campaign.ID, 1, featureKeys,
			"测试用户", "验证活动体验积分的冻结、结算与退回逻辑。",
		)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, featureKey := range featureKeys {
		if err := store.GrantTrialFeatureEntitlement(ctx, st.Pool, userID, featureKey, application.ID, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
	}
	return application
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

func grantTrial(t *testing.T, st *store.Store, userID uuid.UUID, amount int64, sourceID string) *store.LedgerEntry {
	t.Helper()
	ensureTrialEntitlements(t, st, userID, []string{"text_to_image"})
	var entry *store.LedgerEntry
	err := inTx(t, st, func(tx pgx.Tx) error {
		var grantErr error
		entry, grantErr = wallet.GrantTrial(
			context.Background(), tx, userID, amount, "text_to_image", "trial_access", sourceID, nil,
		)
		return grantErr
	})
	if err != nil {
		t.Fatalf("grant trial: %v", err)
	}
	return entry
}

func newTaskID(t *testing.T, st *store.Store, userID uuid.UUID, cost int64) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := store.InsertTask(context.Background(), st.Pool, store.NewTask{
		ID: id, UserID: userID, Type: "t2i", Model: "test-model", Prompt: "test",
		Count: 1, CostCents: cost, WorkUnits: 1,
	})
	if err != nil {
		t.Fatalf("insert task: %v", err)
	}
	return id
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

	t1 := newTaskID(t, st, user.ID, 20)
	t2 := newTaskID(t, st, user.ID, 20)
	err := inTx(t, st, func(tx pgx.Tx) error {
		if _, ferr := wallet.FreezeForTask(ctx, tx, user.ID, t1, 20, "text_to_image", nil); ferr != nil {
			return ferr
		}
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, t2, 20, "text_to_image", nil)
		return ferr
	})
	if err != nil {
		t.Fatalf("freeze: %v", err)
	}

	t3 := newTaskID(t, st, user.ID, 20)
	err = inTx(t, st, func(tx pgx.Tx) error {
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, t3, 20, "text_to_image", nil)
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

	taskID := newTaskID(t, st, user.ID, 40)
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 40, "text_to_image", nil)
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

	taskID := newTaskID(t, st, user.ID, 30)
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, ferr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 30, "text_to_image", nil)
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

func TestFreezeUsesTrialCreditsFirstAndSettlesExactBuckets(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, "normal")
	grantTrial(t, st, user.ID, 50, "trial")
	taskID := newTaskID(t, st, user.ID, 80)

	if err := inTx(t, st, func(tx pgx.Tx) error {
		entry, freezeErr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 80, "text_to_image", nil)
		if freezeErr == nil && entry.CreditBucket != "mixed" {
			t.Fatalf("freeze bucket = %q, want mixed", entry.CreditBucket)
		}
		return freezeErr
	}); err != nil {
		t.Fatalf("freeze: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 70 || w.TrialBalanceCents != 0 || w.FrozenCents != 30 || w.TrialFrozenCents != 50 {
		t.Fatalf("wallet after freeze = %#v", w)
	}

	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, settleErr := wallet.SettleForTask(ctx, tx, user.ID, taskID, 80, nil)
		return settleErr
	}); err != nil {
		t.Fatalf("settle: %v", err)
	}
	w = getWallet(t, st, user.ID)
	if w.BalanceCents != 70 || w.TrialBalanceCents != 0 || w.FrozenCents != 0 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet after settle = %#v", w)
	}
}

func TestMixedFreezeFailureRefundReturnsOriginalBuckets(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, "normal-refund")
	grantTrial(t, st, user.ID, 50, "trial-refund")
	taskID := newTaskID(t, st, user.ID, 80)

	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, freezeErr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 80, "text_to_image", nil)
		return freezeErr
	}); err != nil {
		t.Fatalf("freeze: %v", err)
	}
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, releaseErr := wallet.ReleaseForTask(ctx, tx, user.ID, taskID, 80, nil)
		return releaseErr
	}); err != nil {
		t.Fatalf("release: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.TrialBalanceCents != 50 || w.FrozenCents != 0 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet after refund = %#v", w)
	}
}

func TestMixedFreezePartialDeliveryConsumesTrialFirstAndRefundsRemainder(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, "normal-partial")
	grantTrial(t, st, user.ID, 50, "trial-partial")
	taskID := newTaskID(t, st, user.ID, 80)

	if err := inTx(t, st, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 80, "text_to_image", nil); err != nil {
			return err
		}
		if _, err := wallet.SettleForTask(ctx, tx, user.ID, taskID, 60, nil); err != nil {
			return err
		}
		_, err := wallet.ReleaseForTask(ctx, tx, user.ID, taskID, 20, nil)
		return err
	}); err != nil {
		t.Fatalf("partial settle: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 90 || w.TrialBalanceCents != 0 || w.FrozenCents != 0 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet after partial delivery = %#v", w)
	}
}

func TestConcurrentMixedReservationsRefundToCorrectBuckets(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, "normal-concurrent")
	grantTrial(t, st, user.ID, 50, "trial-concurrent")
	taskIDs := []uuid.UUID{
		newTaskID(t, st, user.ID, 40),
		newTaskID(t, st, user.ID, 40),
	}

	runConcurrent := func(action func(pgx.Tx, uuid.UUID) error) {
		t.Helper()
		var wg sync.WaitGroup
		errs := make(chan error, len(taskIDs))
		for _, taskID := range taskIDs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs <- st.Tx(ctx, func(tx pgx.Tx) error { return action(tx, taskID) })
			}()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatalf("concurrent wallet action: %v", err)
			}
		}
	}

	runConcurrent(func(tx pgx.Tx, taskID uuid.UUID) error {
		_, err := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 40, "text_to_image", nil)
		return err
	})
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 70 || w.TrialBalanceCents != 0 || w.FrozenCents != 30 || w.TrialFrozenCents != 50 {
		t.Fatalf("wallet after concurrent freeze = %#v", w)
	}

	runConcurrent(func(tx pgx.Tx, taskID uuid.UUID) error {
		_, err := wallet.ReleaseForTask(ctx, tx, user.ID, taskID, 40, nil)
		return err
	})
	w = getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.TrialBalanceCents != 50 || w.FrozenCents != 0 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet after concurrent refund = %#v", w)
	}
}

func TestTrialCreditsAreOnlyUsedByTheirBoundFeature(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 100, "normal-feature-bound")
	grantTrial(t, st, user.ID, 50, "trial-feature-bound")
	taskID := newTaskID(t, st, user.ID, 80)

	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, err := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 80, "ui_design", nil)
		return err
	}); err != nil {
		t.Fatalf("freeze non-matching feature: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 20 || w.TrialBalanceCents != 50 || w.FrozenCents != 80 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet after non-matching freeze = %#v", w)
	}
	reservation, err := store.GetActiveTaskCreditReservationForUpdate(ctx, st.Pool, taskID)
	if err != nil || reservation == nil || reservation.TrialCents != 0 || reservation.TrialFeatureKey != nil {
		t.Fatalf("reservation = %#v err=%v", reservation, err)
	}
}

func TestTrialCreditsCanBeUsedAcrossApprovedFeatures(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grantTrial(t, st, user.ID, 50, "trial-multi-feature")
	ensureTrialEntitlements(t, st, user.ID, []string{"text_to_image", "ui_design"})
	taskID := newTaskID(t, st, user.ID, 40)
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, freezeErr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 40, "ui_design", nil)
		return freezeErr
	}); err != nil {
		t.Fatalf("freeze approved secondary feature: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.TrialBalanceCents != 10 || w.TrialFrozenCents != 40 {
		t.Fatalf("wallet after secondary feature freeze = %#v", w)
	}
}

func TestTrialCreditsCanAccumulateAcrossCampaignRounds(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grantTrial(t, st, user.ID, 50, "trial-first-round")

	secondCampaignID := uuid.New()
	if _, err := st.Pool.Exec(ctx,
		`INSERT INTO trial_campaigns (id, title, feature_keys, access_mode, capacity, status)
		 VALUES ($1, '第二期体验活动', ARRAY['ui_design'], 'credit_only', 100, 'draft')`,
		secondCampaignID,
	); err != nil {
		t.Fatal(err)
	}
	if err := inTx(t, st, func(tx pgx.Tx) error {
		if err := store.LockTrialCampaignLifecycle(ctx, tx); err != nil {
			return err
		}
		_, err := store.ActivateTrialCampaign(ctx, tx, secondCampaignID, time.Now().UTC())
		return err
	}); err != nil {
		t.Fatalf("activate second campaign: %v", err)
	}
	application, err := store.InsertTrialAccessApplication(
		ctx, st.Pool, user.ID, secondCampaignID, 1, []string{"ui_design"},
		"产品设计师", "验证跨期体验积分能够继续积累并按新一期权限使用。",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.GrantTrialFeatureEntitlement(ctx, st.Pool, user.ID, "ui_design", application.ID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, err := wallet.GrantTrial(ctx, tx, user.ID, 30, "ui_design", "trial_access", "trial-second-round", nil)
		return err
	}); err != nil {
		t.Fatalf("grant second campaign credits: %v", err)
	}

	taskID := newTaskID(t, st, user.ID, 60)
	if err := inTx(t, st, func(tx pgx.Tx) error {
		_, err := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 60, "ui_design", nil)
		return err
	}); err != nil {
		t.Fatalf("freeze second campaign credits: %v", err)
	}
	w := getWallet(t, st, user.ID)
	if w.TrialBalanceCents != 20 || w.TrialFrozenCents != 60 || w.TrialFeatureKey == nil || *w.TrialFeatureKey != "ui_design" {
		t.Fatalf("wallet after cross-round grant/freeze = %#v", w)
	}
}

func TestNonMatchingTrialCreditsDoNotCoverNormalBalanceShortfall(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grant(t, st, user.ID, 30, "normal-shortfall")
	grantTrial(t, st, user.ID, 50, "trial-shortfall")
	taskID := newTaskID(t, st, user.ID, 40)

	err := inTx(t, st, func(tx pgx.Tx) error {
		_, freezeErr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 40, "ui_design", nil)
		return freezeErr
	})
	mustAppErr(t, err, "trial_credit_feature_mismatch")
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 30 || w.TrialBalanceCents != 50 || w.FrozenCents != 0 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet changed after rejected freeze = %#v", w)
	}
}

func TestExpiredCampaignDisablesTrialCreditUsage(t *testing.T) {
	st := testdb.Setup(t)
	user := newUser(t, st)
	ctx := context.Background()
	grantTrial(t, st, user.ID, 50, "trial-expired-campaign")
	campaign := activeTrialCampaign(t, st)
	expiredAt := time.Now().UTC().Add(-time.Minute)
	if _, err := st.Pool.Exec(ctx,
		`UPDATE trial_campaigns SET created_at = $3, expires_at = $2 WHERE id = $1`,
		campaign.ID, expiredAt, expiredAt.Add(-time.Hour),
	); err != nil {
		t.Fatal(err)
	}
	taskID := newTaskID(t, st, user.ID, 40)
	err := inTx(t, st, func(tx pgx.Tx) error {
		_, freezeErr := wallet.FreezeForTask(ctx, tx, user.ID, taskID, 40, "text_to_image", nil)
		return freezeErr
	})
	mustAppErr(t, err, "trial_credit_feature_mismatch")
	w := getWallet(t, st, user.ID)
	if w.TrialBalanceCents != 50 || w.TrialFrozenCents != 0 {
		t.Fatalf("expired campaign wallet changed = %#v", w)
	}
}
