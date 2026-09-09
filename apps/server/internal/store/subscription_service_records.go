package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type RefundCalculation struct {
	ProtectedTopupFrozenPoints int64                `json:"protectedTopupFrozenPoints"`
	ProtectedUsagePoints       int64                `json:"protectedUsagePoints"`
	ExpiredPoints              int64                `json:"expiredPoints"`
	RefundedCents              int64                `json:"refundedCents"`
	Payments                   []RefundPaymentValue `json:"payments"`
	CalculatedAt               time.Time            `json:"calculatedAt"`
	PaidCents                  int64                `json:"paidCents"`
	IssuedPoints               int64                `json:"issuedPoints"`
	SpentPoints                int64                `json:"spentPoints"`
	AvailablePoints            int64                `json:"availablePoints"`
	TaskFrozenPoints           int64                `json:"taskFrozenPoints"`
	RefundHeldPoints           int64                `json:"refundHeldPoints"`
	FuturePoints               int64                `json:"futurePoints"`
	RemainingSeconds           int64                `json:"remainingSeconds"`
	TotalSeconds               int64                `json:"totalSeconds"`
	TimeValueCents             int64                `json:"timeValueCents"`
	UnusedValueCents           int64                `json:"unusedValueCents"`
	MaxRefundCents             int64                `json:"maxRefundCents"`
	Rule                       string               `json:"rule"`
}

type RefundPaymentValue struct {
	OrderID             uuid.UUID `json:"orderId"`
	PaidCents           int64     `json:"paidCents"`
	StartsAt            time.Time `json:"startsAt"`
	EndsAt              time.Time `json:"endsAt"`
	RemainingValueCents int64     `json:"remainingValueCents"`
}

type SubscriptionChangeEvent struct {
	ActorName     string             `json:"actorName"`
	ID            uuid.UUID          `json:"id"`
	Action        string             `json:"action"`
	OccurredAt    time.Time          `json:"occurredAt"`
	ActorID       *uuid.UUID         `json:"actorId,omitempty"`
	InternalNote  string             `json:"internalNote,omitempty"`
	PublicMessage string             `json:"publicMessage"`
	AmountCents   int64              `json:"amountCents"`
	Calculation   *RefundCalculation `json:"calculation"`
}

func SubscriptionChangeMessage(c *SubscriptionChange) string {
	if c.PublicMessage != "" {
		return c.PublicMessage
	}
	if c.Kind == "upgrade" {
		if c.Status == "completed" {
			if c.Snapshot.UpgradeMode == "restart" {
				return "整期升级已完成，旧未用积分已置换，新订阅从本次开通起重新计算完整周期。"
			}
			return "订阅升级已完成，原到期时间不变。"
		}
		if c.Status == "pending" {
			if c.Snapshot.UpgradeMode == "restart" {
				return "升级订单等待支付，参与抵扣的旧订阅积分已锁定并暂停发放，通用积分不受影响。"
			}
			return "升级订单等待支付，原订阅仍然有效。"
		}
		return "本次升级尝试已结束，原订阅不受影响。"
	}
	switch c.Status {
	case "reviewing":
		return "退订申请已提交，订阅积分已冻结，审核期间暂停发放。通用积分不受影响；审核未通过将解冻订阅积分。"
	case "processing":
		return fmt.Sprintf("审核已通过，核定退款 ¥%d.%02d，正在办理退款。订阅积分暂时冻结，通用积分不受影响。", c.AmountCents/100, c.AmountCents%100)
	case "completed":
		if c.AmountCents == 0 {
			return "退订已完成，本次无可退金额，剩余订阅积分已回收。"
		}
		return fmt.Sprintf("退款 ¥%d.%02d 已确认完成，订阅已结束，剩余订阅积分已回收。", c.AmountCents/100, c.AmountCents%100)
	case "rejected":
		return "本次退订申请未通过，订阅积分已解除冻结，原权益按剩余有效期恢复；过期周期额度不结转。"
	default:
		return "本次退订申请已结束。"
	}
}

func InsertSubscriptionNotice(ctx context.Context, q Q, userID uuid.UUID, title, body, source string, sourceID, subID uuid.UUID, changes bool) error {
	path := "/subscriptions?subscription=" + subID.String()
	if changes {
		path += "&view=changes"
	}
	_, err := q.Exec(ctx, `INSERT INTO notifications(user_id,kind,title,body,source_type,source_id,target_path) VALUES($1,'order',$2,$3,$4,$5,$6) ON CONFLICT(source_type,source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL DO NOTHING`, userID, title, body, source, sourceID, path)
	return err
}

func RecordSubscriptionChange(ctx context.Context, q Q, c *SubscriptionChange, action string, actor *uuid.UUID, note, message string, calculation *RefundCalculation, at time.Time) error {
	c.PublicMessage = message
	if _, err := q.Exec(ctx, `UPDATE subscription_changes SET public_message=$2,refund_calculation=COALESCE($3,refund_calculation) WHERE id=$1`, c.ID, message, calculation); err != nil {
		return err
	}
	if _, err := q.Exec(ctx, `INSERT INTO subscription_change_events(change_id,action,occurred_at,actor_id,internal_note,public_message,amount_cents,calculation) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(change_id,action) DO NOTHING`, c.ID, action, at, actor, note, message, c.AmountCents, calculation); err != nil {
		return err
	}
	titles := map[string]string{"reviewing": "退订申请已提交", "processing": "退订审核已通过", "completed": "退订已完成", "rejected": "退订审核未通过"}
	title := titles[c.Status]
	if c.Kind == "upgrade" {
		title = "订阅升级成功"
	}
	prefix := "「" + c.Snapshot.PlanName + "」"
	if c.Kind == "upgrade" && c.Snapshot.SourcePlan != nil {
		prefix = "从「" + c.Snapshot.SourcePlan.PlanName + "」升级至「" + c.Snapshot.PlanName + "」。"
	}
	return InsertSubscriptionNotice(ctx, q, c.UserID, title, prefix+message, "subscription_"+c.Kind+"_"+c.Status, c.ID, c.SubscriptionID, true)
}

func ListSubscriptionChangeEvents(ctx context.Context, q Q, id uuid.UUID) ([]SubscriptionChangeEvent, error) {
	rows, err := q.Query(ctx, `SELECT id,action,occurred_at,actor_id,internal_note,public_message,amount_cents,calculation,COALESCE((SELECT username||' <'||email||'>' FROM admin_accounts WHERE id=actor_id),CASE WHEN action='requested' THEN '用户' ELSE '系统' END) FROM subscription_change_events WHERE change_id=$1 ORDER BY occurred_at,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SubscriptionChangeEvent{}
	for rows.Next() {
		var e SubscriptionChangeEvent
		if err := rows.Scan(&e.ID, &e.Action, &e.OccurredAt, &e.ActorID, &e.InternalNote, &e.PublicMessage, &e.AmountCents, &e.Calculation, &e.ActorName); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func SearchSubscriptionChanges(ctx context.Context, q Q, query, status, kind string, page int) ([]*SubscriptionChange, int, error) {
	where := ` WHERE (kind='refund' OR status<>'quoted') AND ($1='' OR status=$1) AND ($2='' OR kind=$2)
 AND ($3='' OR strpos(lower(id::text),lower($3))>0 OR strpos(lower(subscription_id::text),lower($3))>0
 OR strpos(lower(COALESCE(provider_reference,'')),lower($3))>0
 OR EXISTS(SELECT 1 FROM users u WHERE u.id=c.user_id AND (strpos(lower(u.email),lower($3))>0 OR strpos(lower(u.username),lower($3))>0 OR strpos(u.id::text,$3)>0))
 OR EXISTS(SELECT 1 FROM orders o WHERE (o.subscription_change_id IN(SELECT related.id FROM subscription_changes related WHERE related.subscription_id=c.subscription_id AND related.kind='upgrade') OR o.id=(SELECT s.order_id FROM subscriptions s WHERE s.id=c.subscription_id)) AND (strpos(o.id::text,$3)>0 OR strpos(lower(COALESCE(o.provider_order_id,'')),lower($3))>0)))`
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM subscription_changes c`+where, status, kind, query).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx, `SELECT `+subscriptionChangeCols+` FROM subscription_changes c`+where+` ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $4`, status, kind, query, (page-1)*25)
	if err != nil {
		return nil, 0, err
	}
	out := []*SubscriptionChange{}
	ids := []uuid.UUID{}
	for rows.Next() {
		c, err := scanSubscriptionChange(rows)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		out = append(out, c)
		ids = append(ids, c.UserID)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	users, err := GetUsersByIDs(ctx, q, ids)
	if err != nil {
		return nil, 0, err
	}
	for _, c := range out {
		if user := users[c.UserID]; user != nil {
			c.UserEmail = user.Email
			c.Username = user.Username
		}
	}
	return out, total, nil
}

func SubscriptionRelatedOrders(ctx context.Context, q Q, sub *Subscription) ([]*Order, error) {
	rows, err := q.Query(ctx, `SELECT `+orderCols+` FROM orders WHERE id=$1 OR subscription_change_id IN(SELECT id FROM subscription_changes WHERE subscription_id=$2 AND kind='upgrade') ORDER BY created_at,id LIMIT 100`, sub.OrderID, sub.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func SubscriptionRelatedLedger(ctx context.Context, q Q, sub *Subscription, page int) ([]*LedgerEntry, int, error) {
	where := ` FROM wallet_ledger w WHERE w.user_id=$1 AND (
 (source_type IN ('subscription_refund_hold','subscription_upgrade_exchange') AND source_id IN(SELECT id::text FROM subscription_changes WHERE subscription_id=$2))
 OR (source_type='subscription_cycle' AND source_id IN(SELECT source_id FROM subscription_credit_lots WHERE subscription_id=$2))
 OR (source_type='subscription_cycle_expiry' AND (source_id IN(SELECT id::text FROM subscription_credit_lots WHERE subscription_id=$2)
 OR source_id IN(SELECT e.id::text FROM wallet_ledger e JOIN subscription_credit_allocations a ON a.source_type=e.source_type AND a.source_id=e.source_id JOIN subscription_credit_lots l ON l.id=a.lot_id WHERE l.subscription_id=$2)))
 OR EXISTS(SELECT 1 FROM subscription_credit_allocations a JOIN subscription_credit_lots l ON l.id=a.lot_id WHERE l.subscription_id=$2 AND a.source_type=w.source_type AND (a.source_id=w.source_id OR (w.source_type='task' AND split_part(a.source_id,'/',1)=w.source_id))))
`
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*)`+where, sub.UserID, sub.ID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx, `SELECT `+ledgerCols+where+` ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $3`, sub.UserID, sub.ID, (page-1)*50)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*LedgerEntry{}
	for rows.Next() {
		e, err := scanLedger(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}
