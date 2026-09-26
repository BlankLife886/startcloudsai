package subscription

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/contractpricing"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func validateUpgradeTarget(sub *store.Subscription, target *store.Plan, at time.Time) error {
	if sub.DurationDays <= 0 || target.DurationDays <= 0 || !sub.EndsAt.After(at) {
		return fmt.Errorf("invalid upgrade period")
	}
	if target.DailyGrantCents <= sub.DailyGrantCents || !target.SubscriptionPolicy.Covers(sub.Policy) {
		return apperr.E("upgrade_not_allowed", "仅支持同系列、更高额度且覆盖原权益的订阅升级", 422)
	}
	if target.PriceCents <= 0 || target.PriceCents > 1000000000 {
		return fmt.Errorf("upgrade amount exceeds payment limit")
	}
	return nil
}

func QuoteUpgrade(ctx context.Context, st *store.Store, userID, subID, planID uuid.UUID, at time.Time) (*store.SubscriptionChange, error) {
	ctx = store.WithBillingTime(ctx, at)
	var result *store.SubscriptionChange
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, userID.String()); err != nil {
			return err
		}
		sub, err := store.GetSubscriptionForUpdate(ctx, tx, subID)
		if err != nil {
			return err
		}
		if sub == nil || sub.UserID != userID || sub.BillingVersion != 2 || sub.Status != "active" || !sub.EndsAt.After(at) {
			return apperr.E("subscription_not_upgradeable", "当前订阅不可升级，旧版订阅请联系支持", 409)
		}
		target, err := store.GetActivePlan(ctx, tx, planID)
		if err != nil {
			return err
		}
		if target == nil || target.Kind != "subscription" {
			return apperr.E("plan_not_found", "订阅套餐不可用", 404)
		}
		if err := validateUpgradeTarget(sub, target, at); err != nil {
			return err
		}
		var open bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=$1 AND status IN ('pending','reviewing','processing'))`, sub.ID).Scan(&open); err != nil {
			return err
		}
		if open {
			return apperr.E("subscription_change_pending", "已有订阅变更正在处理", 409)
		}
		if err := grantRollingDue(ctx, tx, sub, at); err != nil {
			return err
		}
		var locked uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&locked); err != nil {
			return err
		}
		calculation, err := RefundCalculation(ctx, tx, sub, at)
		if err != nil {
			return err
		}
		if calculation.TaskFrozenPoints > 0 {
			return apperr.E("upgrade_tasks_pending", "请等待该订阅的任务结算后再升级", 409)
		}
		credit := max(min(calculation.TimeValueCents, calculation.UnusedValueCents, calculation.PaidCents-calculation.RefundedCents), 0)
		if target.PriceCents <= credit {
			return apperr.E("upgrade_not_allowed", "目标套餐价格须高于旧权益抵扣额", 422)
		}
		amount := target.PriceCents - credit
		expires := at.Add(10 * time.Minute)
		if expires.After(sub.EndsAt) {
			expires = sub.EndsAt
		}
		result, err = store.InsertSubscriptionChange(ctx, tx, &store.SubscriptionChange{UserID: userID, SubscriptionID: subID, Kind: "upgrade", Status: "quoted", TargetPlanID: &target.ID, ExpectedRevision: sub.Revision, AmountCents: amount, ExpiresAt: &expires, Snapshot: store.SubscriptionChangeSnapshot{UpgradeMode: "restart", UpgradeCredit: &store.SubscriptionUpgradeCredit{CalculatedAt: at, OldStartsAt: sub.StartsAt, OldEndsAt: sub.EndsAt, TimeValueCents: calculation.TimeValueCents, UnusedValueCents: calculation.UnusedValueCents, CreditCents: credit, IssuedPoints: calculation.IssuedPoints, SpentPoints: calculation.SpentPoints, ReclaimPoints: calculation.AvailablePoints, FuturePoints: calculation.FuturePoints}, PlanName: target.Name, Policy: target.SubscriptionPolicy, DailyPoints: target.DailyGrantCents, DurationDays: target.DurationDays, PriceCents: target.PriceCents, StartsAt: at, EndsAt: at.Add(time.Duration(target.DurationDays) * Day)}})
		if err != nil {
			return err
		}
		result.Snapshot.SourcePlan = &store.SubscriptionSourcePlan{Contract: sub.Contract, Policy: sub.Policy, PlanID: sub.PlanID, PlanName: sub.PlanName, PriceCents: sub.PriceCents, DailyPoints: sub.DailyGrantCents, DurationDays: sub.DurationDays}
		result.Snapshot.Contract, err = contractpricing.Capture(ctx, tx, target.SubscriptionPolicy, target.Revision, at)
		if err != nil {
			return err
		}
		if !result.Snapshot.Contract.CoversEntitlements(sub.Contract) {
			return apperr.E("upgrade_not_allowed", "目标套餐的价格保护或额外并发低于当前订阅权益，不属于可自助升级方案，请联系支持", 422)
		}
		_, err = tx.Exec(ctx, `UPDATE subscription_changes SET snapshot=$2 WHERE id=$1`, result.ID, result.Snapshot)
		return err
	})
	return result, err
}

func ApplyUpgrade(ctx context.Context, tx pgx.Tx, order *store.Order, at time.Time) (*store.Subscription, error) {
	ctx = store.WithBillingTime(ctx, at)
	if order.SubscriptionChangeID == nil {
		return nil, fmt.Errorf("missing upgrade quote")
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, order.UserID.String()); err != nil {
		return nil, err
	}
	change, err := store.GetSubscriptionChange(ctx, tx, *order.SubscriptionChangeID, true)
	if err != nil {
		return nil, err
	}
	if change == nil || change.Kind != "upgrade" || change.UserID != order.UserID || change.AmountCents != order.AmountCents {
		return nil, fmt.Errorf("upgrade quote mismatch")
	}
	sub, err := store.GetSubscriptionForUpdate(ctx, tx, change.SubscriptionID)
	if err != nil {
		return nil, err
	}
	if change.Status == "completed" {
		return sub, nil
	}
	if change.Snapshot.UpgradeMode == "restart" {
		return applyRestartUpgrade(ctx, tx, order, change, sub, at)
	}
	if sub == nil || sub.Revision != change.ExpectedRevision || sub.Status != "active" || !sub.EndsAt.After(at) {
		return nil, apperr.E("upgrade_requires_review", "付款已记录，但原订阅状态已变化，需要人工核查", 409)
	}
	if err := grantRollingDue(ctx, tx, sub, at); err != nil {
		return nil, err
	}
	var backlog bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_periods WHERE subscription_id=$1 AND cadence='rolling_24h' AND next_grant_at<=$2 AND granted_count<total_grants)`, sub.ID, at).Scan(&backlog); err != nil {
		return nil, err
	}
	if backlog {
		return nil, apperr.E("subscription_grants_pending", "历史积分正在补发，请等待核查后完成升级", 409)
	}
	cycle := int(at.Sub(sub.StartsAt) / Day)
	scheduled := sub.StartsAt.Add(time.Duration(cycle) * Day)
	var granted int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(granted_points),0) FROM subscription_credit_lots WHERE subscription_id=$1 AND scheduled_at=$2`, sub.ID, scheduled).Scan(&granted); err != nil {
		return nil, err
	}
	sub.PlanID = *change.TargetPlanID
	sub.PlanName = change.Snapshot.PlanName
	sub.Policy = change.Snapshot.Policy
	sub.DailyGrantCents = change.Snapshot.DailyPoints
	if err := wallet.GrantSubscription(ctx, tx, sub, order.ID, sub.ID.String()+"/upgrade/"+change.ID.String(), scheduled, max(sub.DailyGrantCents-granted, 0), "upgrade"); err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `UPDATE subscriptions SET plan_id=$2,plan_name_snapshot=$3,policy_snapshot=$4,daily_grant_cents=$5,price_snapshot=$6,duration_snapshot=$7,revision=revision+1 WHERE id=$1`, sub.ID, sub.PlanID, sub.PlanName, sub.Policy, sub.DailyGrantCents, change.Snapshot.PriceCents, change.Snapshot.DurationDays)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE subscription_periods SET daily_grant_cents=$2 WHERE subscription_id=$1 AND cadence='rolling_24h'`, sub.ID, sub.DailyGrantCents); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE subscription_changes SET status='completed',completed_at=$2,updated_at=$2 WHERE id=$1`, change.ID, at); err != nil {
		return nil, err
	}
	if err := store.SetOrderSubscriptionPeriod(ctx, tx, order.ID, at, sub.EndsAt); err != nil {
		return nil, err
	}
	change.Status = "completed"
	message := fmt.Sprintf("升级已完成，每24小时额度调整为 %d 积分，本期补发 %d 积分，原到期时间不变。", sub.DailyGrantCents, max(sub.DailyGrantCents-granted, 0))
	if err := store.RecordSubscriptionChange(ctx, tx, change, "upgrade_completed", nil, "", message, nil, at); err != nil {
		return nil, err
	}
	return store.GetSubscription(ctx, tx, sub.ID)
}

func RefundCalculation(ctx context.Context, q store.Q, sub *store.Subscription, at time.Time) (*store.RefundCalculation, error) {
	// Review time must not reduce the quote while the user's entitlement is held.
	if sub.Status == "refunding" {
		var heldAt *time.Time
		err := q.QueryRow(ctx, `SELECT (refund_calculation->>'calculatedAt')::timestamptz FROM subscription_changes WHERE subscription_id=$1 AND kind='refund' AND status IN ('reviewing','processing') ORDER BY created_at DESC LIMIT 1`, sub.ID).Scan(&heldAt)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		if heldAt != nil {
			at = *heldAt
		}
	}
	ctx = store.WithBillingTime(ctx, at)
	if err := store.ExpireSubscriptionCredits(ctx, q, sub.UserID, at); err != nil {
		return nil, err
	}
	c := &store.RefundCalculation{CalculatedAt: at, Rule: "remaining_service_and_unused_credits", Payments: []store.RefundPaymentValue{}}
	rows, err := q.Query(ctx, `SELECT id,amount_cents,subscription_starts_at,subscription_ends_at FROM orders WHERE status='completed' AND (id=$1 OR subscription_change_id IN(SELECT id FROM subscription_changes WHERE subscription_id=$2 AND kind='upgrade' AND status='completed')) ORDER BY created_at,id`, sub.OrderID, sub.ID)
	if err != nil {
		return nil, err
	}
	value := new(big.Rat)
	for rows.Next() {
		var payment store.RefundPaymentValue
		var start, end *time.Time
		if err := rows.Scan(&payment.OrderID, &payment.PaidCents, &start, &end); err != nil {
			rows.Close()
			return nil, err
		}
		if start == nil {
			if sub.OrderID != nil && payment.OrderID == *sub.OrderID {
				start = &sub.StartsAt
			} else {
				rows.Close()
				return nil, apperr.E("refund_basis_missing", "升级生效区间缺失，需要人工核查后核算退款", 409)
			}
		}
		if end == nil {
			end = &sub.EndsAt
		}
		payment.StartsAt = *start
		payment.EndsAt = *end
		duration := end.Sub(*start).Nanoseconds()
		if duration <= 0 {
			rows.Close()
			return nil, fmt.Errorf("invalid payment service interval")
		}
		part := new(big.Rat).Mul(big.NewRat(payment.PaidCents, 1), big.NewRat(min(max(end.Sub(at).Nanoseconds(), 0), duration), duration))
		payment.RemainingValueCents = new(big.Int).Quo(part.Num(), part.Denom()).Int64()
		value.Add(value, part)
		c.PaidCents += payment.PaidCents
		c.Payments = append(c.Payments, payment)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(amount_cents),0) FROM subscription_changes WHERE subscription_id=$1 AND kind='refund' AND status='completed'`, sub.ID).Scan(&c.RefundedCents); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(granted_points),0),COALESCE(sum(spent_points),0),COALESCE(sum(available_points) FILTER(WHERE NOT refund_hold AND NOT upgrade_hold),0),COALESCE(sum(frozen_points),0),COALESCE(sum(available_points) FILTER(WHERE refund_hold),0),COALESCE(sum(expired_points),0) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&c.IssuedPoints, &c.SpentPoints, &c.AvailablePoints, &c.TaskFrozenPoints, &c.RefundHeldPoints, &c.ExpiredPoints); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(GREATEST(total_grants-GREATEST(granted_count,GREATEST(floor(extract(epoch FROM ($2::timestamptz-starts_at))/86400)::integer,0)),0)::bigint*daily_grant_cents),0) FROM subscription_periods WHERE subscription_id=$1 AND cadence='rolling_24h' AND closed_at IS NULL`, sub.ID, at).Scan(&c.FuturePoints); err != nil {
		return nil, err
	}
	total := sub.EndsAt.Sub(sub.StartsAt).Nanoseconds()
	remaining := max(sub.EndsAt.Sub(at).Nanoseconds(), 0)
	c.TotalSeconds = total / int64(time.Second)
	c.RemainingSeconds = remaining / int64(time.Second)
	if total <= 0 {
		return c, nil
	}
	c.TimeValueCents = new(big.Int).Quo(value.Num(), value.Denom()).Int64()
	var totalEntitlement, held int64
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(total_grants::bigint*daily_grant_cents),0) FROM subscription_periods WHERE subscription_id=$1 AND closed_at IS NULL`, sub.ID).Scan(&totalEntitlement); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE subscription_id=$1 AND upgrade_hold`, sub.ID).Scan(&held); err != nil {
		return nil, err
	}
	unusedEntitlement := c.AvailablePoints + c.TaskFrozenPoints + c.RefundHeldPoints + held + c.FuturePoints
	c.UnusedValueCents = proportionalValue(c.PaidCents, unusedEntitlement, totalEntitlement)
	c.MaxRefundCents = max(min(c.TimeValueCents, c.UnusedValueCents), 0)
	// After a whole-term exchange, old payments are history, not additional current service value.
	var restarted bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_changes WHERE subscription_id=$1 AND kind='upgrade' AND status='completed' AND snapshot->>'upgradeMode'='restart')`, sub.ID).Scan(&restarted); err != nil {
		return nil, err
	}
	serviceValue := c.PaidCents
	if restarted {
		serviceValue = min(sub.PriceCents, max(c.PaidCents-c.RefundedCents, 0))
		c.TimeValueCents = proportionalValue(serviceValue, min(remaining, total), total)
		c.UnusedValueCents = proportionalValue(serviceValue, unusedEntitlement, totalEntitlement)
		c.MaxRefundCents = min(c.TimeValueCents, c.UnusedValueCents)
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(settled_points),0) FROM billing_decisions WHERE subscription_id=$1 AND snapshot->>'source'='subscription_contract'`, sub.ID).Scan(&c.ProtectedUsagePoints); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(a.remaining_points),0) FROM topup_credit_allocations a JOIN billing_decisions d USING(source_type,source_id) WHERE d.subscription_id=$1 AND d.snapshot->>'source'='subscription_contract'`, sub.ID).Scan(&c.ProtectedTopupFrozenPoints); err != nil {
		return nil, err
	}
	if c.SpentPoints == 0 && c.ProtectedUsagePoints == 0 && sub.Policy.RefundGraceHours() > 0 && at.Sub(sub.StartsAt) <= time.Duration(sub.Policy.RefundGraceHours())*time.Hour {
		c.MaxRefundCents = serviceValue
		c.Rule = "unused_refund_window"
	}
	if c.TaskFrozenPoints > 0 || c.ProtectedTopupFrozenPoints > 0 {
		c.MaxRefundCents = 0
		c.Rule = "awaiting_task_settlement"
	}
	if c.SpentPoints > 0 {
		c.MaxRefundCents = 0
		c.Rule = "subscription_credits_used"
	}
	if c.ProtectedUsagePoints > 0 {
		c.MaxRefundCents = 0
		c.Rule = "subscription_price_protection_used"
	}
	c.MaxRefundCents = min(c.MaxRefundCents, max(c.PaidCents-c.RefundedCents, 0))
	if sub.Status == "cancelled" {
		c.MaxRefundCents = 0
		c.Rule = "subscription_ended"
	}
	return c, nil
}

func PreviewRefund(ctx context.Context, st *store.Store, userID, subID uuid.UUID, at time.Time) (int64, error) {
	sub, err := store.GetSubscription(ctx, st.Pool, subID)
	if err != nil {
		return 0, err
	}
	if sub == nil || sub.UserID != userID || sub.BillingVersion != 2 || sub.Status != "active" || !sub.EndsAt.After(at) {
		return 0, apperr.E("refund_not_available", "当前订阅不可自助退订", 409)
	}
	calculation, err := RefundCalculation(ctx, st.Pool, sub, at)
	if err != nil {
		return 0, err
	}
	return calculation.MaxRefundCents, refundEligibility(calculation, false)
}

func refundEligibility(c *store.RefundCalculation, manual bool) error {
	if c.ProtectedUsagePoints > 0 && !manual {
		return apperr.E("subscription_credits_used", "已使用订阅锁价权益，无法自助退款，请联系支持人工核查", 409)
	}
	if c.SpentPoints > 0 && !manual {
		return apperr.E("subscription_credits_used", "已使用过订阅积分，无法申请退款", 409)
	}
	if c.TaskFrozenPoints > 0 || c.ProtectedTopupFrozenPoints > 0 {
		return apperr.E("refund_tasks_pending", "订阅积分正用于进行中的任务，请等待任务结算后再申请退款", 409)
	}
	return nil
}

func RequestRefund(ctx context.Context, st *store.Store, userID, subID uuid.UUID, reason string, at time.Time) (*store.SubscriptionChange, error) {
	return requestRefund(ctx, st, userID, subID, reason, at, nil)
}

type manualRefund struct {
	adminID uuid.UUID
	amount  int64
	note    string
}

// Only the authenticated admin handler exposes this exception, never user input on RequestRefund.
func RequestManualRefund(ctx context.Context, st *store.Store, adminID, orderID uuid.UUID, amount int64, note string, at time.Time) (*store.SubscriptionChange, error) {
	note = strings.TrimSpace(note)
	if adminID == uuid.Nil || amount <= 0 || len([]rune(note)) < 6 || len([]rune(note)) > 500 {
		return nil, apperr.E("validation_error", "人工退款需填写正数金额和6-500字内部处理原因", 422)
	}
	sub, err := store.SubscriptionForPaidOrder(ctx, st.Pool, orderID)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return nil, apperr.E("not_found", "未找到该已完成订单对应的订阅", 404)
	}
	return requestRefund(ctx, st, sub.UserID, sub.ID, "人工协商退订退款", at, &manualRefund{adminID: adminID, amount: amount, note: note})
}

func requestRefund(ctx context.Context, st *store.Store, userID, subID uuid.UUID, reason string, at time.Time, manual *manualRefund) (*store.SubscriptionChange, error) {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) < 6 || len([]rune(reason)) > 500 {
		return nil, apperr.E("validation_error", "请填写6-500字退订原因", 422)
	}
	var result *store.SubscriptionChange
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, userID.String()); err != nil {
			return err
		}
		sub, err := store.GetSubscriptionForUpdate(ctx, tx, subID)
		if err != nil {
			return err
		}
		if sub == nil || sub.UserID != userID || sub.BillingVersion != 2 || (sub.Status != "active" && !(manual != nil && sub.Status == "expired")) || (manual == nil && !sub.EndsAt.After(at)) {
			return apperr.E("refund_not_available", "当前订阅不可自助退订，旧版订阅请联系支持核查", 409)
		}
		var open bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_changes c WHERE c.subscription_id=$1 AND ((c.kind='refund' AND c.status IN ('reviewing','processing')) OR (c.kind='upgrade' AND EXISTS(SELECT 1 FROM orders o WHERE o.subscription_change_id=c.id AND o.status IN ('pending','uncertain','paid')))))`, subID).Scan(&open); err != nil {
			return err
		}
		if open {
			return apperr.E("subscription_change_pending", "已有订阅变更正在处理", 409)
		}
		var locked uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&locked); err != nil {
			return err
		}
		calculation, err := RefundCalculation(ctx, tx, sub, at)
		if err != nil {
			return err
		}
		if err := refundEligibility(calculation, manual != nil); err != nil {
			return err
		}
		amount := calculation.MaxRefundCents
		status := "reviewing"
		if manual != nil {
			if manual.amount > max(calculation.PaidCents-calculation.RefundedCents, 0) {
				return apperr.E("refund_amount_invalid", "人工退款金额不能超过累计实付减去已退金额", 422)
			}
			amount, status = manual.amount, "processing"
		}
		result, err = store.InsertSubscriptionChange(ctx, tx, &store.SubscriptionChange{UserID: userID, SubscriptionID: subID, Kind: "refund", Status: status, ExpectedRevision: sub.Revision, AmountCents: amount, Reason: reason, Snapshot: store.SubscriptionChangeSnapshot{Contract: sub.Contract, Policy: sub.Policy, ManualRefund: manual != nil, PlanName: sub.PlanName, StartsAt: sub.StartsAt, EndsAt: sub.EndsAt}})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE subscription_changes SET requested_amount_cents=$2 WHERE id=$1`, result.ID, amount); err != nil {
			return err
		}
		result.RequestedAmountCents = &amount
		if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET refund_hold=true WHERE subscription_id=$1`, sub.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE subscriptions SET status='refunding' WHERE id=$1`, sub.ID); err != nil {
			return err
		}
		if calculation.AvailablePoints > 0 {
			var balance int64
			if err := tx.QueryRow(ctx, `SELECT balance_cents+trial_balance_cents FROM wallets WHERE user_id=$1`, userID).Scan(&balance); err != nil {
				return err
			}
			source, reason := result.ID.String(), "提交退订申请，冻结订阅积分等待审核"
			if _, err := store.InsertLedgerEntry(ctx, tx, userID, "freeze", -calculation.AvailablePoints, balance, "subscription_refund_hold", &source, &reason, "subscription"); err != nil {
				return err
			}
		}
		calculation.RefundHeldPoints += calculation.AvailablePoints
		calculation.AvailablePoints = 0
		result.RefundCalculation = calculation
		if manual != nil {
			auditNote := fmt.Sprintf("%s [manual_approved] admin=%s %s", at.UTC().Format(time.RFC3339), manual.adminID, manual.note)
			if _, err := tx.Exec(ctx, `UPDATE subscription_changes SET reviewed_by=$2,review_note=$3 WHERE id=$1`, result.ID, manual.adminID, auditNote); err != nil {
				return err
			}
			result.ReviewedBy, result.ReviewNote = &manual.adminID, auditNote
			return store.RecordSubscriptionChange(ctx, tx, result, "manual_approved", &manual.adminID, manual.note, store.SubscriptionChangeMessage(result), calculation, at)
		}
		return store.RecordSubscriptionChange(ctx, tx, result, "requested", nil, "", store.SubscriptionChangeMessage(result), calculation, at)
	})
	return result, err
}

func ReviewRefund(ctx context.Context, st *store.Store, id, adminID uuid.UUID, action, note, reference string, at time.Time, approvedAmount ...int64) error {
	return ReviewRefundWithMessage(ctx, st, id, adminID, action, note, reference, "", at, approvedAmount...)
}

func ReviewRefundWithMessage(ctx context.Context, st *store.Store, id, adminID uuid.UUID, action, note, reference, customerMessage string, at time.Time, approvedAmount ...int64) error {
	if len([]rune(customerMessage)) > 300 {
		return apperr.E("validation_error", "用户说明最多300字", 422)
	}
	if len([]rune(strings.TrimSpace(note))) < 6 || len([]rune(note)) > 500 {
		return apperr.E("validation_error", "请填写至少6字处理说明", 422)
	}
	if action != "confirm_external_refund" {
		reference = ""
	}
	return st.Tx(ctx, func(tx pgx.Tx) error {
		seed, err := store.GetSubscriptionChange(ctx, tx, id, false)
		if err != nil {
			return err
		}
		if seed == nil || seed.Kind != "refund" {
			return apperr.E("not_found", "退款申请不存在", 404)
		}
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, seed.UserID.String()); err != nil {
			return err
		}
		sub, err := store.GetSubscriptionForUpdate(ctx, tx, seed.SubscriptionID)
		if err != nil {
			return err
		}
		c, err := store.GetSubscriptionChange(ctx, tx, id, true)
		if err != nil {
			return err
		}
		var frozen int64
		if err := tx.QueryRow(ctx, `SELECT frozen_cents+trial_frozen_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, c.UserID).Scan(&frozen); err != nil {
			return err
		}
		var held, balance int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(available_points),0) FROM subscription_credit_lots WHERE subscription_id=$1`, sub.ID).Scan(&held); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT balance_cents+trial_balance_cents FROM wallets WHERE user_id=$1`, sub.UserID).Scan(&balance); err != nil {
			return err
		}
		ledger := func(kind string, delta int64) error {
			if held == 0 {
				return nil
			}
			source := c.ID.String()
			reason := "订阅退订审核：" + action
			_, err := store.InsertLedgerEntry(ctx, tx, sub.UserID, kind, delta, balance, "subscription_refund_hold", &source, &reason, "subscription")
			return err
		}
		next := ""
		var calculation *store.RefundCalculation
		switch action {
		case "approve":
			if c.Status != "reviewing" || (sub.Status != "active" && sub.Status != "refunding") || sub.Revision != c.ExpectedRevision {
				return apperr.E("refund_conflict", "订阅状态已变化，请重新核查", 409)
			}
			calculation, err = RefundCalculation(ctx, tx, sub, at)
			if err != nil {
				return err
			}
			if err := refundEligibility(calculation, false); err != nil {
				return err
			}
			c.AmountCents = min(c.AmountCents, calculation.MaxRefundCents)
			if len(approvedAmount) > 0 {
				if approvedAmount[0] < 0 || approvedAmount[0] > c.AmountCents {
					return apperr.E("refund_amount_invalid", "核定金额不能超过当前可退上限", 422)
				}
				c.AmountCents = approvedAmount[0]
			}
			if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET refund_hold=true WHERE subscription_id=$1`, sub.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE subscriptions SET status='refunding',revision=revision+1 WHERE id=$1`, sub.ID); err != nil {
				return err
			}
			next = "processing"
			if calculation.AvailablePoints > 0 {
				if err := ledger("freeze", -calculation.AvailablePoints); err != nil {
					return err
				}
			}
			if c.AmountCents == 0 {
				if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET revoked_points=revoked_points+available_points,available_points=0 WHERE subscription_id=$1`, sub.ID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE subscriptions SET status='cancelled' WHERE id=$1`, sub.ID); err != nil {
					return err
				}
				if err := ledger("spend", 0); err != nil {
					return err
				}
				next = "completed"
			}
		case "reject":
			if c.Status != "reviewing" && c.Status != "processing" {
				return apperr.E("refund_conflict", "申请不可驳回", 409)
			}
			if sub.Status == "refunding" {
				if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET refund_hold=false WHERE subscription_id=$1`, sub.ID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE subscriptions SET status=CASE WHEN ends_at>$2 THEN 'active' ELSE 'expired' END WHERE id=$1`, sub.ID, at); err != nil {
					return err
				}
				if err := ledger("release", held); err != nil {
					return err
				}
			}
			next = "rejected"
		case "confirm_external_refund":
			reference = strings.TrimSpace(reference)
			if c.Status != "processing" || sub.Status != "refunding" || len(reference) < 6 || len(reference) > 128 {
				return apperr.E("refund_conflict", "须在渠道退款成功后提供真实退款流水号", 409)
			}
			check, err := RefundCalculation(ctx, tx, sub, at)
			if err != nil {
				return err
			}
			if err := refundEligibility(check, c.Snapshot.ManualRefund); err != nil {
				return err
			}
			if c.AmountCents > max(check.PaidCents-check.RefundedCents, 0) {
				return apperr.E("refund_amount_invalid", "退款金额超过剩余实付金额，请重新核查", 409)
			}
			if _, err := tx.Exec(ctx, `UPDATE subscription_credit_lots SET revoked_points=revoked_points+available_points,available_points=0 WHERE subscription_id=$1 AND frozen_points=0`, sub.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE subscriptions SET status='cancelled',revision=revision+1 WHERE id=$1`, sub.ID); err != nil {
				return err
			}
			next = "completed"
			if err := ledger("spend", 0); err != nil {
				return err
			}
		default:
			return apperr.E("validation_error", "无效退款操作", 422)
		}
		auditNote := fmt.Sprintf("%s [%s] admin=%s %s", at.UTC().Format(time.RFC3339), action, adminID, note)
		_, err = tx.Exec(ctx, `UPDATE subscription_changes SET status=$2,amount_cents=$3,review_note=review_note||CASE WHEN review_note='' THEN '' ELSE E'\n' END||$4,reviewed_by=$5,provider_reference=COALESCE(NULLIF($6,''),provider_reference),updated_at=$7,completed_at=CASE WHEN $2='completed' THEN $7 ELSE completed_at END WHERE id=$1`, id, next, c.AmountCents, auditNote, adminID, reference, at)
		if err != nil {
			return err
		}
		c.Status = next
		c.PublicMessage = ""
		message := store.SubscriptionChangeMessage(c)
		if strings.TrimSpace(customerMessage) != "" {
			message += " 说明：" + strings.TrimSpace(customerMessage)
		}
		return store.RecordSubscriptionChange(ctx, tx, c, action, &adminID, note, message, calculation, at)
	})
}
