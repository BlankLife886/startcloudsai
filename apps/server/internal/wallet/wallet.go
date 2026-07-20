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
		`UPDATE wallets SET balance_cents = balance_cents + $2, updated_at = $3 WHERE user_id = $1 RETURNING balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("not_found", "钱包不存在", 404)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, kind, amountCents, balanceAfter, sourceType, strPtr(sourceID), reason)
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
	sql += ` RETURNING balance_cents`
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
	return store.InsertLedgerEntry(ctx, q, userID, "admin_adjust", deltaCents, balanceAfter, "admin", strPtr(sourceID), strPtr(reason))
}

func taskSourceID(taskID uuid.UUID, generation int) string {
	if generation == 0 {
		return taskID.String()
	}
	return fmt.Sprintf("%s/%d", taskID, generation)
}

// FreezeForTask 冻结任务费用：余额不足返回 insufficient_balance。
func FreezeForTask(ctx context.Context, q store.Q, userID, taskID uuid.UUID, amountCents int64, reason *string) (*store.LedgerEntry, error) {
	gen, err := store.CountTaskLedger(ctx, q, taskID, "freeze")
	if err != nil {
		return nil, err
	}
	sourceID := taskSourceID(taskID, gen)
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets SET balance_cents = balance_cents - $2, frozen_cents = frozen_cents + $2, updated_at = $3
		 WHERE user_id = $1 AND balance_cents >= $2 RETURNING balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("insufficient_balance", "余额不足", 400)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "freeze", -amountCents, balanceAfter, "task", strPtr(sourceID), reason)
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
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets SET balance_cents = balance_cents + $2, frozen_cents = frozen_cents - $2, updated_at = $3
		 WHERE user_id = $1 AND frozen_cents >= $2 RETURNING balance_cents`,
		userID, amountCents, now()).Scan(&balanceAfter)
	if err != nil {
		if isNoRows(err) {
			return nil, apperr.E("internal_error", "冻结余额异常，无法解冻", 500)
		}
		return nil, err
	}
	return store.InsertLedgerEntry(ctx, q, userID, "release", amountCents, balanceAfter, "task", strPtr(sourceID), reason)
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
	var balanceAfter int64
	err = q.QueryRow(ctx,
		`UPDATE wallets SET frozen_cents = frozen_cents - $2, updated_at = $3
		 WHERE user_id = $1 AND frozen_cents >= $2 RETURNING balance_cents`,
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
	return store.InsertLedgerEntry(ctx, q, userID, "spend", 0, balanceAfter, "task", strPtr(taskID.String()), reason)
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
