package wallet

import (
	"context"
	"fmt"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

type subscriptionScopeKey struct{}
type subscriptionScope struct{ channel, model string }

// The channel is supplied by authenticated server entry points, never request JSON.
func WithSubscriptionScope(ctx context.Context, channel, model string) context.Context {
	previous, _ := ctx.Value(subscriptionScopeKey{}).(subscriptionScope)
	if channel == "" {
		channel = previous.channel
	}
	if channel == "" {
		channel = "web"
	}
	if model == "" {
		model = previous.model
	}
	return store.WithBillingChannel(context.WithValue(ctx, subscriptionScopeKey{}, subscriptionScope{channel, model}), channel)
}

func lockFundingWallet(ctx context.Context, q store.Q, userID uuid.UUID) (int64, error) {
	var frozen int64
	err := q.QueryRow(ctx, `SELECT frozen_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&frozen)
	return frozen, err
}

// Scoped credits are bridged into the existing reservation inside the same
// wallet-locked transaction, then returned to their original lots on release.
func reserveSubscriptionCredits(ctx context.Context, q store.Q, userID uuid.UUID, amount int64, feature, sourceType, sourceID string) (int64, error) {
	if amount <= 0 || feature == "" {
		return 0, nil
	}
	scope, _ := ctx.Value(subscriptionScopeKey{}).(subscriptionScope)
	if scope.channel == "" {
		scope.channel = "web"
	}
	remaining := amount
	rows, err := q.Query(ctx, `SELECT id,available_points,policy FROM subscription_credit_lots WHERE user_id=$1 AND available_points>0 AND NOT refund_hold AND NOT upgrade_hold AND (expires_at IS NULL OR expires_at>$2) ORDER BY granted_at,id FOR UPDATE`, userID, store.BillingTime(ctx))
	if err != nil {
		return 0, err
	}
	type lot struct {
		id        uuid.UUID
		available int64
		policy    store.SubscriptionPolicy
	}
	var lots []lot
	for rows.Next() {
		var l lot
		if err := rows.Scan(&l.id, &l.available, &l.policy); err != nil {
			rows.Close()
			return 0, err
		}
		lots = append(lots, l)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var reserved int64
	for _, l := range lots {
		if remaining == 0 {
			break
		}
		if !l.policy.Allows(feature, scope.channel, scope.model) {
			continue
		}
		points := min(remaining, l.available)
		if _, err := q.Exec(ctx, `UPDATE subscription_credit_lots SET available_points=available_points-$2,frozen_points=frozen_points+$2 WHERE id=$1`, l.id, points); err != nil {
			return 0, err
		}
		if _, err := q.Exec(ctx, `INSERT INTO subscription_credit_allocations(lot_id,source_type,source_id,remaining_points,allocated_points,accounting_version) VALUES($1,$2,$3,$4,$4,2)`, l.id, sourceType, sourceID, points); err != nil {
			return 0, err
		}
		reserved += points
		remaining -= points
	}
	if reserved > 0 {
		_, err = q.Exec(ctx, `UPDATE wallets SET balance_cents=balance_cents+$2 WHERE user_id=$1`, userID, reserved)
	}
	return reserved, err
}

func finishSubscriptionCredits(ctx context.Context, q store.Q, userID uuid.UUID, amount int64, sourceType, sourceID, operation string) (int64, int64, error) {
	rows, err := q.Query(ctx, `SELECT a.lot_id,a.remaining_points,l.expires_at FROM subscription_credit_allocations a JOIN subscription_credit_lots l ON l.id=a.lot_id WHERE a.source_type=$1 AND a.source_id=$2 AND l.user_id=$3 AND a.remaining_points>0 ORDER BY l.granted_at,l.id FOR UPDATE OF a,l`, sourceType, sourceID, userID)
	if err != nil {
		return 0, 0, err
	}
	type allocation struct {
		id      uuid.UUID
		points  int64
		expires *time.Time
	}
	var entries []allocation
	for rows.Next() {
		var a allocation
		if err := rows.Scan(&a.id, &a.points, &a.expires); err != nil {
			rows.Close()
			return 0, 0, err
		}
		entries = append(entries, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, 0, err
	}
	var used, expired int64
	for _, a := range entries {
		points := min(amount-used, a.points)
		if points <= 0 {
			break
		}
		allocationColumn := "settled_points"
		if operation == "release" {
			allocationColumn = "released_points"
			if a.expires != nil && !a.expires.After(store.BillingTime(ctx)) {
				allocationColumn = "expired_points"
			}
		}
		if _, err := q.Exec(ctx, `UPDATE subscription_credit_allocations SET remaining_points=remaining_points-$4,`+allocationColumn+`=`+allocationColumn+`+$4 WHERE source_type=$1 AND source_id=$2 AND lot_id=$3`, sourceType, sourceID, a.id, points); err != nil {
			return 0, 0, err
		}
		column := "spent_points"
		if operation == "release" {
			column = "available_points"
		}
		var expirePoints int64
		if operation == "release" && a.expires != nil && !a.expires.After(store.BillingTime(ctx)) {
			column = "revoked_points"
			expirePoints = points
			expired += points
		}
		if _, err := q.Exec(ctx, `UPDATE subscription_credit_lots SET frozen_points=frozen_points-$2,`+column+`=`+column+`+$2,expired_points=expired_points+$3 WHERE id=$1`, a.id, points, expirePoints); err != nil {
			return 0, 0, err
		}
		used += points
	}
	if used > 0 && operation == "release" {
		_, err = q.Exec(ctx, `UPDATE wallets SET balance_cents=balance_cents-$2 WHERE user_id=$1 AND balance_cents>=$2`, userID, used)
	}
	return used, expired, err
}

func fundedOperation(ctx context.Context, q store.Q, userID uuid.UUID, amount int64, feature, sourceType, sourceID, operation string, base func(context.Context) (*store.LedgerEntry, error)) (*store.LedgerEntry, error) {
	ctx = store.WithBillingTime(ctx, store.BillingTime(ctx))
	if _, err := q.Exec(ctx, `SELECT set_config('app.subscription_funding','v2',true)`); err != nil {
		return nil, err
	}
	before, err := lockFundingWallet(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	if err := store.ExpireSubscriptionCredits(ctx, q, userID, store.BillingTime(ctx)); err != nil {
		return nil, err
	}
	var used, expired int64
	decision := store.BillingDecisionFrom(ctx)
	if decision == nil {
		decision = &store.BillingDecision{Source: "public"}
		ctx = store.WithBillingDecision(ctx, decision)
	}
	if operation == "freeze" {
		existing, err := store.GetLedgerEntry(ctx, q, "freeze", sourceType, sourceID)
		if err != nil || existing != nil {
			return existing, err
		}
		used, err = reserveSubscriptionCredits(ctx, q, userID, amount, feature, sourceType, sourceID)
		if err != nil {
			return nil, err
		}
		decision.SubscriptionPoints = used
	}
	if operation == "spend" {
		if err := q.QueryRow(ctx, `SELECT COALESCE(sum(remaining_points),0) FROM subscription_credit_allocations WHERE source_type=$1 AND source_id=$2`, sourceType, sourceID).Scan(&decision.SubscriptionPoints); err != nil {
			return nil, err
		}
	}
	entry, err := base(ctx)
	if err != nil || entry == nil {
		return entry, err
	}
	if operation == "freeze" {
		after, err := lockFundingWallet(ctx, q, userID)
		if err != nil {
			return nil, err
		}
		general := max(after-before-used, 0)
		topup, err := store.ReserveTopupCredits(ctx, q, userID, general, sourceType, sourceID, decision.Source == "subscription_contract")
		if err != nil {
			return nil, err
		}
		decision.TopupPoints = topup
		decision.OtherPoints = general - topup
		decision.TrialPoints = max(amount-(after-before), 0)
		if err := store.SaveBillingDecision(ctx, q, userID, sourceType, sourceID, decision); err != nil {
			return nil, err
		}
	}
	if operation != "freeze" {
		after, err := lockFundingWallet(ctx, q, userID)
		if err != nil {
			return nil, err
		}
		if before > after {
			used, expired, err = finishSubscriptionCredits(ctx, q, userID, before-after, sourceType, sourceID, operation)
			if err != nil {
				return nil, err
			}
			if _, err := store.FinishTopupCredits(ctx, q, userID, max(before-after-used, 0), sourceType, sourceID, operation); err != nil {
				return nil, err
			}
		}
	}
	if operation == "spend" && entry.SettledPoints != nil {
		if _, err := q.Exec(ctx, `UPDATE billing_decisions SET settled_points=GREATEST(settled_points,$3) WHERE source_type=$1 AND source_id=$2`, sourceType, sourceID, *entry.SettledPoints); err != nil {
			return nil, err
		}
	}
	if expired > 0 {
		reason := fmt.Sprintf("任务冻结已释放，其中 %d 旧周期订阅积分已过期，不计入当前可用额度", expired)
		if _, err := q.Exec(ctx, `UPDATE wallet_ledger SET delta_cents=delta_cents-$2,balance_after_cents=balance_after_cents-$2,reason=$3 WHERE id=$1`, entry.ID, expired, reason); err != nil {
			return nil, err
		}
		entry.DeltaCents -= expired
		entry.BalanceAfterCents -= expired
		entry.Reason = &reason
		var balance int64
		if err := q.QueryRow(ctx, `SELECT balance_cents+trial_balance_cents FROM wallets WHERE user_id=$1`, userID).Scan(&balance); err != nil {
			return nil, err
		}
		source := entry.ID.String()
		if _, err := store.InsertLedgerEntry(ctx, q, userID, "spend", 0, balance, "subscription_cycle_expiry", &source, &reason, "subscription"); err != nil {
			return nil, err
		}
	}
	if used > 0 {
		bucket := "mixed"
		if used == amount {
			bucket = "subscription"
		}
		if _, err := q.Exec(ctx, `UPDATE wallet_ledger SET credit_bucket=$2 WHERE id=$1`, entry.ID, bucket); err != nil {
			return nil, err
		}
		entry.CreditBucket = bucket
	}
	return entry, nil
}

func FreezeForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amount int64, feature string, reason *string) (*store.LedgerEntry, error) {
	if _, err := lockFundingWallet(ctx, q, userID); err != nil {
		return nil, err
	}
	gen, err := store.CountTaskCreditReservations(ctx, q, taskID)
	if err != nil {
		return nil, err
	}
	return fundedOperation(ctx, q, userID, amount, feature, "task", taskSourceID(taskID, gen), "freeze", func(ctx context.Context) (*store.LedgerEntry, error) {
		return freezeForTaskBase(ctx, q, userID, taskID, amount, feature, reason)
	})
}
func ReleaseForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amount int64, reason *string) (*store.LedgerEntry, error) {
	if _, err := lockFundingWallet(ctx, q, userID); err != nil {
		return nil, err
	}
	gen, err := store.CountTaskLedger(ctx, q, taskID, "release")
	if err != nil {
		return nil, err
	}
	return fundedOperation(ctx, q, userID, amount, "", "task", taskSourceID(taskID, gen), "release", func(ctx context.Context) (*store.LedgerEntry, error) {
		return releaseForTaskBase(ctx, q, userID, taskID, amount, reason)
	})
}
func SettleForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amount int64, reason *string) (*store.LedgerEntry, error) {
	if _, err := lockFundingWallet(ctx, q, userID); err != nil {
		return nil, err
	}
	count, err := store.CountTaskCreditReservations(ctx, q, taskID)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, fmt.Errorf("task has no reservation")
	}
	return fundedOperation(ctx, q, userID, amount, "", "task", taskSourceID(taskID, count-1), "spend", func(ctx context.Context) (*store.LedgerEntry, error) {
		return settleForTaskBase(ctx, q, userID, taskID, amount, reason)
	})
}
func FreezeFeatureCredits(ctx context.Context, q store.Q, userID uuid.UUID, amount int64, feature, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amount <= 0 {
		return nil, nil
	}
	return fundedOperation(ctx, q, userID, amount, feature, sourceType, sourceID, "freeze", func(ctx context.Context) (*store.LedgerEntry, error) {
		return freezeFeatureCreditsBase(ctx, q, userID, amount, feature, sourceType, sourceID, reason)
	})
}
func ReleaseFeatureCredits(ctx context.Context, q store.Q, userID uuid.UUID, amount int64, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amount <= 0 {
		return nil, nil
	}
	return fundedOperation(ctx, q, userID, amount, "", sourceType, sourceID, "release", func(ctx context.Context) (*store.LedgerEntry, error) {
		return releaseFeatureCreditsBase(ctx, q, userID, amount, sourceType, sourceID, reason)
	})
}
func SettleFeatureCredits(ctx context.Context, q store.Q, userID uuid.UUID, amount int64, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amount <= 0 {
		return nil, nil
	}
	return fundedOperation(ctx, q, userID, amount, "", sourceType, sourceID, "spend", func(ctx context.Context) (*store.LedgerEntry, error) {
		return settleFeatureCreditsBase(ctx, q, userID, amount, sourceType, sourceID, reason)
	})
}
