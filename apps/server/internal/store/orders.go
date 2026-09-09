package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrOrderPlanChanged = errors.New("plan changed during checkout")
var ErrUserUnsettledOrder = errors.New("user already has an unsettled order for another plan")
var ErrAlreadySubscribed = errors.New("user already has an active subscription")

const orderCols = `id, user_id, plan_id, amount_cents, grant_cents, bonus_cents, status, provider,
	provider_order_id, provider_pay_amount_cents, payment_method, provider_pay_url, requires_manual_amount,
	provider_expires_at, paid_at, completed_at, created_at,
	plan_name_snapshot, plan_kind_snapshot, plan_duration_days_snapshot, plan_daily_grant_snapshot, subscription_ends_at,
	reconcile_attempts, reconcile_lease_id, subscription_starts_at,subscription_policy_snapshot,subscription_change_id,price_lock_eligible_snapshot,plan_revision_snapshot,recharge_policy_snapshot`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.UserID, &o.PlanID, &o.AmountCents, &o.GrantCents, &o.BonusCents, &o.Status,
		&o.Provider, &o.ProviderOrderID, &o.ProviderPayAmountCents, &o.PaymentMethod,
		&o.ProviderPayURL, &o.RequiresManualAmount, &o.ProviderExpiresAt,
		&o.PaidAt, &o.CompletedAt, &o.CreatedAt,
		&o.PlanName, &o.PlanKind, &o.PlanDurationDays, &o.PlanDailyGrantCents, &o.SubscriptionEndsAt, &o.ReconcileAttempts, &o.ReconcileLeaseID, &o.SubscriptionStartsAt, &o.SubscriptionPolicy, &o.SubscriptionChangeID, &o.PriceLockEligible, &o.PlanRevision, &o.RechargePolicy)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func GetOrInsertPendingOrder(ctx context.Context, st *Store, userID, planID uuid.UUID, amountCents, grantCents, bonusCents int64, provider string, clock ...time.Time) (*Order, bool, error) {
	return getOrInsertPendingOrder(ctx, st, userID, planID, amountCents, grantCents, bonusCents, provider, nil, clock...)
}

func GetOrInsertPendingOrderAtRevision(ctx context.Context, st *Store, userID, planID uuid.UUID, amountCents, grantCents, bonusCents int64, provider string, revision int, clock ...time.Time) (*Order, bool, error) {
	return getOrInsertPendingOrder(ctx, st, userID, planID, amountCents, grantCents, bonusCents, provider, &revision, clock...)
}

func getOrInsertPendingOrder(ctx context.Context, st *Store, userID, planID uuid.UUID, amountCents, grantCents, bonusCents int64, provider string, revision *int, clock ...time.Time) (*Order, bool, error) {
	at := time.Now()
	if len(clock) > 0 {
		at = clock[0]
	}
	var order *Order
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		// Serialize all checkouts for this user, including different plans.
		lockKey := userID.String()
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			return err
		}
		existing, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM orders
			WHERE user_id = $1 AND status IN ('pending','uncertain','paid')
			ORDER BY (plan_id <> $2) DESC, created_at DESC LIMIT 1`, userID, planID))
		if err == nil {
			if existing.PlanID != planID || existing.RechargePolicy != nil {
				return ErrUserUnsettledOrder
			}
			order = existing
			return nil
		}
		if err != pgx.ErrNoRows {
			return err
		}
		var currentAmount, currentGrant, currentBonus int64
		var active bool
		var kind string
		var currentRevision int
		if err := tx.QueryRow(ctx, `SELECT price_cents, grant_cents, bonus_cents, active,kind,revision FROM plans WHERE id=$1 FOR SHARE`, planID).
			Scan(&currentAmount, &currentGrant, &currentBonus, &active, &kind, &currentRevision); err != nil {
			return err
		}
		if !active || currentAmount != amountCents || currentGrant != grantCents || currentBonus != bonusCents || (revision != nil && currentRevision != *revision) {
			return ErrOrderPlanChanged
		}
		if kind == "subscription" {
			exists, err := HasBlockingSubscription(ctx, tx, userID, at)
			if err != nil {
				return err
			}
			if exists {
				return ErrAlreadySubscribed
			}
		}
		order, err = InsertOrder(ctx, tx, userID, planID, amountCents, grantCents, bonusCents, provider)
		if err == nil {
			created = true
		}
		return err
	})
	return order, created, err
}

func InsertOrder(ctx context.Context, q Q, userID, planID uuid.UUID, amountCents, grantCents, bonusCents int64, provider string) (*Order, error) {
	return scanOrder(q.QueryRow(ctx,
		`INSERT INTO orders (user_id, plan_id, amount_cents, grant_cents, bonus_cents, provider,
		 plan_name_snapshot, plan_kind_snapshot, plan_duration_days_snapshot, plan_daily_grant_snapshot,subscription_policy_snapshot,price_lock_eligible_snapshot,plan_revision_snapshot)
		 SELECT $1, id, $3, $4, $5, $6, name, kind, duration_days, daily_grant_cents,subscription_policy,price_lock_eligible,revision FROM plans WHERE id=$2 RETURNING `+orderCols,
		userID, planID, amountCents, grantCents, bonusCents, provider))
}

func GetOrder(ctx context.Context, q Q, id uuid.UUID) (*Order, error) {
	o, err := scanOrder(q.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1`, id))
	return nilOnNoRows(o, err)
}

func GetUserOrder(ctx context.Context, q Q, userID, id uuid.UUID) (*Order, error) {
	o, err := scanOrder(q.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(o, err)
}

func ListPendingOrdersForUser(ctx context.Context, q Q, userID uuid.UUID) ([]*Order, error) {
	rows, err := q.Query(ctx, `SELECT `+orderCols+` FROM orders
		WHERE user_id = $1 AND status IN ('pending','uncertain','paid')
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	orders := make([]*Order, 0)
	for rows.Next() {
		order, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	return orders, rows.Err()
}

func SetOrderProviderDetails(ctx context.Context, q Q, id uuid.UUID, providerOrderID string, payAmountCents int64,
	paymentMethod, payURL string, requiresManualAmount bool, expiresAt *time.Time,
) (*Order, error) {
	return scanOrder(q.QueryRow(ctx,
		`UPDATE orders SET provider_order_id = $2, provider_pay_amount_cents = $3, payment_method = $4,
			provider_pay_url = $5, requires_manual_amount = $6, provider_expires_at = $7,
			status = CASE WHEN status='uncertain' THEN 'pending' ELSE status END, reconcile_after=now(),
			reconcile_lease_id=NULL,reconcile_lease_until=NULL
		 WHERE id = $1 AND (provider_order_id IS NULL OR provider_order_id=$2)
		 AND (provider_pay_amount_cents IS NULL OR provider_pay_amount_cents=$3)
		 AND (payment_method IS NULL OR payment_method=$4) RETURNING `+orderCols,
		id, providerOrderID, payAmountCents, paymentMethod, payURL, requiresManualAmount, expiresAt))
}

func UpdateOrderPaymentDisplay(ctx context.Context, q Q, id uuid.UUID, payURL string, requiresManualAmount bool, expiresAt *time.Time) (*Order, error) {
	return scanOrder(q.QueryRow(ctx,
		`UPDATE orders SET
			provider_pay_url = CASE WHEN btrim($2) <> '' THEN $2 ELSE provider_pay_url END,
			requires_manual_amount = $3,
			provider_expires_at = COALESCE($4, provider_expires_at)
		 WHERE id = $1 RETURNING `+orderCols,
		id, payURL, requiresManualAmount, expiresAt))
}

func TransitionPendingOrderStatus(ctx context.Context, q Q, id uuid.UUID, status string) (bool, error) {
	if status != "failed" && status != "expired" && status != "cancelled" {
		return false, fmt.Errorf("unsupported pending order transition: %s", status)
	}
	var changed bool
	err := q.QueryRow(ctx, `WITH closed AS (
 UPDATE orders SET status=$2 WHERE id=$1 AND status IN ('pending','uncertain') RETURNING subscription_change_id
), changed_quotes AS (
 UPDATE subscription_changes SET status='cancelled',updated_at=now()
 WHERE id IN (SELECT subscription_change_id FROM closed) AND kind='upgrade' AND status='pending'
) SELECT EXISTS(SELECT 1 FROM closed)`, id, status).Scan(&changed)
	return changed, err
}

// CompleteOrderUpdate 条件更新 pending/paid/expired → completed，返回是否抢到。
// expired 也允许由签名回调或主动对账恢复，避免关闭与支付回调竞态导致漏发权益。
func CompleteOrderUpdate(ctx context.Context, q Q, id uuid.UUID, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE orders SET status = 'completed', completed_at = $2, paid_at = COALESCE(paid_at, $2)
		 WHERE id = $1 AND status IN ('pending', 'paid', 'expired')`, id, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListOrders 订单分页（limit+1 行）。userID 为 nil 时查全站（后台）。
func ListOrders(ctx context.Context, q Q, userID *uuid.UUID, status string, userIDs []uuid.UUID, limit int, cursor *Cursor) ([]*Order, error) {
	return listOrders(ctx, q, userID, status, userIDs, "", limit, cursor)
}

func SearchUserOrders(ctx context.Context, q Q, userID uuid.UUID, status, query string, limit int, cursor *Cursor) ([]*Order, error) {
	return listOrders(ctx, q, &userID, status, nil, query, limit, cursor)
}

func listOrders(ctx context.Context, q Q, userID *uuid.UUID, status string, userIDs []uuid.UUID, query string, limit int, cursor *Cursor) ([]*Order, error) {
	sql := `SELECT ` + orderCols + ` FROM orders WHERE ` + orderVisibleSQL("orders")
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	if userIDs != nil {
		args = append(args, userIDs)
		sql += fmt.Sprintf(` AND user_id = ANY($%d)`, len(args))
	}
	if query != "" {
		args = append(args, query)
		i := len(args)
		sql += fmt.Sprintf(` AND (strpos(lower(id::text),lower($%d))>0
		 OR strpos(lower(COALESCE(provider_order_id,'')),lower($%d))>0
		 OR strpos(lower(COALESCE(plan_name_snapshot,(SELECT name FROM plans WHERE plans.id=orders.plan_id),'')),lower($%d))>0)`, i, i, i)
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

type OrderSummary struct {
	Total     int64 `json:"total"`
	Pending   int64 `json:"pending"`
	Paid      int64 `json:"paid"`
	Completed int64 `json:"completed"`
	Expired   int64 `json:"expired"`
	Cancelled int64 `json:"cancelled"`
	Failed    int64 `json:"failed"`
	Uncertain int64 `json:"uncertain"`
}

func GetUserOrderSummary(ctx context.Context, q Q, userID uuid.UUID) (*OrderSummary, error) {
	var summary OrderSummary
	err := q.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE status='pending'),
	 count(*) FILTER (WHERE status='paid'), count(*) FILTER (WHERE status='completed'),
	 count(*) FILTER (WHERE status='expired'), count(*) FILTER (WHERE status='failed'), count(*) FILTER (WHERE status='uncertain'), count(*) FILTER (WHERE status='cancelled')
	 FROM orders WHERE user_id=$1 AND `+orderVisibleSQL("orders"), userID).Scan(&summary.Total, &summary.Pending, &summary.Paid, &summary.Completed, &summary.Expired, &summary.Failed, &summary.Uncertain, &summary.Cancelled)
	return &summary, err
}

func SetOrderSubscriptionPeriod(ctx context.Context, q Q, id uuid.UUID, startsAt, endsAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE orders SET subscription_starts_at=$2,subscription_ends_at=$3 WHERE id=$1`, id, startsAt, endsAt)
	return err
}

// RevenueSince 近 N 日已完成订单收入合计（按下单时间）。
func RevenueSince(ctx context.Context, q Q, since time.Time) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT COALESCE(SUM(COALESCE(provider_pay_amount_cents, amount_cents)), 0)
		 FROM orders WHERE status = 'completed' AND created_at >= $1`, since).Scan(&n)
	return n, err
}

// RevenueDailySince 已完成订单按天收入（UTC 日期 → 分，按下单时间）。
func RevenueDailySince(ctx context.Context, q Q, since time.Time) (map[string]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
		 COALESCE(SUM(COALESCE(provider_pay_amount_cents, amount_cents)), 0)
		 FROM orders WHERE status = 'completed' AND created_at >= $1 GROUP BY day`, since)
	if err != nil {
		return nil, err
	}
	return scanDailyCents(rows)
}

// CountOrdersByUser 用户订单总数。
func CountOrdersByUser(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM orders WHERE user_id = $1 AND `+orderVisibleSQL("orders"), userID).Scan(&n)
	return n, err
}

// ListOrdersForReconciliation returns recent Lanjing orders that can carry
// money. Failed create-order attempts without a provider ID are excluded.
func ListOrdersForReconciliation(ctx context.Context, q Q, since time.Time, limit int) ([]*Order, error) {
	rows, err := q.Query(ctx, `SELECT `+orderCols+` FROM orders
		WHERE provider='lanjing' AND provider_order_id IS NOT NULL AND created_at >= $1
		ORDER BY created_at DESC LIMIT $2`, since, min(max(limit, 1), 500))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*Order{}
	for rows.Next() {
		item, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
