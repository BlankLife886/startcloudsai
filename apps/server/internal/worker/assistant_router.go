package worker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

var errAssistantRoutesExhausted = errors.New("assistant provider routes exhausted")

const (
	// 等额度没有次数上限，所以退避会随等待时间翻倍，避免满载的池子被反复空转扫描。
	assistantCapacityWaitBase    = 3 * time.Second
	assistantCapacityWaitCeiling = 30 * time.Second
)

// assistantRunUsesAgentPool 判定这条 run 准入时该不该占 Agent 名额。
//
// 库里存的 mode 不足以回答这个问题：带联网搜索、查任务这类请求的对话轮会在执行时被
// assistantExecutionMode 提升成 Agent，而此刻 resolved_mode 还是空的。只看 mode 的话
// 这些轮次既不过闸也不被计数，真实并发就会悄悄超过上限。所以准入按"这一轮最终会不会
// 走 Agent 路径"来判断，等它跑起来 resolved_mode 落库后，统计那边自然就对得上了。
func assistantRunUsesAgentPool(run *store.AssistantRun) bool {
	if run == nil || store.AssistantRunIsImage(run) {
		return false
	}
	return store.AssistantRunIsAgent(run) || assistantExecutionMode(run.Mode, run.Prompt) == "agent"
}

type assistantProviderError struct {
	err           error
	outputStarted bool
}

func (e *assistantProviderError) Error() string { return e.err.Error() }
func (e *assistantProviderError) Unwrap() error { return e.err }

func (w *Worker) assistantExecutionCandidates(ctx context.Context, run *store.AssistantRun) ([]modelconfig.Selection, error) {
	return w.assistantExecutionCandidatesQ(ctx, w.St.Pool, run)
}

func (w *Worker) assistantExecutionCandidatesQ(ctx context.Context, q store.Q, run *store.AssistantRun) ([]modelconfig.Selection, error) {
	if assistantEditableKind(run) != "" {
		snapshot, err := w.assistantExecutionSnapshotQ(ctx, q, run)
		if err != nil {
			return nil, err
		}
		provider, configured, err := snapshot.EditableProvider(ctx, q, w.Cfg.AppSecret)
		if err != nil {
			return nil, err
		}
		if !configured {
			return nil, errAssistantRoutesExhausted
		}
		return []modelconfig.Selection{{Provider: provider}}, nil
	}
	prefix := "_chat"
	slot := "chat"
	if store.AssistantRunIsImage(run) {
		prefix = "_image"
		slot = "image"
	}
	providerID := assistantParamString(run.Params, prefix+"ProviderConfigId", "")
	modelID := assistantParamString(run.Params, prefix+"ModelConfigId", "")
	routeID := assistantParamString(run.Params, prefix+"ProviderRouteId", "")
	if slot == "image" && (providerID == "" || modelID == "") {
		providerID, modelID = assistantParamString(run.Params, "_providerConfigId", ""), assistantParamString(run.Params, "_modelConfigId", "")
		routeID = assistantParamString(run.Params, "_providerRouteId", "")
	}
	if providerID == "" || modelID == "" {
		return nil, nil
	}
	snapshot, err := w.assistantExecutionSnapshotQ(ctx, q, run)
	if err != nil {
		return nil, err
	}
	if slot == "image" && store.AssistantRunHasKnownImageJobs(run) {
		selection, found, err := snapshot.BoundSelection(slot, providerID, modelID, routeID, w.Cfg.AppSecret)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, errAssistantRoutesExhausted
		}
		return []modelconfig.Selection{*selection}, nil
	}
	return snapshot.RuntimeCandidates(ctx, q, slot, w.Cfg.AppSecret)
}

func (w *Worker) claimAssistantRun(
	ctx context.Context,
	runID uuid.UUID,
	leaseOwner string,
) (*store.AssistantRun, error) {
	queued, err := store.GetAssistantRun(ctx, w.St.Pool, runID)
	if err != nil || queued == nil || queued.Status != "queued" {
		return nil, err
	}
	globals, err := store.GetGlobalExecutionLimits(ctx, w.St.Pool)
	if err != nil {
		return nil, err
	}

	var claimed *store.AssistantRun
	err = w.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockGlobalTaskExecution(ctx, tx); err != nil {
			return err
		}
		if err := store.LockUserTaskExecution(ctx, tx, queued.UserID); err != nil {
			return err
		}
		locked, getErr := store.GetAssistantRunForUpdate(ctx, tx, runID)
		if getErr != nil || locked == nil || locked.Status != "queued" {
			return getErr
		}
		queued = locked
		image := store.AssistantRunIsImage(queued)
		resumeKnown := store.AssistantRunHasKnownImageJobs(queued)
		units := store.AssistantRunWorkUnits(queued)
		dedicatedEditable := assistantEditableKind(queued) != ""
		candidates, candidateErr := w.assistantExecutionCandidatesQ(ctx, tx, queued)
		if candidateErr != nil {
			return candidateErr
		}
		if len(candidates) == 0 {
			prefix := "_chat"
			if image {
				prefix = "_image"
			}
			if assistantParamString(queued.Params, prefix+"ProviderConfigId", "") != "" && assistantParamString(queued.Params, prefix+"ModelConfigId", "") != "" {
				return errAssistantRoutesExhausted
			}
		}
		account, err := store.GetUserConcurrency(ctx, tx, queued.UserID)
		if err != nil {
			return err
		}
		usage, err := store.GetGlobalExecutionUsage(ctx, tx)
		if err != nil {
			return err
		}
		userLimit, userRunning, globalLimit, globalRunning := int64(account.ChatLimit), account.ChatRunning, globals.ChatLimit, usage.ChatRunning
		if image {
			userLimit, userRunning, globalLimit, globalRunning = int64(account.ImageLimit), account.ImageRunning, globals.ImageLimit, usage.ImageRunning
		}
		if resumeKnown {
			userRunning = max(userRunning-units, 0)
			globalRunning = max(globalRunning-units, 0)
		}
		if err := store.CheckExecutionBatchLimits(image, units, userLimit, globalLimit, executionCandidateMaxCapacity(candidates)); err != nil && !resumeKnown {
			return err
		}
		prefix, failedRouteParam := "_chat", "_failedChatProviderRouteKeys"
		if image {
			prefix, failedRouteParam = "_image", "_failedImageProviderRouteKeys"
		}
		excluded := make(map[string]bool)
		for _, key := range assistantParamStrings(queued.Params, failedRouteParam) {
			excluded[key] = true
		}
		if len(candidates) > 0 && !resumeKnown {
			remainingMax, remaining := executionRemainingCapacity(candidates, excluded)
			if remaining == 0 {
				return errAssistantRoutesExhausted
			}
			if units > remainingMax {
				pool := "对话"
				if image {
					pool = "生图"
				}
				return &store.ExecutionBatchCapacityError{Pool: pool, Scope: "剩余单条模型线路", Requested: units, Limit: remainingMax}
			}
		}
		if !resumeKnown && (userRunning+units > userLimit || globalRunning+units > globalLimit) {
			if err := store.InsertAssistantRunOutbox(ctx, tx, runID); err != nil {
				return err
			}
			if err := store.SetAssistantRunQueuedStage(ctx, tx, runID, "waiting-execution-pool"); err != nil {
				return err
			}
			return store.RecordAssistantRunOutboxCapacityWait(ctx, tx, runID,
				"waiting for execution pool capacity", assistantCapacityWaitBase, assistantCapacityWaitCeiling)
		}
		// Agent 走几十步、占住 worker 好几分钟，普通对话几秒就完。共用一个池子时少数
		// Agent 就能占满，所以再给 Agent 单独设一道闸，给普通对话留出拿不走的空位。
		if !image && !resumeKnown && assistantRunUsesAgentPool(queued) {
			agentLimits, err := store.GetAgentExecutionLimits(ctx, tx)
			if err != nil {
				return err
			}
			agentUsage, err := store.GetAgentExecutionUsage(ctx, tx, queued.UserID)
			if err != nil {
				return err
			}
			if agentUsage.UserRunning+1 > agentLimits.UserLimit || agentUsage.GlobalRunning+1 > agentLimits.GlobalLimit {
				if err := store.InsertAssistantRunOutbox(ctx, tx, runID); err != nil {
					return err
				}
				// 等额度可能要等很久，界面只显示"排队中"的话用户不知道自己在等什么。
				if err := store.SetAssistantRunQueuedStage(ctx, tx, runID, "waiting-agent-pool"); err != nil {
					return err
				}
				return store.RecordAssistantRunOutboxCapacityWait(ctx, tx, runID,
					"waiting for agent pool capacity", assistantCapacityWaitBase, assistantCapacityWaitCeiling)
			}
		}
		if len(candidates) == 0 {
			claimLimit := userLimit
			if resumeKnown {
				claimLimit = max(claimLimit, userRunning+units)
			}
			claimed, err = store.ClaimAssistantRunWithLease(ctx, tx, runID, leaseOwner, time.Now().UTC(), taskLease, int(claimLimit))
			return err
		}
		routeKeys := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			routeKeys = append(routeKeys, modelconfig.ExecutionRouteKey(candidate.Provider))
		}
		running, err := store.RunningExecutionUnitsByProvider(ctx, tx, routeKeys)
		if err != nil {
			return err
		}
		selected, ok := selectExecutionCandidateExcluding(candidates, running, excluded, units)
		if resumeKnown {
			selected, ok = &candidates[0], true
			key := modelconfig.ExecutionRouteKey(selected.Provider)
			running[key] = max(running[key]-units, 0)
		}
		if !ok {
			hasUntried := false
			for _, candidate := range candidates {
				if !excluded[modelconfig.ExecutionRouteKey(candidate.Provider)] {
					hasUntried = true
					break
				}
			}
			if !hasUntried {
				return errAssistantRoutesExhausted
			}
			if err := store.InsertAssistantRunOutbox(ctx, tx, runID); err != nil {
				return err
			}
			return store.RecordAssistantRunOutboxFailure(ctx, tx, runID,
				"all assistant provider routes are at capacity", time.Now().UTC().Add(5*time.Second))
		}
		route := map[string]any{
			prefix + "ProviderConfigId":    selected.Provider.ID,
			prefix + "ProviderRouteId":     selected.Provider.RouteID,
			prefix + "ProviderRouteKey":    modelconfig.ExecutionRouteKey(selected.Provider),
			prefix + "ProviderDisplayName": selected.Provider.Name,
			prefix + "ProviderEndpoint":    assistantProviderEndpoint(selected.Provider.BaseURL),
		}
		if !dedicatedEditable {
			route[prefix+"ModelConfigId"] = selected.Model.ID
			route[prefix+"Model"] = selected.Model.UpstreamModel
			route[prefix+"ModelDisplayName"] = selected.Model.Name
			route["_modelDisplayName"] = selected.Model.Name
		}
		updated, err := store.SetQueuedAssistantRunExecutionRoute(ctx, tx, runID, route)
		if err != nil || !updated {
			return err
		}
		claimLimit := userLimit
		if resumeKnown {
			claimLimit = max(claimLimit, userRunning+units)
		}
		claimed, err = store.ClaimAssistantRunWithLease(ctx, tx, runID, leaseOwner, time.Now().UTC(), taskLease, int(claimLimit))
		return err
	})
	return claimed, err
}

func (w *Worker) failQueuedAssistantRun(ctx context.Context, runID uuid.UUID, message string, codes ...string) error {
	code := "assistant_routes_exhausted"
	if len(codes) > 0 {
		code = codes[0]
	}
	failed := false
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		run, err := store.GetAssistantRunForUpdate(ctx, tx, runID)
		if err != nil || run == nil || run.Status != "queued" {
			return err
		}
		failed, err = assistantbilling.FailTx(ctx, tx, runID, code, message)
		return err
	})
	if err != nil || !failed {
		return err
	}
	run, err := store.GetAssistantRun(ctx, w.St.Pool, runID)
	if err != nil || run == nil {
		return err
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, message,
		resolvedAssistantMode(run), "failed", assistantMessageMetadata(run, nil, "failed", message)); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, runID.String(), assistantstream.Event{Done: true, Status: "failed"})
	return nil
}

func (w *Worker) retryAssistantProviderRoute(
	ctx context.Context,
	run *store.AssistantRun,
	executionErr error,
) (bool, error) {
	if run == nil || isCanvasWorkspaceRun(run) {
		return false, nil
	}
	if store.AssistantRunHasKnownImageJobs(run) {
		// A timeout while polling is not evidence that the provider stopped.
		// Preserve known job IDs instead of clearing them and launching another
		// generation on an alternate route. Explicit failed-run retry is separate.
		return false, nil
	}
	// These requests may already have generated work without a recoverable ID.
	// Check the outer marker before unwrapping timeout/HTTP errors for failover.
	var uncertainCRUN *crun.SubmissionUncertainError
	var synchronousC2A *c2a.SynchronousImageError
	if errors.As(executionErr, &uncertainCRUN) || errors.As(executionErr, &synchronousC2A) {
		return false, nil
	}
	retryable := sub2api.RetryableOnAlternateRoute(ctx, executionErr)
	if run.Mode == "image" {
		retryable = c2a.IsRetryableError(executionErr) || crun.IsRetryableError(executionErr) ||
			errors.Is(executionErr, context.DeadlineExceeded)
	} else if run.Mode != "chat" && run.Mode != "agent" {
		return false, nil
	}
	if !retryable {
		return false, nil
	}
	var providerErr *assistantProviderError
	if errors.As(executionErr, &providerErr) && providerErr.outputStarted {
		return false, nil
	}
	prefix := "_chat"
	failedRouteParam := "_failedChatProviderRouteKeys"
	if run.Mode == "image" {
		prefix = "_image"
		failedRouteParam = "_failedImageProviderRouteKeys"
	}
	routeKey := assistantParamString(run.Params, prefix+"ProviderRouteKey", "")
	if routeKey == "" {
		return false, nil
	}
	failedKeys := assistantParamStrings(run.Params, failedRouteParam)
	for _, key := range failedKeys {
		if key == routeKey {
			return false, nil
		}
	}
	failedKeys = append(failedKeys, routeKey)
	candidates, err := w.assistantExecutionCandidates(ctx, run)
	if err != nil {
		return false, err
	}
	hasAlternate := false
	for _, candidate := range candidates {
		candidateKey := modelconfig.ExecutionRouteKey(candidate.Provider)
		if candidateKey == routeKey {
			continue
		}
		failed := false
		for _, key := range failedKeys {
			if key == candidateKey {
				failed = true
				break
			}
		}
		if !failed {
			hasAlternate = true
			break
		}
	}
	if !hasAlternate {
		return false, nil
	}
	requeued := false
	err = w.St.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		requeued, err = store.RequeueRunningAssistantRunForRouteFailoverWithKey(
			ctx, tx, run.ID, run.Attempt, failedRouteParam, failedKeys,
		)
		if err != nil || !requeued {
			return err
		}
		if err := store.InsertAssistantRunOutbox(ctx, tx, run.ID); err != nil {
			return err
		}
		if err := store.RecordAssistantRunOutboxFailure(ctx, tx, run.ID,
			fmt.Sprintf("route %s failed: %s", routeKey, sanitizeUpstreamMessage(executionErr.Error())),
			time.Now().UTC().Add(time.Second)); err != nil {
			return err
		}
		metadata := assistantMessageMetadata(run, nil, "routing", "")
		metadata["providerFailover"] = true
		return store.UpdateAssistantMessage(ctx, tx, run.AssistantMessageID, "", run.Mode, "queued", metadata)
	})
	return requeued, err
}

func assistantRouteDescription(run *store.AssistantRun) string {
	if run == nil {
		return ""
	}
	prefix := "_chat"
	if run.Mode == "image" {
		prefix = "_image"
	}
	parts := []string{
		assistantParamString(run.Params, prefix+"ProviderDisplayName", ""),
		assistantParamString(run.Params, prefix+"ProviderRouteKey", ""),
	}
	return strings.Trim(strings.Join(parts, " "), " ")
}
