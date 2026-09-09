package main

import (
	"context"
	"fmt"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (l *lab) consumeSubscription(ctx context.Context, key string, subID, operationID uuid.UUID, points int64) error {
	a, ok := l.users[key]
	if !ok || points <= 0 || points > 1000000 || subID == uuid.Nil || operationID == uuid.Nil {
		return fmt.Errorf("请选择测试账号，并填写1-1000000之间的整数积分")
	}
	at := l.currentClock()
	ctx = store.WithBillingTime(ctx, at)
	return l.st.Tx(ctx, func(tx pgx.Tx) error {
		sub, err := store.GetSubscriptionForUpdate(ctx, tx, subID)
		if err != nil {
			return err
		}
		if sub == nil || sub.UserID != a.ID || sub.BillingVersion != 2 {
			return fmt.Errorf("未找到该测试账号的新版订阅，请先购买并模拟付款")
		}
		var locked uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE`, a.ID).Scan(&locked); err != nil {
			return err
		}
		source := a.ID.String() + "/" + operationID.String()
		const kind = "sandbox_subscription_usage"
		var applied bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM wallet_ledger WHERE user_id=$1 AND source_type=$2 AND source_id=$3 AND kind='spend')`, a.ID, kind, source).Scan(&applied); err != nil {
			return err
		}
		if applied {
			return nil
		}
		if sub.Status != "active" || !sub.EndsAt.After(at) {
			return fmt.Errorf("订阅已结束或正在退款，不能模拟消费")
		}
		var available int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE subscription_id=$1 AND NOT refund_hold AND NOT upgrade_hold`, subID).Scan(&available); err != nil {
			return err
		}
		if available < points {
			return fmt.Errorf("订阅可用积分不足，当前剩余 %d 积分", available)
		}
		feature, channel, model := "text_to_image", "web", ""
		if len(sub.Policy.FeatureKeys) > 0 {
			feature = sub.Policy.FeatureKeys[0]
		}
		if len(sub.Policy.Channels) > 0 {
			channel = sub.Policy.Channels[0]
		}
		if len(sub.Policy.ModelIDs) > 0 {
			model = sub.Policy.ModelIDs[0]
		}
		ctx = wallet.WithSubscriptionScope(ctx, channel, model)
		reason := "测试模拟使用订阅积分（不调用模型）"
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, a.ID, points, feature, kind, source, &reason); err != nil {
			return err
		}
		// A test must never silently consume trial, top-up, or another subscription's credits.
		var reserved int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(a.remaining_points),0) FROM subscription_credit_allocations a JOIN subscription_credit_lots l ON l.id=a.lot_id WHERE l.subscription_id=$1 AND a.source_type=$2 AND a.source_id=$3`, subID, kind, source).Scan(&reserved); err != nil {
			return err
		}
		if reserved != points {
			return fmt.Errorf("当前扣费优先命中其他积分，本次模拟已撤销，未扣除任何积分")
		}
		_, err = wallet.SettleFeatureCredits(ctx, tx, a.ID, points, kind, source, &reason)
		return err
	})
}
