// Package wallet 实现钱包核心：条件 UPDATE + 账本同事务 + 幂等键。
//
// 所有函数在调用方事务（pgx.Tx / store.Q）内执行，不 commit，由调用方保证原子性。
// 幂等：先查 (kind, source_type, source_id) 是否已有账本记录，有则直接返回
// （幂等重放）；并发竞态由 partial unique index（uq_wallet_ledger_idem）兜底，
// SQLSTATE 23505 由调用方以「重放」语义处理（重试整个事务即可命中前置检查）。
//
// 任务冻结/解冻可能因 requeue 发生多轮，账本 source_id 采用「代数」后缀：
// 第 0 代为 task_id 本身，第 n 代为 "task_id/n"。
// spend（结算）全任务生命周期只发生一次，幂等键固定 ('spend','task',task_id)。
package wallet

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func now() time.Time { return time.Now().UTC() }

func strPtr(s string) *string { return &s }

func creditBucket(normalCents, trialCents int64) string {
	switch {
	case normalCents > 0 && trialCents > 0:
		return "mixed"
	case trialCents > 0:
		return "trial"
	default:
		return "normal"
	}
}

// Grant 幂等入账（注册赠送 / 订单入账 / 退款）。kind 只允许 grant / refund。
func Grant(ctx context.Context, q store.Q, userID uuid.UUID, amountCents int64, kind, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amountCents < 0 {
		return nil, fmt.Errorf("grant amount must be >= 0")
	}
	existing, err := store.GetLedgerEntry(ctx, q, kind, sourceType, sourceID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets SET balance_cents = balance_cents + $2, updated_at = $3
		 WHERE user_id = $1 RETURNING balance_cents + trial_balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("not_found", "钱包不存在", 404)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, kind, amountCents, balanceAfter, sourceType, strPtr(sourceID), reason, "normal")
}

// GrantTrial 幂等发放到独立的体验积分桶。可使用的产品功能由当前
// 活动的逐功能授权决定，而不是由钱包中的单个历史功能键决定。
func GrantTrial(ctx context.Context, q store.Q, userID uuid.UUID, amountCents int64, featureKey, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amountCents < 0 {
		return nil, fmt.Errorf("trial grant amount must be >= 0")
	}
	if featureKey == "" {
		return nil, fmt.Errorf("trial feature key is required")
	}
	existing, err := store.GetLedgerEntry(ctx, q, "grant", sourceType, sourceID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets
		 SET trial_balance_cents = trial_balance_cents + $2,
		     trial_feature_key = $3,
		     updated_at = $4
		 WHERE user_id = $1
		 RETURNING balance_cents + trial_balance_cents`,
		userID, amountCents, featureKey, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("not_found", "钱包不存在", 404)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "grant", amountCents, balanceAfter, sourceType, strPtr(sourceID), reason, "trial")
}

// AdminAdjust 人工调整（可正可负），负数时校验余额充足。
func AdminAdjust(ctx context.Context, q store.Q, userID uuid.UUID, deltaCents int64, sourceID string, reason string) (*store.LedgerEntry, error) {
	existing, err := store.GetLedgerEntry(ctx, q, "admin_adjust", "admin", sourceID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	sql := `UPDATE wallets SET balance_cents = balance_cents + $2, updated_at = $3 WHERE user_id = $1`
	if deltaCents < 0 {
		sql += ` AND balance_cents >= -$2::bigint`
	}
	sql += ` RETURNING balance_cents + trial_balance_cents`
	var balanceAfter int64
	err = q.QueryRow(ctx, sql, userID, deltaCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			w, werr := store.GetWallet(ctx, q, userID)
			if werr != nil {
				return nil, werr
			}
			if w == nil {
				return nil, apperr.E("not_found", "钱包不存在", 404)
			}
			return nil, apperr.E("insufficient_balance", "余额不足，无法扣减", 400)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "admin_adjust", deltaCents, balanceAfter, "admin", strPtr(sourceID), strPtr(reason), "normal")
}

func taskSourceID(taskID uuid.UUID, generation int) string {
	if generation == 0 {
		return taskID.String()
	}
	return fmt.Sprintf("%s/%d", taskID, generation)
}

// FreezeForTask 冻结任务费用：只对匹配的真实功能使用体验积分，其余费用使用普通积分。
func FreezeForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amountCents int64, featureKey string, reason *string) (*store.LedgerEntry, error) {
	gen, err := store.CountTaskLedger(ctx, q, taskID, "freeze")
	if err != nil {
		return nil, err
	}
	sourceID := taskSourceID(taskID, gen)
	var balanceAfter, normalCents, trialCents int64
	err = q.QueryRow(ctx,
		`WITH allocation AS (
			SELECT user_id,
			       LEAST(
			           CASE WHEN EXISTS (
			               SELECT 1 FROM user_trial_feature_entitlements entitlement
			               JOIN trial_access_applications application ON application.id = entitlement.application_id
			               JOIN trial_campaigns campaign ON campaign.id = application.campaign_id
			               WHERE entitlement.user_id = wallets.user_id
			                 AND entitlement.feature_key = $4
			                 AND entitlement.revoked_at IS NULL
			                 AND campaign.status = 'active'
			                 AND campaign.expires_at > now()
			           ) THEN trial_balance_cents ELSE 0 END,
			           $2::bigint
			       ) AS trial_cents,
			       $2::bigint - LEAST(
			           CASE WHEN EXISTS (
			               SELECT 1 FROM user_trial_feature_entitlements entitlement
			               JOIN trial_access_applications application ON application.id = entitlement.application_id
			               JOIN trial_campaigns campaign ON campaign.id = application.campaign_id
			               WHERE entitlement.user_id = wallets.user_id
			                 AND entitlement.feature_key = $4
			                 AND entitlement.revoked_at IS NULL
			                 AND campaign.status = 'active'
			                 AND campaign.expires_at > now()
			           ) THEN trial_balance_cents ELSE 0 END,
			           $2::bigint
			       ) AS normal_cents
			FROM wallets
			WHERE user_id = $1
			  AND balance_cents + CASE WHEN EXISTS (
			      SELECT 1 FROM user_trial_feature_entitlements entitlement
			      JOIN trial_access_applications application ON application.id = entitlement.application_id
			      JOIN trial_campaigns campaign ON campaign.id = application.campaign_id
			      WHERE entitlement.user_id = wallets.user_id
			        AND entitlement.feature_key = $4
			        AND entitlement.revoked_at IS NULL
			        AND campaign.status = 'active'
			        AND campaign.expires_at > now()
			  ) THEN trial_balance_cents ELSE 0 END >= $2
		), updated AS (
			UPDATE wallets w
			SET balance_cents = w.balance_cents - a.normal_cents,
			    frozen_cents = w.frozen_cents + a.normal_cents,
			    trial_balance_cents = w.trial_balance_cents - a.trial_cents,
			    trial_frozen_cents = w.trial_frozen_cents + a.trial_cents,
			    updated_at = $3
			FROM allocation a
			WHERE w.user_id = a.user_id
			RETURNING w.balance_cents + w.trial_balance_cents AS balance_after,
			          a.normal_cents, a.trial_cents
		)
		SELECT balance_after, normal_cents, trial_cents FROM updated`,
		userID, amountCents, now(), featureKey).Scan(&balanceAfter, &normalCents, &trialCents)
	if err != nil {
		if isNoRows(err) {
			current, walletErr := store.GetWallet(ctx, q, userID)
			if walletErr != nil {
				return nil, walletErr
			}
			if current != nil && current.BalanceCents+current.TrialBalanceCents >= amountCents && current.TrialBalanceCents > 0 {
				return nil, apperr.E("trial_credit_feature_mismatch", "当前体验积分仅限获批功能使用，普通积分不足以支付本次任务", 400)
			}
			return nil, apperr.E("insufficient_balance", "余额不足", 400)
		}
		return nil, err
	}
	reservationFeatureKey := ""
	if trialCents > 0 {
		reservationFeatureKey = featureKey
	}
	if _, err := store.InsertTaskCreditReservation(ctx, q, taskID, gen, normalCents, trialCents, reservationFeatureKey); err != nil {
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "freeze", -amountCents, balanceAfter, "task", strPtr(sourceID), reason, creditBucket(normalCents, trialCents))
}

// ReleaseForTask 解冻（失败/取消）：幂等——本代已 release 则重放返回。
func ReleaseForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amountCents int64, reason *string) (*store.LedgerEntry, error) {
	freezeGen, err := store.CountTaskLedger(ctx, q, taskID, "freeze")
	if err != nil {
		return nil, err
	}
	releaseGen, err := store.CountTaskLedger(ctx, q, taskID, "release")
	if err != nil {
		return nil, err
	}
	if releaseGen >= freezeGen {
		// 每一代 freeze 都已对应 release，幂等重放
		lastGen := releaseGen - 1
		if lastGen < 0 {
			lastGen = 0
		}
		existing, err := store.GetLedgerEntry(ctx, q, "release", "task", taskSourceID(taskID, lastGen))
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
		return nil, apperr.E("internal_error", "任务未冻结，无法解冻", 500)
	}
	sourceID := taskSourceID(taskID, releaseGen)
	reservation, err := store.GetTaskCreditReservationForUpdate(ctx, q, taskID, releaseGen)
	if err != nil {
		return nil, err
	}
	if reservation == nil || reservation.NormalRemainingCents+reservation.TrialRemainingCents < amountCents {
		return nil, apperr.E("internal_error", "任务冻结来源异常，无法解冻", 500)
	}
	trialCents := min(reservation.TrialRemainingCents, amountCents)
	normalCents := amountCents - trialCents
	if normalCents > reservation.NormalRemainingCents {
		return nil, apperr.E("internal_error", "任务冻结来源不足，无法解冻", 500)
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets
		 SET balance_cents = balance_cents + $2,
		     frozen_cents = frozen_cents - $2,
		     trial_balance_cents = trial_balance_cents + $3,
		     trial_frozen_cents = trial_frozen_cents - $3,
		     updated_at = $4
		 WHERE user_id = $1 AND frozen_cents >= $2 AND trial_frozen_cents >= $3
		 RETURNING balance_cents + trial_balance_cents`,
		userID, normalCents, trialCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("internal_error", "冻结余额异常，无法解冻", 500)
		}
		return nil, err
	}
	if err := store.UpdateTaskCreditReservationRemaining(
		ctx, q, taskID, releaseGen,
		reservation.NormalRemainingCents-normalCents,
		reservation.TrialRemainingCents-trialCents,
		now(),
	); err != nil {
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "release", amountCents, balanceAfter, "task", strPtr(sourceID), reason, creditBucket(normalCents, trialCents))
}

// SettleForTask 结算（成功）：消耗冻结额，幂等键 ('spend','task',task_id)。
// delta_cents = 0：结算只消耗冻结额，可用余额不变（冻结时已记 -amount）。
func SettleForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amountCents int64, reason *string) (*store.LedgerEntry, error) {
	existing, err := store.GetLedgerEntry(ctx, q, "spend", "task", taskID.String())
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	reservation, err := store.GetActiveTaskCreditReservationForUpdate(ctx, q, taskID)
	if err != nil {
		return nil, err
	}
	if reservation == nil || reservation.NormalRemainingCents+reservation.TrialRemainingCents < amountCents {
		return nil, apperr.E("internal_error", "任务冻结来源异常，无法结算", 500)
	}
	trialCents := min(reservation.TrialRemainingCents, amountCents)
	normalCents := amountCents - trialCents
	if normalCents > reservation.NormalRemainingCents {
		return nil, apperr.E("internal_error", "任务冻结来源不足，无法结算", 500)
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets
		 SET frozen_cents = frozen_cents - $2,
		     trial_frozen_cents = trial_frozen_cents - $3,
		     trial_feature_key = CASE
		         WHEN trial_balance_cents + trial_frozen_cents - $3 = 0 THEN NULL
		         ELSE trial_feature_key
		     END,
		     updated_at = $4
		 WHERE user_id = $1 AND frozen_cents >= $2 AND trial_frozen_cents >= $3
		 RETURNING balance_cents + trial_balance_cents`,
		userID, normalCents, trialCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("internal_error", "冻结余额异常，无法结算", 500)
		}
		return nil, err
	}
	if err := store.UpdateTaskCreditReservationRemaining(
		ctx, q, taskID, reservation.Generation,
		reservation.NormalRemainingCents-normalCents,
		reservation.TrialRemainingCents-trialCents,
		now(),
	); err != nil {
		return nil, err
	}
	if reason == nil {
		reason = strPtr(fmt.Sprintf("任务结算：消耗冻结 %d 分", amountCents))
	}
	return store.InsertLedgerEntry(ctx, q, userID, "spend", 0, balanceAfter, "task", strPtr(taskID.String()), reason, creditBucket(normalCents, trialCents))
}

// FreezeNormalCredits 为非图片任务预留普通积分。sourceType/sourceID 组成幂等键；
// 体验积分只用于活动明确授权的图片功能，不参与此类扣费。
func FreezeNormalCredits(ctx context.Context, q store.Q, userID uuid.UUID, amountCents int64, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amountCents <= 0 {
		return nil, nil
	}
	existing, err := store.GetLedgerEntry(ctx, q, "freeze", sourceType, sourceID)
	if err != nil || existing != nil {
		return existing, err
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets
		 SET balance_cents = balance_cents - $2,
		     frozen_cents = frozen_cents + $2,
		     updated_at = $3
		 WHERE user_id = $1 AND balance_cents >= $2
		 RETURNING balance_cents + trial_balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			current, walletErr := store.GetWallet(ctx, q, userID)
			if walletErr != nil {
				return nil, walletErr
			}
			if current == nil {
				return nil, apperr.E("not_found", "钱包不存在", 404)
			}
			return nil, apperr.E("insufficient_balance", "普通积分余额不足", 400)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "freeze", -amountCents, balanceAfter, sourceType, strPtr(sourceID), reason, "normal")
}

// ReleaseNormalCredits 释放非图片任务的普通积分预留（失败或取消）。
func ReleaseNormalCredits(ctx context.Context, q store.Q, userID uuid.UUID, amountCents int64, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amountCents <= 0 {
		return nil, nil
	}
	existing, err := store.GetLedgerEntry(ctx, q, "release", sourceType, sourceID)
	if err != nil || existing != nil {
		return existing, err
	}
	freeze, err := store.GetLedgerEntry(ctx, q, "freeze", sourceType, sourceID)
	if err != nil {
		return nil, err
	}
	if freeze == nil {
		return nil, apperr.E("internal_error", "费用未预留，无法退回", 500)
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets
		 SET balance_cents = balance_cents + $2,
		     frozen_cents = frozen_cents - $2,
		     updated_at = $3
		 WHERE user_id = $1 AND frozen_cents >= $2
		 RETURNING balance_cents + trial_balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("internal_error", "冻结余额异常，无法退回", 500)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "release", amountCents, balanceAfter, sourceType, strPtr(sourceID), reason, "normal")
}

// SettleNormalCredits 消耗非图片任务的普通积分预留。部分结算后，调用方应在同一
// 事务内通过 ReleaseNormalCredits 退回剩余预留。
func SettleNormalCredits(ctx context.Context, q store.Q, userID uuid.UUID, amountCents int64, sourceType, sourceID string, reason *string) (*store.LedgerEntry, error) {
	if amountCents <= 0 {
		return nil, nil
	}
	existing, err := store.GetLedgerEntry(ctx, q, "spend", sourceType, sourceID)
	if err != nil || existing != nil {
		return existing, err
	}
	freeze, err := store.GetLedgerEntry(ctx, q, "freeze", sourceType, sourceID)
	if err != nil {
		return nil, err
	}
	if freeze == nil {
		return nil, apperr.E("internal_error", "费用未预留，无法结算", 500)
	}
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets
		 SET frozen_cents = frozen_cents - $2,
		     updated_at = $3
		 WHERE user_id = $1 AND frozen_cents >= $2
		 RETURNING balance_cents + trial_balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("internal_error", "冻结余额异常，无法结算", 500)
		}
		return nil, err
	}
	if reason == nil {
		reason = strPtr(fmt.Sprintf("任务结算：消耗冻结 %d 分", amountCents))
	}
	return store.InsertLedgerEntry(ctx, q, userID, "spend", 0, balanceAfter, sourceType, strPtr(sourceID), reason, "normal")
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
