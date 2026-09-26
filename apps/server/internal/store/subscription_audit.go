package store

import (
	"context"
	"encoding/json"
	"fmt"
)

type SubscriptionAuditCredits struct {
	Granted          int64  `json:"granted"`
	Available        int64  `json:"available"`
	Frozen           int64  `json:"frozen"`
	Held             int64  `json:"held"`
	Spent            int64  `json:"spent"`
	Expired          int64  `json:"expired"`
	UpgradeReclaimed int64  `json:"upgradeReclaimed"`
	RefundReclaimed  int64  `json:"refundReclaimed"`
	CurrentSpent     *int64 `json:"currentSpent"`
	PriorSpent       *int64 `json:"priorSpent"`
}

func GetSubscriptionAuditCredits(ctx context.Context, q Q, sub *Subscription) (SubscriptionAuditCredits, error) {
	c := SubscriptionAuditCredits{}
	var current, unknown int64
	err := q.QueryRow(ctx, `SELECT COALESCE(sum(granted_points),0),COALESCE(sum(available_points) FILTER(WHERE NOT refund_hold AND NOT upgrade_hold),0),
 COALESCE(sum(frozen_points),0),COALESCE(sum(available_points) FILTER(WHERE refund_hold OR upgrade_hold),0),COALESCE(sum(spent_points),0),
 COALESCE(sum(expired_points),0),COALESCE(sum(upgrade_revoked_points),0),COALESCE(sum(revoked_points-upgrade_revoked_points-expired_points),0),
 COALESCE(sum(spent_points) FILTER(WHERE EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id AND p.starts_at>=$2)),0),
 COALESCE(sum(spent_points) FILTER(WHERE NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id)),0)
 FROM subscription_credit_lots l WHERE subscription_id=$1`, sub.ID, sub.StartsAt).Scan(&c.Granted, &c.Available, &c.Frozen, &c.Held, &c.Spent, &c.Expired, &c.UpgradeReclaimed, &c.RefundReclaimed, &current, &unknown)
	if err == nil && sub.BillingVersion == 2 && unknown == 0 {
		prior := c.Spent - current
		c.CurrentSpent = &current
		c.PriorSpent = &prior
	}
	return c, err
}

type SubscriptionAuditPage struct {
	Items []json.RawMessage `json:"items"`
	Total int               `json:"total"`
	Page  int               `json:"page"`
	Limit int               `json:"limit"`
}

const subscriptionAuditScope = `WITH audit_scope AS(SELECT $1::uuid AS user_id,$2::uuid AS subscription_id,$3::uuid AS original_order_id,$4::timestamptz AS starts_at),
 related_orders AS(SELECT o.* FROM orders o,audit_scope s WHERE o.user_id=s.user_id AND (o.id=s.original_order_id
 OR EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=s.subscription_id AND p.order_id=o.id)
 OR EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=s.subscription_id AND c.id=o.subscription_change_id)))`

// Each source has independent pagination; no capped history is presented as a complete chain.
func ListSubscriptionAuditPage(ctx context.Context, q Q, sub *Subscription, section string, page int) (SubscriptionAuditPage, error) {
	result := SubscriptionAuditPage{Items: []json.RawMessage{}, Page: page, Limit: 20}
	var records string
	switch section {
	case "payments":
		records = `SELECT o.created_at AS at,o.id::text AS key,jsonb_build_object(
   'id',o.id,'kind',CASE WHEN o.subscription_change_id IS NULL THEN 'subscription' ELSE 'upgrade' END,'status',o.status,
   'planName',o.plan_name_snapshot,'sourcePlanName',c.snapshot->'sourcePlan'->>'planName','revision',o.plan_revision_snapshot,
   'amountCents',o.amount_cents,'receivedCents',CASE WHEN o.status IN ('paid','completed') THEN COALESCE(o.provider_pay_amount_cents,o.amount_cents) ELSE 0 END,
   'receiptConfirmed',o.status IN ('paid','completed'),'providerOrderId',o.provider_order_id,'method',o.payment_method,'removedAt',o.admin_deleted_at,
   'createdAt',o.created_at,'paidAt',o.paid_at,'completedAt',o.completed_at,'startsAt',o.subscription_starts_at,'endsAt',o.subscription_ends_at,
   'dailyPoints',o.plan_daily_grant_snapshot,'durationDays',o.plan_duration_days_snapshot,'policy',o.subscription_policy_snapshot,
   'credit',c.snapshot->'upgradeCredit','targetPriceCents',c.snapshot->'priceCents','changeId',o.subscription_change_id) AS data
   FROM related_orders o LEFT JOIN subscription_changes c ON c.id=o.subscription_change_id`
	case "changes":
		records = `SELECT c.created_at AS at,c.id::text AS key,jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'amountCents',c.amount_cents,
   'createdAt',c.created_at,'completedAt',c.completed_at,'sourcePlanName',c.snapshot->'sourcePlan'->>'planName','planName',c.snapshot->>'planName',
   'manual',c.snapshot->'manualRefund','reference',c.provider_reference,'reason',c.reason,'reviewNote',c.review_note,
   'actor',a.username,'credit',c.snapshot->'upgradeCredit','calculation',c.refund_calculation) AS data
   FROM subscription_changes c LEFT JOIN admin_accounts a ON a.id=c.reviewed_by WHERE c.user_id=$1 AND c.subscription_id=$2`
	case "lots":
		records = `SELECT l.granted_at AS at,l.id::text AS key,jsonb_build_object('id',l.id,'orderId',l.order_id,'planName',o.plan_name_snapshot,
   'kind',l.grant_kind,'scheduledAt',l.scheduled_at,'createdAt',l.granted_at,'expiresAt',l.expires_at,'granted',l.granted_points,
   'available',CASE WHEN l.refund_hold OR l.upgrade_hold THEN 0 ELSE l.available_points END,'frozen',l.frozen_points,
   'held',CASE WHEN l.refund_hold OR l.upgrade_hold THEN l.available_points ELSE 0 END,'spent',l.spent_points,'expired',l.expired_points,
   'upgradeReclaimed',l.upgrade_revoked_points,'refundReclaimed',l.revoked_points-l.upgrade_revoked_points-l.expired_points,
   'holdReason',CASE WHEN l.refund_hold THEN 'refund' WHEN l.upgrade_hold THEN 'upgrade' ELSE '' END,
   'currentTerm',EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id AND p.starts_at>=$4),
   'termKnown',EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id)) AS data
   FROM subscription_credit_lots l LEFT JOIN orders o ON o.id=l.order_id WHERE l.user_id=$1 AND l.subscription_id=$2`
	case "usage":
		records = `SELECT observed.at,concat(f.source_type,':',f.source_id) AS key,jsonb_build_object(
   'sourceType',f.source_type,'sourceId',f.source_id,'createdAt',observed.at,'reason',observed.reason,
   'subscriptionSpent',funds.spent,'subscriptionFrozen',funds.frozen,'released',funds.released,'expired',funds.expired,
   'priorSpent',funds.prior_spent,'currentSpent',funds.current_spent,'topupSpent',topup.spent,'topupFrozen',topup.frozen,
   'priceBookId',d.price_book_id,'unitPoints',d.snapshot->'unitPoints','publicUnitPoints',d.snapshot->'publicUnitPoints',
   'task',CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'type',t.type,'status',t.status,'prompt',t.prompt,'costPoints',t.cost_cents) END) AS data
   FROM (SELECT DISTINCT a.source_type,a.source_id FROM subscription_credit_allocations a JOIN subscription_credit_lots l ON l.id=a.lot_id WHERE l.user_id=$1 AND l.subscription_id=$2
     UNION SELECT source_type,source_id FROM billing_decisions WHERE user_id=$1 AND subscription_id=$2) f
   LEFT JOIN billing_decisions d ON d.user_id=$1 AND d.source_type=f.source_type AND d.source_id=f.source_id
   LEFT JOIN tasks t ON t.user_id=$1 AND t.id::text=split_part(f.source_id,'/',1) AND f.source_type='task'
   LEFT JOIN LATERAL(SELECT CASE WHEN COALESCE(bool_and(a.accounting_version>=2),true) THEN COALESCE(sum(a.settled_points),0) END AS spent,COALESCE(sum(a.remaining_points),0) AS frozen,
     COALESCE(sum(a.released_points),0) AS released,COALESCE(sum(a.expired_points),0) AS expired,
     CASE WHEN COALESCE(bool_and(a.accounting_version>=2),true) THEN COALESCE(sum(a.settled_points) FILTER(WHERE EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id AND p.starts_at<$4)),0) END AS prior_spent,
     CASE WHEN COALESCE(bool_and(a.accounting_version>=2),true) THEN COALESCE(sum(a.settled_points) FILTER(WHERE EXISTS(SELECT 1 FROM subscription_periods p WHERE p.subscription_id=l.subscription_id AND p.order_id=l.order_id AND p.starts_at>=$4)),0) END AS current_spent
     FROM subscription_credit_allocations a JOIN subscription_credit_lots l ON l.id=a.lot_id
     WHERE l.subscription_id=$2 AND l.user_id=$1 AND a.source_type=f.source_type AND a.source_id=f.source_id) funds ON true
   LEFT JOIN LATERAL(SELECT COALESCE(sum(a.settled_points),0) AS spent,COALESCE(sum(a.remaining_points),0) AS frozen FROM topup_credit_allocations a JOIN topup_credit_lots l ON l.id=a.lot_id WHERE l.user_id=$1 AND a.source_type=f.source_type AND a.source_id=f.source_id) topup ON true
   LEFT JOIN LATERAL(SELECT w.created_at AS at,w.reason FROM wallet_ledger w WHERE w.user_id=$1 AND w.source_type=f.source_type
     AND (w.source_id=f.source_id OR (f.source_type='task' AND w.source_id=split_part(f.source_id,'/',1))) ORDER BY w.created_at DESC,w.id DESC LIMIT 1) observed ON true`
	case "events":
		records = `SELECT e.created_at AS at,'callback:'||e.id::text AS key,jsonb_build_object('kind','callback','orderId',e.order_id,'createdAt',e.created_at,'action',e.outcome,'detail',e.detail,'actor','支付渠道','verified',e.signature_valid,'amountCents',e.paid_amount_cents) AS data FROM payment_callback_events e JOIN related_orders o ON o.id=e.order_id
   UNION ALL SELECT o.admin_deleted_at,'removed:'||o.id::text,jsonb_build_object('kind','order_removed','orderId',o.id,'createdAt',o.admin_deleted_at,'action','removed','detail','后台移除失效订单，原始记录保留','actor',COALESCE(a.username,'历史管理员未记录')) FROM related_orders o LEFT JOIN admin_accounts a ON a.id=o.admin_deleted_by WHERE o.admin_deleted_at IS NOT NULL
   UNION ALL SELECT r.checked_at,'reconcile:'||r.id::text,jsonb_build_object('kind','reconcile','orderId',r.order_id,'createdAt',r.checked_at,'action',r.outcome,'detail',r.detail,'actor','平台对账','amountCents',r.provider_paid_amount_cents) FROM payment_reconciliations r JOIN related_orders o ON o.id=r.order_id
   UNION ALL SELECT e.occurred_at,'change:'||e.id::text,jsonb_build_object('kind','change','changeId',e.change_id,'createdAt',e.occurred_at,'action',e.action,'detail',e.internal_note,'publicMessage',e.public_message,'actor',COALESCE(a.username,CASE WHEN e.action='requested' THEN '用户' ELSE '系统' END),'amountCents',e.amount_cents,'calculation',e.calculation) FROM subscription_change_events e JOIN subscription_changes c ON c.id=e.change_id LEFT JOIN admin_accounts a ON a.id=e.actor_id WHERE c.user_id=$1 AND c.subscription_id=$2`
	default:
		return result, fmt.Errorf("invalid audit section")
	}
	sql := subscriptionAuditScope + `, records AS (` + records + `) `
	args := []any{sub.UserID, sub.ID, sub.OrderID, sub.StartsAt}
	if err := q.QueryRow(ctx, sql+`SELECT count(*) FROM records`, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := q.Query(ctx, sql+`SELECT data FROM records ORDER BY at DESC NULLS LAST,key DESC LIMIT $5 OFFSET $6`, append(args, result.Limit, (page-1)*result.Limit)...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return result, err
		}
		result.Items = append(result.Items, raw)
	}
	return result, rows.Err()
}
