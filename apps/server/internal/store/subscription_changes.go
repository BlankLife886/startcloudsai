package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrSubscriptionChangeInvalid = errors.New("subscription change quote is no longer valid")

type SubscriptionChangeSnapshot struct {
	Contract      *BillingContract           `json:"contract,omitempty"`
	SourcePlan    *SubscriptionSourcePlan    `json:"sourcePlan,omitempty"`
	UpgradeMode   string                     `json:"upgradeMode,omitempty"`
	UpgradeCredit *SubscriptionUpgradeCredit `json:"upgradeCredit,omitempty"`
	ManualRefund  bool                       `json:"manualRefund,omitempty"`
	PlanName      string                     `json:"planName"`
	Policy        SubscriptionPolicy         `json:"policy"`
	DailyPoints   int64                      `json:"dailyPoints"`
	DurationDays  int                        `json:"durationDays"`
	PriceCents    int64                      `json:"priceCents"`
	StartsAt      time.Time                  `json:"startsAt"`
	EndsAt        time.Time                  `json:"endsAt"`
}

type SubscriptionSourcePlan struct {
	Contract     *BillingContract   `json:"contract,omitempty"`
	Policy       SubscriptionPolicy `json:"policy"`
	PlanID       uuid.UUID          `json:"planId"`
	PlanName     string             `json:"planName"`
	PriceCents   int64              `json:"priceCents"`
	DailyPoints  int64              `json:"dailyPoints"`
	DurationDays int                `json:"durationDays"`
}

type SubscriptionUpgradeCredit struct {
	CalculatedAt     time.Time `json:"calculatedAt"`
	OldStartsAt      time.Time `json:"oldStartsAt"`
	OldEndsAt        time.Time `json:"oldEndsAt"`
	TimeValueCents   int64     `json:"timeValueCents"`
	UnusedValueCents int64     `json:"unusedValueCents"`
	CreditCents      int64     `json:"creditCents"`
	IssuedPoints     int64     `json:"issuedPoints"`
	SpentPoints      int64     `json:"spentPoints"`
	ReclaimPoints    int64     `json:"reclaimPoints"`
	FuturePoints     int64     `json:"futurePoints"`
}

func SubscriptionForPaidOrder(ctx context.Context, q Q, orderID uuid.UUID) (*Subscription, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `SELECT s.id FROM subscriptions s JOIN orders o ON (s.order_id=o.id OR s.id=(SELECT subscription_id FROM subscription_changes WHERE id=o.subscription_change_id AND kind='upgrade' AND status='completed')) WHERE o.id=$1 AND o.status='completed' AND s.user_id=o.user_id`, orderID).Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return GetSubscription(ctx, q, id)
}

type SubscriptionChange struct {
	PublicMessage        string                     `json:"publicMessage"`
	RequestedAmountCents *int64                     `json:"requestedAmountCents"`
	RefundCalculation    *RefundCalculation         `json:"refundCalculation"`
	UserEmail            string                     `json:"userEmail,omitempty"`
	Username             string                     `json:"username,omitempty"`
	ID                   uuid.UUID                  `json:"id"`
	UserID               uuid.UUID                  `json:"userId"`
	SubscriptionID       uuid.UUID                  `json:"subscriptionId"`
	Kind                 string                     `json:"kind"`
	Status               string                     `json:"status"`
	TargetPlanID         *uuid.UUID                 `json:"targetPlanId"`
	ExpectedRevision     int                        `json:"expectedRevision"`
	AmountCents          int64                      `json:"amountCents"`
	Snapshot             SubscriptionChangeSnapshot `json:"snapshot"`
	Reason               string                     `json:"reason"`
	ReviewNote           string                     `json:"reviewNote"`
	ProviderReference    *string                    `json:"providerReference"`
	ReviewedBy           *uuid.UUID                 `json:"reviewedBy"`
	CreatedAt            time.Time                  `json:"createdAt"`
	UpdatedAt            time.Time                  `json:"updatedAt"`
	ExpiresAt            *time.Time                 `json:"expiresAt"`
	CompletedAt          *time.Time                 `json:"completedAt"`
}

const subscriptionChangeCols = `id,user_id,subscription_id,kind,status,target_plan_id,expected_revision,amount_cents,snapshot,reason,review_note,provider_reference,reviewed_by,created_at,updated_at,expires_at,completed_at,public_message,requested_amount_cents,refund_calculation`

func scanSubscriptionChange(row interface{ Scan(...any) error }) (*SubscriptionChange, error) {
	var c SubscriptionChange
	err := row.Scan(&c.ID, &c.UserID, &c.SubscriptionID, &c.Kind, &c.Status, &c.TargetPlanID, &c.ExpectedRevision, &c.AmountCents, &c.Snapshot, &c.Reason, &c.ReviewNote, &c.ProviderReference, &c.ReviewedBy, &c.CreatedAt, &c.UpdatedAt, &c.ExpiresAt, &c.CompletedAt, &c.PublicMessage, &c.RequestedAmountCents, &c.RefundCalculation)
	return nilOnNoRows(&c, err)
}
func GetSubscriptionChange(ctx context.Context, q Q, id uuid.UUID, locked bool) (*SubscriptionChange, error) {
	sql := `SELECT ` + subscriptionChangeCols + ` FROM subscription_changes WHERE id=$1`
	if locked {
		sql += ` FOR UPDATE`
	}
	return scanSubscriptionChange(q.QueryRow(ctx, sql, id))
}
func InsertSubscriptionChange(ctx context.Context, q Q, c *SubscriptionChange) (*SubscriptionChange, error) {
	return scanSubscriptionChange(q.QueryRow(ctx, `INSERT INTO subscription_changes(user_id,subscription_id,kind,status,target_plan_id,expected_revision,amount_cents,snapshot,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING `+subscriptionChangeCols, c.UserID, c.SubscriptionID, c.Kind, c.Status, c.TargetPlanID, c.ExpectedRevision, c.AmountCents, c.Snapshot, c.Reason, c.ExpiresAt))
}
func ListSubscriptionChanges(ctx context.Context, q Q, userID *uuid.UUID) ([]*SubscriptionChange, error) {
	rows, err := q.Query(ctx, `SELECT `+subscriptionChangeCols+` FROM subscription_changes WHERE ($1::uuid IS NULL OR user_id=$1) AND (kind='refund' OR status<>'quoted') ORDER BY created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*SubscriptionChange{}
	for rows.Next() {
		c, err := scanSubscriptionChange(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func ListUserSubscriptions(ctx context.Context, q Q, userID uuid.UUID) ([]*Subscription, error) {
	rows, err := q.Query(ctx, `SELECT `+subscriptionCols+` FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Subscription{}
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Uses the same account lock as ordinary checkout; an upgrade is not a second subscription.
func GetOrInsertUpgradeOrder(ctx context.Context, st *Store, userID, changeID uuid.UUID, clock ...time.Time) (*Order, bool, error) {
	at := time.Now()
	if len(clock) > 0 {
		at = clock[0]
	}
	ctx = WithBillingTime(ctx, at)
	var out *Order
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, userID.String()); err != nil {
			return err
		}
		c, err := GetSubscriptionChange(ctx, tx, changeID, true)
		if err != nil {
			return err
		}
		if c == nil || c.UserID != userID || c.Kind != "upgrade" || c.TargetPlanID == nil {
			return ErrSubscriptionChangeInvalid
		}
		existing, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE subscription_change_id=$1`, changeID))
		if err == nil {
			out = existing
			return nil
		}
		if err != pgx.ErrNoRows {
			return err
		}
		if c.Status != "quoted" || c.ExpiresAt == nil || !c.ExpiresAt.After(at) {
			return ErrSubscriptionChangeInvalid
		}
		sub, err := GetSubscriptionForUpdate(ctx, tx, c.SubscriptionID)
		if err != nil {
			return err
		}
		if sub == nil || sub.Status != "active" || sub.Revision != c.ExpectedRevision || !sub.EndsAt.After(at) {
			return ErrSubscriptionChangeInvalid
		}
		pending, err := ListPendingOrdersForUser(ctx, tx, userID)
		if err != nil {
			return err
		}
		if len(pending) > 0 {
			return ErrUserUnsettledOrder
		}
		var refund bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=$1 AND kind='refund' AND status IN ('reviewing','processing'))`, sub.ID).Scan(&refund); err != nil {
			return err
		}
		if refund {
			return ErrSubscriptionChangeInvalid
		}
		if c.Snapshot.UpgradeMode == "restart" {
			credit := c.Snapshot.UpgradeCredit
			if credit == nil {
				return ErrSubscriptionChangeInvalid
			}
			var balance, issued, spent, available, frozen int64
			if err := tx.QueryRow(ctx, `SELECT balance_cents+trial_balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
				return err
			}
			if err := ExpireSubscriptionCredits(ctx, tx, userID, at); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(granted_points),0),COALESCE(sum(spent_points),0),COALESCE(sum(available_points) FILTER(WHERE NOT refund_hold AND NOT upgrade_hold),0),COALESCE(sum(frozen_points),0) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&issued, &spent, &available, &frozen); err != nil {
				return err
			}
			if issued != credit.IssuedPoints || spent != credit.SpentPoints || available != credit.ReclaimPoints || frozen != 0 {
				return ErrSubscriptionChangeInvalid
			}
			if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET upgrade_hold=true WHERE subscription_id=$1`, sub.ID); err != nil {
				return err
			}
			if available > 0 {
				source, reason := c.ID.String(), "升级整期置换待支付，锁定旧订阅积分"
				if _, err := InsertLedgerEntry(ctx, tx, userID, "freeze", -available, balance, "subscription_upgrade_exchange", &source, &reason, "subscription"); err != nil {
					return err
				}
			}
		}
		out, err = InsertOrder(ctx, tx, userID, *c.TargetPlanID, c.AmountCents, 0, 0, "lanjing")
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE orders SET subscription_change_id=$2,plan_name_snapshot=$3,plan_kind_snapshot='subscription',plan_duration_days_snapshot=$4,plan_daily_grant_snapshot=$5,subscription_policy_snapshot=$6 WHERE id=$1`, out.ID, c.ID, c.Snapshot.PlanName, c.Snapshot.DurationDays, c.Snapshot.DailyPoints, c.Snapshot.Policy)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE subscription_changes SET status='pending',updated_at=now() WHERE id=$1`, c.ID); err != nil {
			return err
		}
		out, err = GetOrder(ctx, tx, out.ID)
		created = err == nil
		return err
	})
	return out, created, err
}
