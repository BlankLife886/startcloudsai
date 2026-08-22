// Package assistantbilling binds assistant run state transitions to wallet
// reservation, settlement, and release in the same database transaction.
package assistantbilling

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const SourceType = "assistant_run"

func strPtr(value string) *string { return &value }

func sourceID(run *store.AssistantRun, generation int) string {
	if generation <= 0 {
		return run.ID.String()
	}
	return fmt.Sprintf("%s/%d", run.ID, generation)
}

func paramInt64(params map[string]any, key string) int64 {
	value := params[key]
	switch n := value.(type) {
	case int:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	case float32:
		return int64(n)
	default:
		return 0
	}
}

func paramString(params map[string]any, key string) string {
	value, _ := params[key].(string)
	return value
}

func hasBillableCanvasAgentAction(ctx context.Context, q store.Q, run *store.AssistantRun) (bool, error) {
	if run == nil || run.Mode != "agent" || paramString(run.Params, "workspace") != "infinite_canvas" {
		return false, nil
	}
	message, err := store.GetAssistantMessage(ctx, q, run.AssistantMessageID)
	if err != nil || message == nil {
		return false, err
	}
	billable, _ := message.Metadata["agentBillableAction"].(bool)
	return billable, nil
}

// ResolvedCost returns the final charge for the worker's authoritative route.
func ResolvedCost(run *store.AssistantRun, resolvedMode string) int64 {
	if run == nil {
		return 0
	}
	if resolvedMode == "image" {
		return paramInt64(run.Params, "_imageCostCents")
	}
	return paramInt64(run.Params, "_chatCostCents")
}

func productName(run *store.AssistantRun) string {
	if run == nil {
		return "AI 助手"
	}
	return store.AssistantProductName(run.Params)
}

func productReason(run *store.AssistantRun, format string, args ...any) string {
	all := append([]any{productName(run)}, args...)
	return fmt.Sprintf(format, all...)
}

func Reserve(ctx context.Context, q store.Q, run *store.AssistantRun) error {
	if run == nil || run.ReservedCents <= 0 {
		return nil
	}
	_, err := wallet.FreezeNormalCredits(ctx, q, run.UserID, run.ReservedCents,
		SourceType, sourceID(run, run.BillingGeneration), strPtr(productReason(run, "%s费用预留")))
	return err
}

func release(ctx context.Context, q store.Q, run *store.AssistantRun, reason string) error {
	if run == nil || run.ReservedCents <= 0 {
		return nil
	}
	_, err := wallet.ReleaseNormalCredits(ctx, q, run.UserID, run.ReservedCents,
		SourceType, sourceID(run, run.BillingGeneration), strPtr(reason))
	return err
}

// Complete settles only the actual routed cost and returns any over-reservation.
func Complete(ctx context.Context, st *store.Store, id uuid.UUID, resolvedMode string) (bool, error) {
	return CompleteAttempt(ctx, st, id, 0, resolvedMode)
}

func CompleteAttempt(ctx context.Context, st *store.Store, id uuid.UUID, expectedAttempt int, resolvedMode string) (bool, error) {
	changed := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		run, err := store.GetAssistantRunForUpdate(ctx, tx, id)
		if err != nil || run == nil {
			return err
		}
		if run.Status != "running" {
			return nil
		}
		if expectedAttempt > 0 && run.Attempt != expectedAttempt {
			return nil
		}
		cost := ResolvedCost(run, resolvedMode)
		if cost < 0 || cost > run.ReservedCents {
			return apperr.E("assistant_billing_invalid", "AI 助手结算金额超过预留金额", 500)
		}
		changed, err = store.CompleteAssistantRunAttempt(ctx, tx, id, expectedAttempt, resolvedMode, cost)
		if err != nil || !changed {
			return err
		}
		billingID := sourceID(run, run.BillingGeneration)
		if cost > 0 {
			if _, err := wallet.SettleNormalCredits(ctx, tx, run.UserID, cost, SourceType, billingID,
				strPtr(productReason(run, "%s结算（%s）", resolvedMode))); err != nil {
				return err
			}
		}
		if remainder := run.ReservedCents - cost; remainder > 0 {
			if _, err := wallet.ReleaseNormalCredits(ctx, tx, run.UserID, remainder, SourceType, billingID,
				strPtr(productReason(run, "%s按实际模式退回多预留费用"))); err != nil {
				return err
			}
		}
		return nil
	})
	return changed, err
}

func Fail(ctx context.Context, st *store.Store, id uuid.UUID, code, message string) (bool, error) {
	changed := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		changed, err = FailTx(ctx, tx, id, code, message)
		return err
	})
	return changed, err
}

func FailTx(ctx context.Context, q store.Q, id uuid.UUID, code, message string) (bool, error) {
	return FailTxAttempt(ctx, q, id, 0, code, message)
}

func FailTxAttempt(ctx context.Context, q store.Q, id uuid.UUID, expectedAttempt int, code, message string) (bool, error) {
	run, err := store.GetAssistantRunForUpdate(ctx, q, id)
	if err != nil || run == nil {
		return false, err
	}
	if expectedAttempt > 0 && run.Attempt != expectedAttempt {
		return false, nil
	}
	changed, err := store.FailAssistantRunAttempt(ctx, q, id, expectedAttempt, code, message)
	if err != nil || !changed {
		return changed, err
	}
	if err := release(ctx, q, run, productReason(run, "%s失败，费用已退回")); err != nil {
		return false, err
	}
	latest, err := store.GetAssistantRun(ctx, q, id)
	if err != nil {
		return false, err
	}
	if _, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, q, latest, nil); err != nil {
		return false, err
	}
	return true, nil
}

func CancelUser(ctx context.Context, st *store.Store, userID, id uuid.UUID) (*store.AssistantRun, bool, error) {
	var run *store.AssistantRun
	changed := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		run, changed, err = CancelUserTx(ctx, tx, userID, id)
		return err
	})
	return run, changed, err
}

func CancelUserTx(ctx context.Context, q store.Q, userID, id uuid.UUID) (*store.AssistantRun, bool, error) {
	run, err := store.GetUserAssistantRunForUpdate(ctx, q, userID, id)
	if err != nil || run == nil {
		return run, false, err
	}
	canvasAgent := run.Mode == "agent" && paramString(run.Params, "workspace") == "infinite_canvas"
	cost := run.ReservedCents
	if canvasAgent {
		billable, err := hasBillableCanvasAgentAction(ctx, q, run)
		if err != nil {
			return run, false, err
		}
		cost = 0
		if billable {
			cost = ResolvedCost(run, "chat")
		}
	}
	if cost < 0 || cost > run.ReservedCents {
		return run, false, apperr.E("assistant_billing_invalid", "AI 助手结算金额超过预留金额", 500)
	}
	var changed bool
	if cost > 0 {
		changed, err = store.CancelAssistantRunWithCost(ctx, q, userID, id, cost)
	} else {
		changed, err = store.CancelAssistantRun(ctx, q, userID, id)
	}
	if err != nil || !changed {
		return run, changed, err
	}
	if cost > 0 {
		billingID := sourceID(run, run.BillingGeneration)
		settlementReason := productReason(run, "%s由用户主动停止，本轮积分不退还")
		if canvasAgent {
			settlementReason = productReason(run, "%s由用户主动停止，按已完成画布操作结算")
		}
		if _, err := wallet.SettleNormalCredits(ctx, q, run.UserID, cost, SourceType, billingID,
			strPtr(settlementReason)); err != nil {
			return run, false, err
		}
		if remainder := run.ReservedCents - cost; remainder > 0 {
			if _, err := wallet.ReleaseNormalCredits(ctx, q, run.UserID, remainder, SourceType, billingID,
				strPtr(productReason(run, "%s由用户主动停止，未使用费用已退回"))); err != nil {
				return run, false, err
			}
		}
	} else if err := release(ctx, q, run, productReason(run, "%s由用户主动停止，未执行画布操作，费用已退回")); err != nil {
		return run, false, err
	}
	latest, syncErr := store.GetAssistantRun(ctx, q, id)
	if syncErr != nil {
		return run, false, syncErr
	}
	if _, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, q, latest, nil); err != nil {
		return run, false, err
	}
	return run, true, nil
}

func CancelAdminQueued(ctx context.Context, st *store.Store, id uuid.UUID) (*store.AssistantRun, bool, error) {
	var run *store.AssistantRun
	changed := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		run, changed, err = CancelAdminQueuedTx(ctx, tx, id)
		return err
	})
	return run, changed, err
}

func CancelAdminQueuedTx(ctx context.Context, q store.Q, id uuid.UUID) (*store.AssistantRun, bool, error) {
	run, err := store.GetAssistantRunForUpdate(ctx, q, id)
	if err != nil || run == nil {
		return run, false, err
	}
	changed, err := store.AdminCancelAssistantRun(ctx, q, id)
	if err != nil || !changed {
		return run, changed, err
	}
	if err := release(ctx, q, run, productReason(run, "%s已被管理员取消，费用已退回")); err != nil {
		return run, false, err
	}
	latest, syncErr := store.GetAssistantRun(ctx, q, id)
	if syncErr != nil {
		return run, false, syncErr
	}
	if _, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, q, latest, nil); err != nil {
		return run, false, err
	}
	return run, true, nil
}

func ForceFailAdmin(ctx context.Context, st *store.Store, id uuid.UUID) (*store.AssistantRun, bool, error) {
	var run *store.AssistantRun
	changed := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		run, changed, err = ForceFailAdminTx(ctx, tx, id)
		return err
	})
	return run, changed, err
}

func ForceFailAdminTx(ctx context.Context, q store.Q, id uuid.UUID) (*store.AssistantRun, bool, error) {
	run, err := store.GetAssistantRunForUpdate(ctx, q, id)
	if err != nil || run == nil {
		return run, false, err
	}
	changed, err := store.AdminForceFailAssistantRun(ctx, q, id)
	if err != nil || !changed {
		return run, changed, err
	}
	if err := release(ctx, q, run, productReason(run, "%s被管理员终止，费用已退回")); err != nil {
		return run, false, err
	}
	latest, syncErr := store.GetAssistantRun(ctx, q, id)
	if syncErr != nil {
		return run, false, syncErr
	}
	if _, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, q, latest, nil); err != nil {
		return run, false, err
	}
	return run, true, nil
}

// Requeue refreezes the same maximum amount under a new billing generation.
func Requeue(ctx context.Context, q store.Q, run *store.AssistantRun) (bool, error) {
	if run == nil || run.Status != "failed" {
		return false, nil
	}
	nextGeneration := run.BillingGeneration + 1
	if run.ReservedCents > 0 {
		if _, err := wallet.FreezeNormalCredits(ctx, q, run.UserID, run.ReservedCents,
			SourceType, sourceID(run, nextGeneration), strPtr(productReason(run, "%s重试费用预留"))); err != nil {
			return false, err
		}
	}
	return store.RequeueAssistantRun(ctx, q, run.ID)
}
