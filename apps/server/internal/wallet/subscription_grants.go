package wallet

import (
	"context"
	"fmt"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

func GrantSubscription(ctx context.Context, q store.Q, sub *store.Subscription, orderID uuid.UUID, source string, scheduled time.Time, points int64, kind string) error {
	if points < 0 {
		return fmt.Errorf("negative subscription grant")
	}
	at := store.BillingTime(ctx)
	if err := store.ExpireSubscriptionCredits(ctx, q, sub.UserID, at); err != nil {
		return err
	}
	var balance int64
	if err := q.QueryRow(ctx, `SELECT balance_cents+trial_balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, sub.UserID).Scan(&balance); err != nil {
		return err
	}
	expires := scheduled.Add(24 * time.Hour)
	if sub.EndsAt.Before(expires) {
		expires = sub.EndsAt
	}
	tag, err := q.Exec(ctx, `INSERT INTO subscription_credit_lots(subscription_id,user_id,order_id,source_id,scheduled_at,granted_points,available_points,policy,grant_kind,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) ON CONFLICT(source_id) DO NOTHING`, sub.ID, sub.UserID, orderID, source, scheduled, points, sub.Policy, kind, expires)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	reason := fmt.Sprintf("订阅24小时周期发放（%s）", scheduled.In(time.FixedZone("Beijing", 8*3600)).Format("2006-01-02 15:04"))
	if kind == "upgrade" {
		reason = "订阅升级：补齐本期额度差额"
	}
	_, err = store.InsertLedgerEntry(ctx, q, sub.UserID, "grant", points, balance, "subscription_cycle", &source, &reason, "subscription")
	if err != nil {
		return err
	}
	if err := store.ExpireSubscriptionCredits(ctx, q, sub.UserID, at); err != nil {
		return err
	}
	if !expires.After(at) {
		return nil
	}
	if kind == "upgrade" {
		return nil
	}
	var lotID uuid.UUID
	if err := q.QueryRow(ctx, `SELECT id FROM subscription_credit_lots WHERE source_id=$1`, source).Scan(&lotID); err != nil {
		return err
	}
	title := "订阅额度已重置"
	body := fmt.Sprintf("「%s」新一期 %d 积分已到账，上期未用积分已失效。本期有效至 %s。", sub.PlanName, points, expires.In(time.FixedZone("Beijing", 8*3600)).Format("2006-01-02 15:04"))
	if kind == "initial" {
		title = "订阅已开通"
		body = fmt.Sprintf("「%s」已生效，首期 %d 积分已到账，每24小时重置额度、不累计，到期时间 %s。", sub.PlanName, points, sub.EndsAt.In(time.FixedZone("Beijing", 8*3600)).Format("2006-01-02 15:04"))
	}
	return store.InsertSubscriptionNotice(ctx, q, sub.UserID, title, body, "subscription_"+kind, lotID, sub.ID, false)
}
