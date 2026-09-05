// Package assistantbilling binds assistant run state transitions to wallet
// reservation, settlement, and release in the same database transaction.
package assistantbilling

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const SourceType = "assistant_run"

type CancelPolicy struct {
	Allowed           bool   `json:"allowed"`
	Mode              string `json:"mode"`
	UpstreamSubmitted bool   `json:"upstreamSubmitted"`
	Refunded          bool   `json:"refunded"`
	Message           string `json:"message"`
}

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

func isImageRun(run *store.AssistantRun) bool {
	return run != nil && (run.Mode == "image" || run.ResolvedMode == "image")
}

func imageUpstreamSubmitted(run *store.AssistantRun) bool {
	if !isImageRun(run) || run.Status != "running" {
		return false
	}
	switch run.Stage {
	case "submitting-image", "generating-image", "fetching-image", "saving-image":
		return true
	default:
		return false
	}
}

func editableFileUpstreamSubmitted(run *store.AssistantRun) bool {
	if run == nil || run.Status != "running" {
		return false
	}
	switch run.Stage {
	case "submitting-file", "generating-file", "saving-file":
		return true
	default:
		return false
	}
}

func CancelPolicyForRun(run *store.AssistantRun) CancelPolicy {
	policy := CancelPolicy{Mode: "unavailable", Message: "当前阶段不能停止"}
	if run == nil {
		return policy
	}
	if run.Status == "queued" || (isImageRun(run) && run.Status == "running" && !imageUpstreamSubmitted(run)) {
		return CancelPolicy{
			Allowed: true, Mode: "immediate", Refunded: true,
			Message: "任务尚未提交图片上游，停止后冻结积分会立即退回。",
		}
	}
	if run.Status != "running" {
		return policy
	}
	if isImageRun(run) {
		return CancelPolicy{
			Allowed: true, Mode: "abandon_upstream", UpstreamSubmitted: true,
			Message: "图片请求已经提交给上游。停止后平台不再等待或接收结果，但上游可能仍会继续生成，本轮积分不会退回。",
		}
	}
	if editableFileUpstreamSubmitted(run) {
		return CancelPolicy{
			Allowed: true, Mode: "abandon_upstream", UpstreamSubmitted: true,
			Message: "PPT/PSD 制作任务已经提交给上游。停止后平台不再等待或接收文件，但上游可能仍会继续制作，本轮积分不会退回。",
		}
	}
	message := "本轮推理已经开始。停止后将不再接收结果，本轮已使用的积分不会退回。"
	if run.Mode == "agent" && paramString(run.Params, "workspace") == "infinite_canvas" {
		message = "Agent 已经开始执行。停止后会按已完成的画布操作结算，未使用的费用会退回。"
	}
	return CancelPolicy{Allowed: true, Mode: "abandon_execution", UpstreamSubmitted: true, Message: message}
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

func trialFeatureKey(run *store.AssistantRun) string {
	if run == nil {
		return ""
	}
	feature, _ := trialfeature.ForAssistantParams(run.Params)
	return feature.Key
}

func Reserve(ctx context.Context, q store.Q, run *store.AssistantRun) error {
	if run == nil || run.ReservedCents <= 0 {
		return nil
	}
	_, err := wallet.FreezeFeatureCredits(ctx, q, run.UserID, run.ReservedCents, trialFeatureKey(run),
		SourceType, sourceID(run, run.BillingGeneration), strPtr(productReason(run, "%s费用预留")))
	return err
}

func release(ctx context.Context, q store.Q, run *store.AssistantRun, reason string) error {
	if run == nil || run.ReservedCents <= 0 {
		return nil
	}
	_, err := wallet.ReleaseFeatureCredits(ctx, q, run.UserID, run.ReservedCents,
		SourceType, sourceID(run, run.BillingGeneration), strPtr(reason))
	return err
}

// Complete settles only the actual routed cost and returns any over-reservation.
func Complete(ctx context.Context, st *store.Store, id uuid.UUID, resolvedMode string) (bool, error) {
	return CompleteAttempt(ctx, st, id, 0, resolvedMode)
}

func CompleteAttempt(ctx context.Context, st *store.Store, id uuid.UUID, expectedAttempt int, resolvedMode string) (bool, error) {
	return completeAttempt(ctx, st, id, expectedAttempt, resolvedMode, nil)
}

func CompleteImageAttempt(ctx context.Context, st *store.Store, id uuid.UUID, expectedAttempt, actualImages int) (bool, error) {
	if actualImages < 0 {
		return false, apperr.E("assistant_billing_invalid", "AI 助手实际图片数量无效", 500)
	}
	return completeAttempt(ctx, st, id, expectedAttempt, "image", &actualImages)
}

func completeAttempt(ctx context.Context, st *store.Store, id uuid.UUID, expectedAttempt int, resolvedMode string, actualImages *int) (bool, error) {
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
		if resolvedMode == "image" && actualImages != nil {
			requested := paramInt64(run.Params, "count")
			actual := int64(*actualImages)
			if requested <= 0 || actual > requested {
				return apperr.E("assistant_billing_invalid", "AI 助手实际图片数量超过请求数量", 500)
			}
			unit := paramInt64(run.Params, "_billingUnitPriceCents")
			if unit <= 0 {
				unit = paramInt64(run.Params, "_unitPriceCents")
			}
			if unit > 0 {
				cost = unit * actual
			} else if requested > 0 {
				cost = cost * actual / requested
			}
		}
		if cost < 0 || cost > run.ReservedCents {
			return apperr.E("assistant_billing_invalid", "AI 助手结算金额超过预留金额", 500)
		}
		changed, err = store.CompleteAssistantRunAttempt(ctx, tx, id, expectedAttempt, resolvedMode, cost)
		if err != nil || !changed {
			return err
		}
		billingID := sourceID(run, run.BillingGeneration)
		if cost > 0 {
			if _, err := wallet.SettleFeatureCredits(ctx, tx, run.UserID, cost, SourceType, billingID,
				strPtr(productReason(run, "%s结算（%s）", resolvedMode))); err != nil {
				return err
			}
		}
		if remainder := run.ReservedCents - cost; remainder > 0 {
			if _, err := wallet.ReleaseFeatureCredits(ctx, tx, run.UserID, remainder, SourceType, billingID,
				strPtr(productReason(run, "%s按实际模式退回多预留费用"))); err != nil {
				return err
			}
		}
		units := 1
		unitCostKey := "_chatUpstreamUnitCostCents"
		providerKey, modelKey := "_chatProviderConfigId", "_chatModelConfigId"
		if resolvedMode == "image" {
			unitCostKey = "_imageUpstreamUnitCostCents"
			providerKey, modelKey = "_imageProviderConfigId", "_imageModelConfigId"
			if actualImages != nil {
				units = *actualImages
			} else if requested := int(paramInt64(run.Params, "count")); requested > 0 {
				units = requested
			}
		}
		if err := store.InsertUsageProfitEntry(ctx, tx, store.UsageProfitEntry{
			SourceType: SourceType, SourceID: run.ID.String(), BillingGeneration: run.BillingGeneration,
			UserID: run.UserID, EventStatus: "succeeded", Workspace: paramString(run.Params, "workspace"),
			ProviderID: paramString(run.Params, providerKey), ModelID: paramString(run.Params, modelKey), Units: units,
			RevenueCents: cost, UpstreamCostCents: paramInt64(run.Params, unitCostKey) * int64(units),
			Metadata: map[string]any{"mode": resolvedMode}, CreatedAt: time.Now().UTC(),
		}); err != nil {
			return err
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
	unitCostKey := "_chatUpstreamUnitCostCents"
	providerKey, modelKey, units := "_chatProviderConfigId", "_chatModelConfigId", 1
	if run.Mode == "image" {
		unitCostKey = "_imageUpstreamUnitCostCents"
		providerKey, modelKey = "_imageProviderConfigId", "_imageModelConfigId"
		units = max(1, int(paramInt64(run.Params, "count")))
	}
	if run.Attempt > 0 && paramInt64(run.Params, unitCostKey) > 0 {
		if err := store.InsertUsageProfitEntry(ctx, q, store.UsageProfitEntry{
			SourceType: SourceType, SourceID: run.ID.String(), BillingGeneration: run.BillingGeneration,
			UserID: run.UserID, EventStatus: "failed", Workspace: paramString(run.Params, "workspace"),
			ProviderID: paramString(run.Params, providerKey), ModelID: paramString(run.Params, modelKey), Units: units,
			UpstreamCostCents: paramInt64(run.Params, unitCostKey) * int64(units),
			Metadata:          map[string]any{"mode": run.Mode, "errorCode": code}, CreatedAt: time.Now().UTC(),
		}); err != nil {
			return false, err
		}
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
	return CancelUserTxConfirmed(ctx, q, userID, id, true)
}

func CancelUserTxConfirmed(ctx context.Context, q store.Q, userID, id uuid.UUID, acknowledgeUpstream bool) (*store.AssistantRun, bool, error) {
	run, err := store.GetUserAssistantRunForUpdate(ctx, q, userID, id)
	if err != nil || run == nil {
		return run, false, err
	}
	policy := CancelPolicyForRun(run)
	if !policy.Allowed {
		return run, false, nil
	}
	if policy.UpstreamSubmitted && !acknowledgeUpstream {
		return run, false, apperr.E("assistant_cancel_confirmation_required", policy.Message+"请确认后再停止。", 409)
	}
	canvasAgent := run.Mode == "agent" && paramString(run.Params, "workspace") == "infinite_canvas"
	cost := int64(0)
	if policy.UpstreamSubmitted {
		cost = run.ReservedCents
	}
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
		if _, err := wallet.SettleFeatureCredits(ctx, q, run.UserID, cost, SourceType, billingID,
			strPtr(settlementReason)); err != nil {
			return run, false, err
		}
		if remainder := run.ReservedCents - cost; remainder > 0 {
			if _, err := wallet.ReleaseFeatureCredits(ctx, q, run.UserID, remainder, SourceType, billingID,
				strPtr(productReason(run, "%s由用户主动停止，未使用费用已退回"))); err != nil {
				return run, false, err
			}
		}
	} else {
		reason := productReason(run, "%s在提交上游前停止，费用已退回")
		if canvasAgent {
			reason = productReason(run, "%s由用户主动停止，未执行画布操作，费用已退回")
		}
		if err := release(ctx, q, run, reason); err != nil {
			return run, false, err
		}
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
		if _, err := wallet.FreezeFeatureCredits(ctx, q, run.UserID, run.ReservedCents, trialFeatureKey(run),
			SourceType, sourceID(run, nextGeneration), strPtr(productReason(run, "%s重试费用预留"))); err != nil {
			return false, err
		}
	}
	return store.RequeueAssistantRun(ctx, q, run.ID)
}
