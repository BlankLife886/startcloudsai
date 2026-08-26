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
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

var errAssistantRoutesExhausted = errors.New("assistant provider routes exhausted")

type assistantProviderError struct {
	err           error
	outputStarted bool
}

func (e *assistantProviderError) Error() string { return e.err.Error() }
func (e *assistantProviderError) Unwrap() error { return e.err }

func (w *Worker) assistantExecutionCandidates(ctx context.Context, run *store.AssistantRun) ([]modelconfig.Selection, error) {
	prefix := "_chat"
	if run.Mode == "image" {
		prefix = "_image"
	}
	providerID := assistantParamString(run.Params, prefix+"ProviderConfigId", "")
	modelID := assistantParamString(run.Params, prefix+"ModelConfigId", "")
	if providerID == "" || modelID == "" {
		return nil, nil
	}
	cfg, err := w.runtimeModelConfig(ctx)
	if err != nil {
		return nil, err
	}
	routeID := assistantParamString(run.Params, prefix+"ProviderRouteId", "")
	balanceAcrossProviders, err := settings.GetBool(ctx, w.St.Pool, "cross_provider_same_model_balancing_enabled")
	if err != nil {
		return nil, err
	}
	if balanceAcrossProviders {
		unitPrice := assistantParamInt(run.Params, prefix+"ModelEffectivePriceCents", -1)
		if run.Mode == "image" {
			unitPrice = assistantParamInt(run.Params, "_modelEffectivePriceCents",
				assistantParamInt(run.Params, "_billingUnitPriceCents", unitPrice))
		}
		if run.Mode != "image" {
			unitPrice = assistantParamInt(run.Params, "_chatModelEffectivePriceCents",
				assistantParamInt(run.Params, "_agentChatUnitPriceCents",
					assistantParamInt(run.Params, "_chatCostCents", -1)))
		}
		if unitPrice >= 0 {
			return modelconfig.ExecutionCandidatesRouteAcrossProviders(
				cfg, providerID, modelID, routeID, int64(unitPrice),
			), nil
		}
	}
	return modelconfig.ExecutionCandidatesRoute(cfg, providerID, modelID, routeID), nil
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
	candidates, err := w.assistantExecutionCandidates(ctx, queued)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		prefix := "_chat"
		if queued.Mode == "image" {
			prefix = "_image"
		}
		if assistantParamString(queued.Params, prefix+"ProviderConfigId", "") != "" &&
			assistantParamString(queued.Params, prefix+"ModelConfigId", "") != "" {
			return nil, errAssistantRoutesExhausted
		}
		return store.ClaimAssistantRunWithLease(ctx, w.St.Pool, runID, leaseOwner, time.Now().UTC(), taskLease)
	}

	var claimed *store.AssistantRun
	err = w.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockGlobalTaskExecution(ctx, tx); err != nil {
			return err
		}
		routeKeys := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			routeKeys = append(routeKeys, modelconfig.ExecutionRouteKey(candidate.Provider))
		}
		running, err := store.RunningTasksByProvider(ctx, tx, routeKeys)
		if err != nil {
			return err
		}
		assistantRunning, err := store.RunningAssistantRunsByProvider(ctx, tx, routeKeys)
		if err != nil {
			return err
		}
		for key, count := range assistantRunning {
			running[key] += count
		}
		prefix := "_chat"
		failedRouteParam := "_failedChatProviderRouteKeys"
		if queued.Mode == "image" {
			prefix = "_image"
			failedRouteParam = "_failedImageProviderRouteKeys"
		}
		excluded := make(map[string]bool)
		for _, key := range assistantParamStrings(queued.Params, failedRouteParam) {
			excluded[key] = true
		}
		selected, ok := selectExecutionCandidateExcluding(candidates, running, excluded)
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
			prefix + "ModelConfigId":       selected.Model.ID,
			prefix + "Model":               selected.Model.UpstreamModel,
			prefix + "ModelDisplayName":    selected.Model.Name,
			"_modelDisplayName":            selected.Model.Name,
		}
		updated, err := store.SetQueuedAssistantRunExecutionRoute(ctx, tx, runID, route)
		if err != nil || !updated {
			return err
		}
		claimed, err = store.ClaimAssistantRunWithLease(ctx, tx, runID, leaseOwner, time.Now().UTC(), taskLease)
		return err
	})
	return claimed, err
}

func (w *Worker) failQueuedAssistantRun(ctx context.Context, runID uuid.UUID, message string) error {
	failed, err := assistantbilling.Fail(ctx, w.St, runID, "assistant_routes_exhausted", message)
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
	requeued := false
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
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
