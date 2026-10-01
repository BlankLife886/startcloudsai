package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type CreditLotFilter struct {
	UserID        uuid.UUID
	Bucket, State string
}
type UserCreditLot struct {
	ID              uuid.UUID  `json:"id"`
	Bucket          string     `json:"bucket"`
	Name            string     `json:"name"`
	OrderID         *uuid.UUID `json:"orderId"`
	SubscriptionID  *uuid.UUID `json:"subscriptionId"`
	GrantedPoints   int64      `json:"grantedPoints"`
	AvailablePoints int64      `json:"availablePoints"`
	FrozenPoints    int64      `json:"frozenPoints"`
	HeldPoints      int64      `json:"heldPoints"`
	SpentPoints     int64      `json:"spentPoints"`
	ExpiredPoints   int64      `json:"expiredPoints"`
	RevokedPoints   int64      `json:"revokedPoints"`
	// APISpentPoints is the part of SpentPoints paid for developer API calls.
	APISpentPoints    int64           `json:"apiSpentPoints"`
	HoldReason        string          `json:"holdReason"`
	PriceLockEligible bool            `json:"priceLockEligible"`
	Policy            json.RawMessage `json:"policy"`
	RechargePolicy    *RechargePolicy `json:"rechargePolicy"`
	ExpiresAt         *time.Time      `json:"expiresAt"`
	CreatedAt         time.Time       `json:"createdAt"`
}
type CreditLotSummary struct {
	Total     int64 `json:"total"`
	Available int64 `json:"availablePoints"`
	Frozen    int64 `json:"frozenPoints"`
	Held      int64 `json:"heldPoints"`
	Spent     int64 `json:"spentPoints"`
	Expired   int64 `json:"expiredPoints"`
	Revoked   int64 `json:"revokedPoints"`
	APISpent  int64 `json:"apiSpent"` // settled points paid for developer API calls
}

const userCreditLotsCTE = `WITH lots AS(
 SELECT l.id,'topup' AS bucket,l.plan_name AS name,l.order_id,NULL::uuid AS subscription_id,l.granted_points,l.available_points,l.frozen_points,0::bigint AS held_points,l.spent_points,0::bigint AS expired_points,0::bigint AS revoked_points,'' AS hold_reason,l.price_lock_eligible,NULL::jsonb AS policy,o.recharge_policy_snapshot,NULL::timestamptz AS expires_at,l.created_at
 FROM topup_credit_lots l JOIN orders o ON o.id=l.order_id WHERE l.user_id=$1
 UNION ALL
 SELECT l.id,'subscription',COALESCE(o.plan_name_snapshot,'历史订阅积分'),l.order_id,l.subscription_id,l.granted_points,
 CASE WHEN l.refund_hold OR l.upgrade_hold THEN 0 ELSE l.available_points END,l.frozen_points,
 CASE WHEN l.refund_hold OR l.upgrade_hold THEN l.available_points ELSE 0 END,l.spent_points,l.expired_points,l.revoked_points-l.expired_points,
 CASE WHEN l.refund_hold THEN 'refund' WHEN l.upgrade_hold THEN 'upgrade' ELSE '' END,false,l.policy,NULL::jsonb,l.expires_at,l.granted_at
 FROM subscription_credit_lots l LEFT JOIN orders o ON o.id=l.order_id WHERE l.user_id=$1
), selected AS (SELECT * FROM lots WHERE ($2='' OR bucket=$2) AND
 ($3='' OR ($3='available' AND available_points>0) OR ($3='frozen' AND frozen_points>0) OR ($3='held' AND held_points>0)
 OR ($3='spent' AND spent_points>0) OR ($3='expired' AND expired_points>0) OR ($3='revoked' AND revoked_points>0))) `

func ListUserCreditLots(ctx context.Context, q Q, f CreditLotFilter, page, size int) ([]UserCreditLot, CreditLotSummary, error) {
	args := []any{f.UserID, f.Bucket, f.State}
	s := CreditLotSummary{}
	err := q.QueryRow(ctx, userCreditLotsCTE+`SELECT count(*),COALESCE(sum(available_points),0),COALESCE(sum(frozen_points),0),COALESCE(sum(held_points),0),COALESCE(sum(spent_points),0),COALESCE(sum(expired_points),0),COALESCE(sum(revoked_points),0) FROM selected`, args...).Scan(&s.Total, &s.Available, &s.Frozen, &s.Held, &s.Spent, &s.Expired, &s.Revoked)
	if err != nil {
		return nil, s, err
	}
	rows, err := q.Query(ctx, userCreditLotsCTE+`SELECT id,bucket,name,order_id,subscription_id,granted_points,available_points,frozen_points,held_points,spent_points,expired_points,revoked_points,hold_reason,price_lock_eligible,policy,recharge_policy_snapshot,expires_at,created_at FROM selected ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`, append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, s, err
	}
	defer rows.Close()
	items := []UserCreditLot{}
	for rows.Next() {
		var l UserCreditLot
		if err := rows.Scan(&l.ID, &l.Bucket, &l.Name, &l.OrderID, &l.SubscriptionID, &l.GrantedPoints, &l.AvailablePoints, &l.FrozenPoints, &l.HeldPoints, &l.SpentPoints, &l.ExpiredPoints, &l.RevokedPoints, &l.HoldReason, &l.PriceLockEligible, &l.Policy, &l.RechargePolicy, &l.ExpiresAt, &l.CreatedAt); err != nil {
			return nil, s, err
		}
		items = append(items, l)
	}
	if err := rows.Err(); err != nil {
		return nil, s, err
	}
	rows.Close()
	if err := q.QueryRow(ctx, userCreditLotsCTE+`SELECT COALESCE(sum(a.settled_points),0) FROM selected JOIN (`+creditAllocationsUnion+`) a ON a.lot_id=selected.id WHERE a.source_type = ANY($4)`, append(args, developerAPILedgerSources)...).Scan(&s.APISpent); err != nil {
		return nil, s, err
	}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	spent, err := APISpentByLot(ctx, q, ids)
	if err != nil {
		return nil, s, err
	}
	for index := range items {
		items[index].APISpentPoints = spent[items[index].ID]
	}
	return items, s, nil
}

type UserSubscriptionBenefit struct {
	*Subscription
	Available, Frozen, Held, Spent, Expired int64
	NextReset                               *time.Time
	Changing                                bool
}

func ListUserSubscriptionBenefits(ctx context.Context, q Q, userID uuid.UUID, page, size int) ([]UserSubscriptionBenefit, int64, error) {
	var total int64
	if err := q.QueryRow(ctx, `SELECT count(*) FROM subscriptions WHERE user_id=$1`, userID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx, `SELECT `+subscriptionCols+`,
 (SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE subscription_id=s.id AND NOT refund_hold AND NOT upgrade_hold),
 (SELECT COALESCE(sum(frozen_points),0) FROM subscription_credit_lots WHERE subscription_id=s.id),
 (SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE subscription_id=s.id AND (refund_hold OR upgrade_hold)),
 (SELECT COALESCE(sum(spent_points),0) FROM subscription_credit_lots WHERE subscription_id=s.id),
 (SELECT COALESCE(sum(expired_points),0) FROM subscription_credit_lots WHERE subscription_id=s.id),
 (SELECT min(next_grant_at) FROM subscription_periods WHERE subscription_id=s.id AND closed_at IS NULL AND granted_count<total_grants),
 EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=s.id AND status IN ('pending','reviewing','processing'))
 FROM subscriptions s WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, userID, size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []UserSubscriptionBenefit{}
	for rows.Next() {
		var b UserSubscriptionBenefit
		b.Subscription, err = scanSubscription(accountingRow{rows, []any{&b.Available, &b.Frozen, &b.Held, &b.Spent, &b.Expired, &b.NextReset, &b.Changing}})
		if err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, rows.Err()
}

func ListSubscriptionChangesForSubscription(ctx context.Context, q Q, id uuid.UUID, limit int) ([]*SubscriptionChange, error) {
	rows, err := q.Query(ctx, `SELECT `+subscriptionChangeCols+` FROM subscription_changes WHERE subscription_id=$1 AND (kind='refund' OR status<>'quoted') ORDER BY created_at DESC,id DESC LIMIT $2`, id, limit)
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

// creditAllocationsUnion lists settled spending per credit lot of both kinds.
const creditAllocationsUnion = `SELECT lot_id,source_type,settled_points FROM subscription_credit_allocations
	UNION ALL SELECT lot_id,source_type,settled_points FROM topup_credit_allocations`

// APISpentByLot returns, per credit lot, the settled points paid for
// developer API calls.
func APISpentByLot(ctx context.Context, q Q, lotIDs []uuid.UUID) (map[uuid.UUID]int64, error) {
	spent := map[uuid.UUID]int64{}
	if len(lotIDs) == 0 {
		return spent, nil
	}
	rows, err := q.Query(ctx, `SELECT lot_id,sum(settled_points) FROM (`+creditAllocationsUnion+`) a
		WHERE lot_id = ANY($1) AND source_type = ANY($2) GROUP BY lot_id`, lotIDs, developerAPILedgerSources)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var points int64
		if err := rows.Scan(&id, &points); err != nil {
			return nil, err
		}
		spent[id] = points
	}
	return spent, rows.Err()
}

// OrderAPISpentPoints is how much of an order's credits (top-up or
// subscription lots bought by it) developer API calls have used.
func OrderAPISpentPoints(ctx context.Context, q Q, orderID uuid.UUID) (int64, error) {
	var points int64
	err := q.QueryRow(ctx, `SELECT COALESCE(sum(a.settled_points),0) FROM (`+creditAllocationsUnion+`) a
		WHERE a.source_type = ANY($2) AND a.lot_id IN (
			SELECT id FROM topup_credit_lots WHERE order_id=$1 UNION ALL SELECT id FROM subscription_credit_lots WHERE order_id=$1)`,
		orderID, developerAPILedgerSources).Scan(&points)
	return points, err
}

// UserAPISpend totals a user's charged developer API calls since from.
func UserAPISpend(ctx context.Context, q Q, userID uuid.UUID, from time.Time) (points, calls int64, err error) {
	err = q.QueryRow(ctx, `SELECT COALESCE(sum(price_cents),0),count(*) FROM developer_api_billing_requests
		WHERE user_id=$1 AND status='succeeded' AND created_at >= $2`, userID, from).Scan(&points, &calls)
	return points, calls, err
}
