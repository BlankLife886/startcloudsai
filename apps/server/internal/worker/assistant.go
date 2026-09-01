package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/platformlog"
	"github.com/BlankLife886/startcloudsai/server/internal/prompt"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

const (
	assistantOutputLimit             = 32 << 20
	assistantC2AItemAttempts         = 2
	assistantChatAttempts            = 2
	assistantSynchronousImageLimit   = 5 * time.Minute
	assistantReferenceModeShared     = "shared"
	assistantReferenceModeIndividual = "individual"
	assistantPromptModeFaithful      = "faithful"
	assistantPromptModeEnhanced      = "enhanced"
)

const assistantChatRetryInstruction = `直接回答用户的问题。不要调用、模拟或输出 search 等内部工具调用语法，也不要复述用户提示词。`

var errAssistantLeakedToolOutput = errors.New("上游模型连续返回了无效的内部工具调用，未生成可用回答，请重试或切换模型")

type assistantC2AImageResult struct {
	index   int
	encoded string
	err     error
}

type assistantSub2ImageResult struct {
	index int
	image sub2api.Image
	err   error
}

type assistantImageExecutionItem struct {
	Title            string
	Prompt           string
	ReferenceIndexes []int
}

type assistantStorageError struct{ err error }

func (e *assistantStorageError) Error() string { return e.err.Error() }
func (e *assistantStorageError) Unwrap() error { return e.err }

func assistantFailureCode(err error) string {
	var storageErr *assistantStorageError
	if errors.As(err, &storageErr) {
		return "storage_unavailable"
	}
	var networkErr *c2a.NetworkError
	if errors.As(err, &networkErr) {
		if networkErr.Timeout() {
			return "upstream_timeout"
		}
		return "upstream_unavailable"
	}
	var c2aErr *c2a.UpstreamError
	if errors.As(err, &c2aErr) {
		switch {
		case c2aErr.StatusCode == http.StatusTooManyRequests:
			return "upstream_rate_limited"
		case c2aErr.StatusCode == http.StatusUnauthorized || c2aErr.StatusCode == http.StatusForbidden:
			return "upstream_auth_failed"
		case c2aErr.StatusCode >= http.StatusInternalServerError:
			return "upstream_unavailable"
		default:
			return "upstream_rejected"
		}
	}
	var crunErr *crun.UpstreamError
	if errors.As(err, &crunErr) {
		switch {
		case crunErr.Status == http.StatusTooManyRequests:
			return "upstream_rate_limited"
		case crunErr.Status == http.StatusUnauthorized || crunErr.Status == http.StatusForbidden:
			return "upstream_auth_failed"
		case crunErr.Status >= http.StatusInternalServerError || crunErr.Code == 455:
			return "upstream_unavailable"
		default:
			return "upstream_rejected"
		}
	}
	return sub2api.FailureCode(err)
}

func (w *Worker) recoverAssistantRuns(ctx context.Context) error {
	running, err := store.RequeueExpiredAssistantRuns(ctx, w.St.Pool, time.Now().UTC())
	if err != nil {
		return err
	}
	queued, err := store.ListQueuedAssistantRunIDs(ctx, w.St.Pool, 500)
	if err != nil {
		return err
	}
	seen := make(map[uuid.UUID]bool, len(running))
	for _, id := range running {
		seen[id] = true
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			log.Printf("recover assistant run %s failed: %v", id, err)
			continue
		}
		_ = store.DeleteAssistantRunOutbox(ctx, w.St.Pool, id)
	}
	for _, id := range queued {
		if seen[id] {
			continue
		}
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			log.Printf("recover queued assistant run %s failed: %v", id, err)
			continue
		}
		_ = store.DeleteAssistantRunOutbox(ctx, w.St.Pool, id)
	}
	return w.dispatchAssistantRunOutbox(ctx)
}

func (w *Worker) dispatchAssistantRunOutbox(ctx context.Context) error {
	ids, err := store.ListReadyAssistantRunOutboxIDs(ctx, w.St.Pool, time.Now().UTC(), 200)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := w.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
			_ = store.RecordAssistantRunOutboxFailure(ctx, w.St.Pool, id, err.Error(), time.Now().UTC().Add(5*time.Second))
			continue
		}
		if err := store.DeleteAssistantRunOutbox(ctx, w.St.Pool, id); err != nil {
			log.Printf("assistant run %s outbox cleanup failed: %v", id, err)
		}
	}
	return nil
}

func (w *Worker) handleDispatchAssistantOutbox(ctx context.Context, _ *asynq.Task) error {
	return w.dispatchAssistantRunOutbox(ctx)
}

func (w *Worker) assistantClient(ctx context.Context) (*sub2api.Client, error) {
	resolved, err := settings.ResolveSub2API(ctx, w.St.Pool, settings.Sub2APIConfig{
		BaseURL: w.Cfg.Sub2APIBaseURL, APIKey: w.Cfg.Sub2APIAPIKey,
		ChatModel: w.Cfg.Sub2APIChatModel, ImageModel: w.Cfg.Sub2APIImageModel,
		TimeoutSecs: w.Cfg.Sub2APITimeoutSecs,
	}, w.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	client, err := sub2api.New(resolved.BaseURL, resolved.APIKey, resolved.ChatModel, resolved.ImageModel, resolved.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if !client.Configured() {
		return nil, errors.New("AI service is not configured")
	}
	return client, nil
}

func (w *Worker) handleRunAssistant(ctx context.Context, task *asynq.Task) error {
	var payload taskflow.RunAssistantPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("bad assistant payload: %w", err)
	}
	runID, err := uuid.Parse(payload.RunID)
	if err != nil {
		return fmt.Errorf("bad assistant run id: %w", err)
	}
	leaseOwner := w.workerID + ":assistant:" + uuid.NewString()
	run, err := w.claimAssistantRun(ctx, runID, leaseOwner)
	if errors.Is(err, errAssistantRoutesExhausted) {
		w.Logs.Record(ctx, platformlog.Event{Category: "operations", Level: "error", Event: "assistant.routes_exhausted", Message: "AI 助手可用线路已耗尽", TaskID: &runID})
		return w.failQueuedAssistantRun(ctx, runID, "所选模型的可用线路均已失败，请稍后重试或切换模型")
	}
	if err != nil || run == nil {
		if err == nil {
			_ = store.InsertAssistantRunOutbox(ctx, w.St.Pool, runID)
			_ = store.RecordAssistantRunOutboxFailure(ctx, w.St.Pool, runID,
				"waiting for earlier conversation task", time.Now().UTC().Add(2*time.Second))
		}
		return err
	}
	defer func() {
		dispatchCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if dispatchErr := w.dispatchAssistantRunOutbox(dispatchCtx); dispatchErr != nil {
			log.Printf("assistant queue follow-up dispatch failed: %v", dispatchErr)
		}
	}()
	started := time.Now()
	w.Logs.Record(ctx, platformlog.Event{
		Category: "operations", Level: "info", Event: "assistant.started",
		Message: "AI 助手任务开始执行", UserID: &run.UserID, TaskID: &run.ID,
		Metadata: map[string]any{"mode": run.Mode, "resolvedMode": run.ResolvedMode, "attempt": run.Attempt},
	})
	if err := store.BeginAssistantRunAttempt(ctx, w.St.Pool, run); err != nil {
		log.Printf("assistant run %s attempt %d trace start failed: %v", run.ID, run.Attempt, err)
	}
	workCtx, cancelWork := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		w.heartbeatAssistantRunLease(workCtx, run, leaseOwner, cancelWork)
	}()
	err = w.executeAssistantRun(workCtx, run)
	cancelWork()
	<-heartbeatDone
	if err == nil {
		w.finishAssistantRunAttempt(run, "succeeded", "", "")
		durationMs := time.Since(started).Milliseconds()
		w.Logs.Record(ctx, platformlog.Event{
			Category: "operations", Level: "info", Event: "assistant.succeeded",
			Message: "AI 助手任务执行成功", UserID: &run.UserID, TaskID: &run.ID, DurationMs: &durationMs,
			Metadata: map[string]any{"mode": resolvedAssistantMode(run), "attempt": run.Attempt},
		})
		return nil
	}
	failoverCtx, cancelFailover := context.WithTimeout(context.Background(), 30*time.Second)
	requeued, failoverErr := w.retryAssistantProviderRoute(failoverCtx, run, err)
	cancelFailover()
	if failoverErr != nil {
		return failoverErr
	}
	if requeued {
		w.finishAssistantRunAttempt(run, "requeued", "provider_route_failed", sanitizeUpstreamMessage(err.Error()))
		log.Printf("assistant run %s switching provider route after %s", run.ID, assistantRouteDescription(run))
		durationMs := time.Since(started).Milliseconds()
		w.Logs.Record(ctx, platformlog.Event{
			Category: "operations", Level: "warning", Event: "assistant.route_requeued",
			Message: "AI 助手线路失败，已切换线路重试", UserID: &run.UserID, TaskID: &run.ID, DurationMs: &durationMs,
			Metadata: map[string]any{"attempt": run.Attempt},
		})
		return nil
	}

	current, getErr := store.GetAssistantRun(context.Background(), w.St.Pool, runID)
	if getErr == nil && current != nil {
		if current.Status == "canceled" {
			w.finishAssistantRunAttempt(run, "canceled", "assistant_run_canceled", "")
			_ = w.clearAssistantMessageOutputMetadata(run, "已停止生成", resolvedAssistantMode(run), "stopped",
				assistantMessageMetadata(run, nil, "stopped", ""))
			assistantstream.Publish(context.Background(), w.Stream, runID.String(),
				assistantstream.Event{Done: true, Status: "canceled"})
			durationMs := time.Since(started).Milliseconds()
			w.Logs.Record(ctx, platformlog.Event{
				Category: "operations", Level: "warning", Event: "assistant.canceled",
				Message: "AI 助手任务已取消", UserID: &run.UserID, TaskID: &run.ID, DurationMs: &durationMs,
			})
			return nil
		}
		if current.Status == "failed" {
			code, message := "assistant_run_failed", ""
			if current.ErrorCode != nil {
				code = *current.ErrorCode
			}
			if current.ErrorMessage != nil {
				message = *current.ErrorMessage
			}
			w.finishAssistantRunAttempt(run, "failed", code, message)
			durationMs := time.Since(started).Milliseconds()
			w.Logs.Record(ctx, platformlog.Event{
				Category: "operations", Level: "error", Event: "assistant.failed",
				Message: "AI 助手任务执行失败", UserID: &run.UserID, TaskID: &run.ID, DurationMs: &durationMs,
				Metadata: map[string]any{"errorCode": code, "attempt": run.Attempt},
			})
			return nil
		}
		if current.Attempt != run.Attempt || current.Status != "running" {
			w.finishAssistantRunAttempt(run, "superseded", "attempt_superseded", "")
			return nil
		}
	}
	failureCode := assistantFailureCode(err)
	log.Printf("assistant run %s attempt %d failed (%s): %v", run.ID, run.Attempt, failureCode, err)
	message := sanitizeUpstreamMessage(err.Error())
	failureCtx, cancelFailure := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelFailure()
	var failed bool
	var failedContent string
	failErr := w.St.Tx(failureCtx, func(tx pgx.Tx) error {
		var err error
		failed, err = assistantbilling.FailTxAttempt(failureCtx, tx, runID, run.Attempt, failureCode, message)
		if err != nil || !failed {
			return err
		}
		if partial, partialErr := store.GetAssistantMessage(failureCtx, tx, run.AssistantMessageID); partialErr != nil {
			return partialErr
		} else if partial != nil && strings.TrimSpace(partial.Content) != "" &&
			strings.TrimSpace(partial.Content) != strings.TrimSpace(message) {
			failedContent = partial.Content
		}
		return w.clearAssistantMessageOutputMetadataTx(failureCtx, tx, run, failedContent,
			resolvedAssistantMode(run), "failed", assistantMessageMetadata(run, nil, "failed", message))
	})
	if failErr != nil {
		return failErr
	}
	if !failed {
		return nil
	}
	w.finishAssistantRunAttempt(run, "failed", failureCode, message)
	durationMs := time.Since(started).Milliseconds()
	w.Logs.Record(ctx, platformlog.Event{
		Category: "operations", Level: "error", Event: "assistant.failed",
		Message: "AI 助手任务执行失败", UserID: &run.UserID, TaskID: &run.ID, DurationMs: &durationMs,
		Metadata: map[string]any{"errorCode": failureCode, "attempt": run.Attempt},
	})
	if history, histErr := store.GetTaskByIdemKey(failureCtx, w.St.Pool, run.UserID, store.UIDesignAssetHistoryIdempotencyKey(runID)); histErr == nil && history != nil {
		w.publishTaskEvent(failureCtx, history, taskstream.Event{Stage: "failed", Status: "failed", Done: true})
	}
	assistantstream.Publish(context.Background(), w.Stream, runID.String(),
		assistantstream.Event{Done: true, Status: "failed"})
	return nil
}

func (w *Worker) finishAssistantRunAttempt(run *store.AssistantRun, status, code, message string) {
	if w == nil || w.St == nil || run == nil || run.Attempt <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if strings.TrimSpace(message) != "" {
		message = sanitizeUpstreamMessage(message)
	}
	if _, err := store.FinishAssistantRunAttempt(ctx, w.St.Pool, run.ID, run.Attempt,
		status, resolvedAssistantMode(run), code, message); err != nil {
		log.Printf("assistant run %s attempt %d trace finish failed: %v", run.ID, run.Attempt, err)
	}
}

func (w *Worker) heartbeatAssistantRunLease(
	ctx context.Context,
	run *store.AssistantRun,
	owner string,
	cancelWork context.CancelFunc,
) {
	ticker := time.NewTicker(taskHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			ok, err := store.RenewAssistantRunLease(ctx, w.St.Pool, run.ID, run.Attempt, owner, now.UTC(), taskLease)
			if err != nil {
				log.Printf("assistant run %s lease heartbeat failed: %v", run.ID, err)
				continue
			}
			if !ok {
				log.Printf("assistant run %s lease was lost", run.ID)
				cancelWork()
				return
			}
		}
	}
}

func (w *Worker) setAssistantRunStage(ctx context.Context, run *store.AssistantRun, resolvedMode, stage string) error {
	changed, err := store.SetAssistantRunStageAttempt(ctx, w.St.Pool, run.ID, run.Attempt, resolvedMode, stage)
	if err != nil {
		return err
	}
	if !changed {
		return context.Canceled
	}
	run.ResolvedMode = resolvedMode
	run.Stage = stage
	return nil
}

func (w *Worker) setAssistantImageStage(ctx context.Context, run *store.AssistantRun, stage string, images []map[string]any) error {
	if err := w.setAssistantRunStage(ctx, run, "image", stage); err != nil {
		return err
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
		assistantMessageMetadata(run, images, stage, "")); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: "image", Stage: stage})
	return nil
}

func (w *Worker) clearAssistantMessageOutputMetadata(run *store.AssistantRun, content, kind, status string, metadata map[string]any) error {
	if w == nil || w.St == nil || run == nil {
		return errors.New("assistant output cleanup store is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return w.St.Tx(ctx, func(tx pgx.Tx) error {
		return w.clearAssistantMessageOutputMetadataTx(ctx, tx, run, content, kind, status, metadata)
	})
}

func (w *Worker) clearAssistantMessageOutputMetadataTx(ctx context.Context, q store.Q, run *store.AssistantRun, content, kind, status string, metadata map[string]any) error {
	if w == nil || w.St == nil || run == nil {
		return errors.New("assistant output cleanup store is unavailable")
	}
	preserved := make(map[string]any, len(metadata)+1)
	for key, value := range metadata {
		preserved[key] = value
	}
	message, err := store.GetAssistantMessage(ctx, q, run.AssistantMessageID)
	if err != nil {
		return err
	}
	if message != nil {
		if artifacts, ok := message.Metadata["artifacts"]; ok {
			preserved["artifacts"] = artifacts
		}
	}
	return store.ClearAssistantMessageOutputMetadata(ctx, q, run.UserID, run.AssistantMessageID,
		content, kind, status, preserved)
}

func (w *Worker) executeAssistantRun(ctx context.Context, run *store.AssistantRun) error {
	mode := assistantExecutionMode(run.Mode, run.Prompt)
	if mode == "image" {
		if err := w.setAssistantImageStage(ctx, run, "preparing-image", nil); err != nil {
			return err
		}
	}
	references, err := w.loadAssistantReferences(ctx, run.Params)
	if err != nil {
		return err
	}
	if mode != "image" && !isCanvasWorkspaceRun(run) && len(assistantRunFileIDs(run)) == 0 {
		if kind := assistanttools.EditableFileKindRequested(run.Prompt); kind != "" {
			return w.executeAssistantEditableFile(ctx, run, references, kind)
		}
	}
	var client *sub2api.Client
	if mode == "agent" {
		selection, configured, selectionErr := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
		if selectionErr != nil {
			return selectionErr
		}
		if configured {
			client, err = w.configuredAssistantChatClient(selection)
		} else {
			client, err = w.assistantClient(ctx)
			if err == nil {
				if requestedModel := assistantParamString(run.Params, "model", ""); requestedModel != "" && requestedModel != client.ImageModel() {
					client = client.WithChatModel(requestedModel)
				}
			}
		}
		if err != nil {
			return err
		}
		client = client.WithMaxOutputTokens(
			assistantParamInt(run.Params, "_chatMaxOutputTokens", assistantDefaultOutputTokens),
		).WithReasoningEffort(assistantParamString(run.Params, "reasoningEffort", ""))
		if assistantArtifactRequested(run.Prompt) && !isCanvasWorkspaceRun(run) {
			run.ResolvedMode = "chat"
			stage := "preparing-context"
			if len(references) > 0 {
				stage = "analyzing-image"
			}
			if err := w.setAssistantRunStage(ctx, run, "chat", stage); err != nil {
				return err
			}
			if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "chat", "running",
				assistantMessageMetadata(run, nil, stage, "")); err != nil {
				return err
			}
			assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: "chat", Stage: stage})
			return w.executeAssistantChat(ctx, client, run, references)
		}
		history, histErr := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
		if histErr != nil {
			// 历史加载失败时退化为仅使用本轮输入，不阻塞本次运行。
			history = nil
		}
		history = assistantMessagesAfterContextBoundary(history)
		if isCanvasWorkspaceRun(run) {
			return w.executeCanvasAgent(ctx, client, run, references, history)
		}
		return w.executeAssistantAgent(ctx, client, run, references, history)
	}
	run.ResolvedMode = mode
	stage := "preparing-context"
	if mode == "image" {
		stage = "preparing-image"
	} else if len(references) > 0 {
		stage = "analyzing-image"
	}
	if err := w.setAssistantRunStage(ctx, run, mode, stage); err != nil {
		return err
	}
	metadata := assistantMessageMetadata(run, nil, stage, "")
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", mode, "running", metadata); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: mode, Stage: stage})

	if mode == "image" {
		serviceKey := assistantParamString(run.Params, "serviceKey", "assistant_image")
		selection, configured, configuredErr := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindImage)
		if configuredErr != nil {
			return configuredErr
		}
		if configured {
			if err := w.recordConfiguredAssistantImageRoute(ctx, run, selection); err != nil {
				return err
			}
			return w.executeConfiguredAssistantImage(ctx, run, references, selection)
		}
		provider, providerErr := settings.ImageServiceProvider(ctx, w.St.Pool, serviceKey)
		if providerErr != nil {
			return providerErr
		}
		if provider == "c2a" {
			return w.executeAssistantImageC2A(ctx, run, references, serviceKey)
		}
		if provider == "crun" {
			return w.executeAssistantImageCRUN(ctx, run)
		}
		client, err = w.assistantClient(ctx)
		if err != nil {
			return err
		}
		return w.executeAssistantImage(ctx, client, run, references)
	}
	if client == nil {
		selection, configured, selectionErr := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
		if selectionErr != nil {
			return selectionErr
		}
		if configured {
			client, err = w.configuredAssistantChatClient(selection)
		} else {
			client, err = w.assistantClient(ctx)
			if err == nil {
				if requestedModel := assistantParamString(run.Params, "model", ""); requestedModel != "" && requestedModel != client.ImageModel() {
					client = client.WithChatModel(requestedModel)
				}
			}
		}
		if err != nil {
			return err
		}
	}
	client = client.WithMaxOutputTokens(
		assistantParamInt(run.Params, "_chatMaxOutputTokens", assistantDefaultOutputTokens),
	).WithReasoningEffort(assistantParamString(run.Params, "reasoningEffort", ""))
	return w.executeAssistantChat(ctx, client, run, references)
}

func (w *Worker) recordConfiguredAssistantImageRoute(ctx context.Context, run *store.AssistantRun, selection *modelconfig.Selection) error {
	provider := selection.Provider
	serviceProvider := "c2a"
	if provider.Adapter == modelconfig.AdapterCRUN {
		serviceProvider = "crun"
	}
	metadata := map[string]any{
		"_serviceProvider":          serviceProvider,
		"_imageProviderRouteId":     provider.RouteID,
		"_imageProviderRouteKey":    modelconfig.ExecutionRouteKey(provider),
		"_imageProviderRouteName":   provider.RouteName,
		"_imageProviderEndpoint":    assistantProviderEndpoint(provider.BaseURL),
		"_imageProviderDisplayName": provider.Name,
		"_imageModel":               selection.Model.UpstreamModel,
		"_imageModelDisplayName":    selection.Model.Name,
	}
	if err := store.RecordAssistantRunExecutionRoute(
		ctx, w.St.Pool, run.ID, run.Attempt, metadata,
		modelconfig.ExecutionRouteKey(provider), provider.Name, selection.Model.UpstreamModel,
	); err != nil {
		return err
	}
	if run.Params == nil {
		run.Params = map[string]any{}
	}
	for key, value := range metadata {
		run.Params[key] = value
	}
	_, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, w.St.Pool, run, nil)
	return err
}

func assistantProviderEndpoint(raw string) string {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimRight(raw, "/")
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func crunOpenAICompatibleBaseURL(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimSuffix(raw, "/api/v1") + "/api/v1"
	}
	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/api/v1")
	parsed.Path = strings.TrimRight(path, "/") + "/api/v1"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func (w *Worker) configuredAssistantModelSelection(ctx context.Context, run *store.AssistantRun, kind string) (*modelconfig.Selection, bool, error) {
	prefix := "_chat"
	if kind == modelconfig.ModelKindImage {
		prefix = "_image"
	}
	providerID := assistantParamString(run.Params, prefix+"ProviderConfigId", "")
	modelID := assistantParamString(run.Params, prefix+"ModelConfigId", "")
	if kind == modelconfig.ModelKindImage && (providerID == "" || modelID == "") {
		providerID = assistantParamString(run.Params, "_providerConfigId", "")
		modelID = assistantParamString(run.Params, "_modelConfigId", "")
	}
	if providerID == "" || modelID == "" {
		return nil, false, nil
	}
	cfg, err := modelconfig.Runtime(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		return nil, false, err
	}
	routeID := assistantParamString(run.Params, prefix+"ProviderRouteId", "")
	selection, found := modelconfig.FindExecutionRoute(cfg, providerID, modelID, routeID)
	if !found {
		return nil, false, errors.New("助手任务绑定的模型或服务商配置已失效")
	}
	if selection.Model.Kind != kind {
		return nil, false, errors.New("助手任务绑定的模型类型无效")
	}
	return selection, true, nil
}

func (w *Worker) configuredAssistantChatClient(selection *modelconfig.Selection) (*sub2api.Client, error) {
	provider := selection.Provider
	if strings.TrimSpace(provider.APIKey) == "" {
		return nil, errors.New("对话模型服务商没有可用的 API Key")
	}
	baseURL := provider.BaseURL
	if provider.Adapter == modelconfig.AdapterCRUN {
		baseURL = crunOpenAICompatibleBaseURL(baseURL)
	}
	client, err := sub2api.New(
		baseURL, provider.APIKey, selection.Model.UpstreamModel,
		w.Cfg.Sub2APIImageModel, provider.TimeoutSecs,
	)
	if err != nil {
		return nil, err
	}
	if provider.Adapter == modelconfig.AdapterCRUN {
		client = client.WithAPIKeyHeader("x-api-key")
	}
	client = client.WithWebSearchModel(assistantWebSearchFallbackModel(provider.DiscoveredModels))
	return client, nil
}

func assistantWebSearchFallbackModel(models []string) string {
	for _, preferred := range []string{"gpt-5-search-api", "gpt-4o-search-preview", "gpt-4o-mini-search-preview"} {
		for _, model := range models {
			if strings.EqualFold(strings.TrimSpace(model), preferred) {
				return strings.TrimSpace(model)
			}
		}
	}
	return ""
}

func (w *Worker) configuredAssistantWebSearchClient(ctx context.Context, run *store.AssistantRun) (*sub2api.Client, error) {
	if w == nil || w.St == nil || w.Cfg == nil {
		return nil, errors.New("联网搜索服务不可用")
	}
	selection, configured, err := w.configuredAssistantModelSelection(ctx, run, modelconfig.ModelKindChat)
	if err != nil {
		return nil, err
	}
	if configured {
		return w.configuredAssistantChatClient(selection)
	}
	client, err := w.assistantClient(ctx)
	if err != nil {
		return nil, err
	}
	if model := assistantParamString(run.Params, "_chatModel", ""); model != "" {
		client = client.WithChatModel(model)
	}
	return client.WithWebSearchModel(""), nil
}

func (w *Worker) executeConfiguredAssistantImage(ctx context.Context, run *store.AssistantRun, references []string, selection *modelconfig.Selection) error {
	provider := selection.Provider
	model := selection.Model.UpstreamModel
	if strings.TrimSpace(provider.APIKey) == "" {
		return errors.New("模型服务商没有可用的 API Key")
	}
	switch provider.Adapter {
	case modelconfig.AdapterOpenAI:
		client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, provider.TimeoutSecs, w.Cfg.C2APrivateNetworkAllowed())
		return w.executeAssistantImageC2AClient(ctx, run, references, client, model)
	case modelconfig.AdapterCRUN:
		client, err := crun.New(provider.BaseURL, provider.APIKey, model, provider.TimeoutSecs)
		if err != nil {
			return err
		}
		return w.executeAssistantImageCRUNClient(ctx, run, client, selection.Model.UpstreamInputFields)
	default:
		return errors.New("不支持的模型服务商类型")
	}
}

const (
	assistantIntentHistoryTurns  = 8    // 送入路由器的历史消息条数上限
	assistantIntentLineRunes     = 160  // 每行摘要的最大字符数
	assistantIntentSummaryRunes  = 80   // 图片消息提示词摘要的最大字符数
	assistantIntentMaxRunes      = 2000 // 整个对话摘要的最大字符数
	assistantIntentShortPromptRn = 30   // 判定“延续上一张图”时的短指令阈值
	assistantIntentTimeout       = 8 * time.Second
	assistantProposalTimeout     = 15 * time.Second
)

// assistantSmallTalkPattern matches greetings that must never launch image generation.
var assistantSmallTalkPattern = regexp.MustCompile(`(?i)^(你好|您好|嗨+|哈喽|在吗|在么|hello|hi+|hey|thanks?|thank you|谢谢(你|您)?(了)?|早上好|早安|晚上好|你是谁|你能做什么|在不在)[呀啊呢吧嘛]*[\s!！。.?？]*$`)

// assistantIntentTokenPattern 匹配回复中首个 IMAGE 或 CHAT 单词（先出现者优先）。
var assistantIntentTokenPattern = regexp.MustCompile(`\b(IMAGE|CHAT)\b`)

// assistantContinuationPattern 匹配紧跟在生成图片之后的延续/修改类短指令。
var assistantContinuationPattern = regexp.MustCompile(`再来|再生成|再画|多来|换成|改成|变成|调整|加上|去掉|移除|放大|缩小|更[亮暗大小]|颜色|背景|风格|第[一二三四12345]张|another|again|more|make it|change`)

// assistantNegatedImageActionPattern removes explicit "do not generate/edit"
// clauses before positive intent matching, so a negated verb cannot force a tool call.
var assistantNegatedImageActionPattern = regexp.MustCompile(`(?i)(不要|别|无需|不需要|不用|禁止|勿)\s*(再\s*)?(生成|画|绘制|制作|创建|设计|修改|编辑|重绘|去背景|抠图|擦除|移除|替换|添加|扩图|上色)|\b(do not|don't|dont|no need to)\s+(generate|draw|create|edit|redraw|remove|replace)\b`)

func assistantSmallTalk(prompt string) bool {
	text := strings.TrimSpace(prompt)
	if text == "" || len([]rune(text)) > 16 {
		return false
	}
	return assistantSmallTalkPattern.MatchString(text)
}

func (w *Worker) classifyAssistantRun(ctx context.Context, client *sub2api.Client, transcript, prompt string, hasReference, lastAssistantWasImage bool) string {
	if intent, certain := fastAssistantIntent(prompt, hasReference, lastAssistantWasImage); certain {
		return intent
	}
	referenceText := "没有附带参考图片"
	if hasReference {
		referenceText = "附带了参考图片"
	}
	system := `你是意图路由器，负责判断用户最后一条消息应该走图片生成（IMAGE）还是普通对话（CHAT）。本轮` + referenceText + `。

判定规则：
1. 用户明确要求创建新图、绘制、设计图片时回复 IMAGE。
2. 上一轮助手刚生成过图片，而用户发来延续或修改类指令（如“再来一张”“换个颜色”“背景改成夜晚”“第二张放大一点”）时，也回复 IMAGE。
3. 识别图片文字/OCR、读取、翻译、描述、分析、总结、解释或回答图片相关问题回复 CHAT，即使附带了参考图片。
4. 参考图片的存在本身绝不代表要生成或编辑图片。
5. 图片生成后的寒暄或评价（如“真好看”“谢谢”）回复 CHAT。

示例：
- 用户：画一只戴帽子的猫 → IMAGE
- 用户：今天天气怎么样 → CHAT
- 用户：这张图里写了什么字（附参考图） → CHAT
- 助手：[生成了 2 张图片：戴帽子的猫] 用户：再来一张 → IMAGE
- 助手：[生成了 1 张图片：城市夜景] 用户：背景改成星空 → IMAGE
- 助手：[生成了 2 张图片：戴帽子的猫] 用户：真好看 → CHAT
- 助手：[生成了 1 张图片：海报] 用户：帮我翻译图上的英文 → CHAT

只输出一个单词：IMAGE 或 CHAT，不要任何标点或解释。`
	intentCtx, cancel := context.WithTimeout(ctx, assistantIntentTimeout)
	defer cancel()
	result, err := client.ChatTextWithImages(intentCtx, []sub2api.Message{
		{Role: "system", Content: system}, {Role: "user", Content: transcript},
	}, nil, nil)
	if err == nil {
		if intent := parseAssistantIntentReply(result); intent != "" {
			return intent
		}
	}
	return fallbackAssistantIntent(prompt, hasReference, lastAssistantWasImage)
}

// parseAssistantIntentReply 解析路由器回复：取最先出现的 IMAGE 或 CHAT，无匹配返回空串。
func parseAssistantIntentReply(reply string) string {
	match := assistantIntentTokenPattern.FindString(strings.ToUpper(reply))
	switch match {
	case "IMAGE":
		return "image"
	case "CHAT":
		return "chat"
	}
	return ""
}

func fallbackAssistantIntent(prompt string, hasReference bool, lastAssistantWasImage bool) string {
	if intent, certain := fastAssistantIntent(prompt, hasReference, lastAssistantWasImage); certain {
		return intent
	}
	return "chat"
}

func fastAssistantIntent(prompt string, hasReference bool, lastAssistantWasImage bool) (string, bool) {
	if assistantSmallTalk(prompt) {
		return "chat", true
	}
	text := strings.ToLower(prompt)
	positiveText := assistantNegatedImageActionPattern.ReplaceAllString(text, "")
	hasNegatedImageAction := positiveText != text
	understanding := []string{"识别", "读取", "提取", "描述", "分析", "总结", "翻译", "解释", "是什么", "ocr", "read", "describe", "translate"}
	// 理解类动词优先：即使上一轮刚生成图片，也应走对话回答
	if (hasReference || lastAssistantWasImage) && containsAssistantTerm(text, understanding) {
		return "chat", true
	}
	// 上一轮刚生成图片时，短促的延续/修改指令视为继续生图
	if lastAssistantWasImage && len([]rune(strings.TrimSpace(prompt))) <= assistantIntentShortPromptRn &&
		assistantContinuationPattern.MatchString(positiveText) {
		return "image", true
	}
	mutations := []string{"修改", "编辑", "重绘", "背景", "换成", "改成", "去背景", "抠图", "擦除", "移除", "替换", "添加", "扩图", "上色", "edit", "redraw", "remove", "replace"}
	if hasReference && containsAssistantTerm(positiveText, mutations) {
		return "image", true
	}
	actions := []string{"生成", "画", "绘制", "制作", "创建", "设计", "generate", "draw", "create"}
	images := []string{"图", "照片", "人像", "海报", "插画", "头像", "壁纸", "封面", "logo", "image", "picture", "photo", "portrait", "poster"}
	if containsAssistantTerm(positiveText, actions) && containsAssistantTerm(positiveText, images) {
		return "image", true
	}
	if hasNegatedImageAction {
		return "chat", true
	}
	return "", false
}

func assistantPromptRequestsWebSearch(prompt string) bool {
	return assistanttools.WebSearchRequested(prompt)
}

func assistantPromptRequestsTaskStatus(prompt string) bool {
	return assistanttools.TaskStatusRequested(prompt)
}

func assistantExecutionMode(mode, prompt string) string {
	if mode == "image" && assistantSmallTalk(prompt) {
		mode = "chat"
	}
	// Explicit search requests always need the tool-capable agent path, even
	// when the user selected the lightweight Q&A mode.
	if mode == "chat" && (assistantPromptRequestsWebSearch(prompt) || assistantPromptRequestsTaskStatus(prompt)) {
		return "agent"
	}
	return mode
}

// buildAssistantIntentTranscript 构建送入路由器的对话摘要：截取当前消息之前的若干条历史，
// 图片消息压缩为一行提示，最后附上本轮用户输入。
func buildAssistantIntentTranscript(history []*store.AssistantMessage, userMessageID, assistantMessageID uuid.UUID, prompt string) string {
	lines := make([]string, 0, assistantIntentHistoryTurns+1)
	for _, message := range history {
		if message == nil || message.ID == userMessageID || message.ID == assistantMessageID || message.Status == "failed" {
			continue
		}
		line := renderAssistantIntentLine(message)
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	if len(lines) > assistantIntentHistoryTurns {
		lines = lines[len(lines)-assistantIntentHistoryTurns:]
	}
	lines = append(lines, truncateAssistantRunes("用户："+strings.TrimSpace(prompt), assistantIntentLineRunes))
	// 双重保险：总长度超限时丢弃最早的历史行
	for len(lines) > 1 && len([]rune(strings.Join(lines, "\n"))) > assistantIntentMaxRunes {
		lines = lines[1:]
	}
	return strings.Join(lines, "\n")
}

func assistantMessagesAfterContextBoundary(messages []*store.AssistantMessage) []*store.AssistantMessage {
	boundary := -1
	for index, message := range messages {
		if message == nil {
			continue
		}
		isDivider, _ := message.Metadata["contextDivider"].(bool)
		if message.Kind == "context-divider" || isDivider {
			boundary = index
		}
	}
	if boundary < 0 {
		return messages
	}
	return messages[boundary+1:]
}

// renderAssistantIntentLine 把一条历史消息渲染成单行摘要；空消息返回空串。
func renderAssistantIntentLine(message *store.AssistantMessage) string {
	roleTag := "助手"
	if message.Role == "user" {
		roleTag = "用户"
	}
	if message.Role != "user" {
		if count, summary := assistantMessageImageSummary(message); count > 0 {
			body := fmt.Sprintf("[生成了 %d 张图片：%s]", count, truncateAssistantRunes(summary, assistantIntentSummaryRunes))
			return truncateAssistantRunes(roleTag+"："+body, assistantIntentLineRunes)
		}
	}
	content := strings.TrimSpace(message.Content)
	if content == "" {
		return ""
	}
	return truncateAssistantRunes(roleTag+"："+content, assistantIntentLineRunes)
}

// assistantMessageImageSummary 返回图片消息包含的图片数量与提示词摘要；非图片消息返回 0。
func assistantMessageImageSummary(message *store.AssistantMessage) (int, string) {
	images, _ := message.Metadata["images"].([]any)
	count := len(images)
	if count == 0 {
		if typed, ok := message.Metadata["images"].([]map[string]any); ok {
			count = len(typed)
		}
	}
	// 仅在消息成功完成时才凭 kind 推断为图片：排队/运行/停止的图片占位消息并未产出图片
	if count == 0 && (message.Kind != "image" || message.Status != "complete") {
		return 0, ""
	}
	if count == 0 {
		count = 1
	}
	if summary, ok := message.Metadata["prompt"].(string); ok && strings.TrimSpace(summary) != "" {
		return count, strings.TrimSpace(summary)
	}
	if len(images) > 0 {
		if item, ok := images[0].(map[string]any); ok {
			if revised := assistantMapString(item, "revisedPrompt"); revised != "" {
				return count, revised
			}
		}
	}
	return count, strings.TrimSpace(message.Content)
}

// lastAssistantMessageWasImage 判断当前消息之前最近一条有效助手消息是否为图片生成结果。
func lastAssistantMessageWasImage(history []*store.AssistantMessage, userMessageID, assistantMessageID uuid.UUID) bool {
	for index := len(history) - 1; index >= 0; index-- {
		message := history[index]
		if message == nil || message.ID == userMessageID || message.ID == assistantMessageID || message.Status == "failed" {
			continue
		}
		if message.Role != "assistant" {
			continue
		}
		count, _ := assistantMessageImageSummary(message)
		return count > 0
	}
	return false
}

// truncateAssistantRunes 按字符数截断字符串，超出部分以省略号结尾。
func truncateAssistantRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
}

func containsAssistantTerm(value string, terms []string) bool {
	for _, term := range terms {
		if strings.Contains(value, term) {
			return true
		}
	}
	return false
}

type assistantImageProposal struct {
	Action             string                   `json:"action"`
	Prompt             string                   `json:"prompt"`
	PromptMode         string                   `json:"promptMode"`
	FaithfulPrompt     string                   `json:"faithfulPrompt"`
	EnhancedPrompt     string                   `json:"enhancedPrompt"`
	Reason             string                   `json:"reason"`
	PlanningSummary    string                   `json:"planningSummary"`
	Ratio              string                   `json:"ratio"`
	Resolution         string                   `json:"resolution"`
	Count              int                      `json:"count"`
	Quality            string                   `json:"quality"`
	Model              string                   `json:"model"`
	ModelName          string                   `json:"modelName"`
	RequestSize        string                   `json:"requestSize"`
	Width              int                      `json:"width"`
	Height             int                      `json:"height"`
	ReferenceImages    []map[string]any         `json:"referenceImages"`
	ReferencedImageIDs []string                 `json:"referencedImageIds"`
	ReferenceMode      string                   `json:"referenceMode"`
	InspectedImageIDs  []string                 `json:"inspectedImageIds,omitempty"`
	Items              []assistantImagePlanItem `json:"items,omitempty"`
}

type assistantImagePlanItem struct {
	ID                 string           `json:"id"`
	Title              string           `json:"title"`
	Prompt             string           `json:"prompt"`
	ReferenceImages    []map[string]any `json:"referenceImages,omitempty"`
	ReferencedImageIDs []string         `json:"referencedImageIds"`
}

type assistantGoalDeliverable struct {
	Title              string   `json:"title"`
	Prompt             string   `json:"prompt"`
	ReferencedImageIDs []string `json:"referencedImageIds,omitempty"`
}

type assistantGoalContract struct {
	Version                string                     `json:"version"`
	Goal                   string                     `json:"goal"`
	OutcomeKind            string                     `json:"outcomeKind"`
	Action                 string                     `json:"action,omitempty"`
	PromptMode             string                     `json:"promptMode,omitempty"`
	DeliverableCount       int                        `json:"deliverableCount"`
	Deliverables           []assistantGoalDeliverable `json:"deliverables,omitempty"`
	ReferencedImageCount   int                        `json:"referencedImageCount"`
	InspectedImageCount    int                        `json:"inspectedImageCount"`
	WebSearchRequested     bool                       `json:"webSearchRequested"`
	WebSearchCount         int                        `json:"webSearchCount"`
	FaithfulPreserved      bool                       `json:"faithfulPreserved"`
	AcceptanceRequirements []string                   `json:"acceptanceRequirements"`
}

func assistantBaseGoalContract(run *store.AssistantRun) assistantGoalContract {
	goal := ""
	if run != nil {
		goal = truncateAssistantRunes(strings.TrimSpace(run.Prompt), 2000)
	}
	return assistantGoalContract{
		Version:            "assistant-goal-v1",
		Goal:               goal,
		DeliverableCount:   1,
		WebSearchRequested: assistantPromptRequestsWebSearch(goal),
		FaithfulPreserved:  true,
	}
}

func assistantProposalGoalContract(run *store.AssistantRun, proposal assistantImageProposal, webSearchCount int) assistantGoalContract {
	contract := assistantBaseGoalContract(run)
	contract.OutcomeKind = "image_proposal"
	contract.Action = proposal.Action
	contract.PromptMode = proposal.PromptMode
	contract.DeliverableCount = max(1, proposal.Count)
	contract.ReferencedImageCount = len(proposal.ReferenceImages)
	contract.InspectedImageCount = len(proposal.InspectedImageIDs)
	contract.WebSearchCount = webSearchCount
	contract.FaithfulPreserved = proposal.PromptMode != assistantPromptModeFaithful ||
		strings.TrimSpace(proposal.Prompt) == strings.TrimSpace(proposal.FaithfulPrompt)
	contract.AcceptanceRequirements = []string{"提示词非空", "数量符合模型能力", "参考图映射有效"}
	if len(proposal.Items) > 1 {
		contract.Deliverables = make([]assistantGoalDeliverable, 0, len(proposal.Items))
		for _, item := range proposal.Items {
			contract.Deliverables = append(contract.Deliverables, assistantGoalDeliverable{
				Title: item.Title, Prompt: item.Prompt, ReferencedImageIDs: item.ReferencedImageIDs,
			})
		}
	}
	return contract
}

func assistantChatGoalContract(run *store.AssistantRun, webSearchCount int) assistantGoalContract {
	contract := assistantBaseGoalContract(run)
	contract.OutcomeKind = "chat"
	contract.WebSearchCount = webSearchCount
	contract.AcceptanceRequirements = []string{"回答完整", "不泄露内部工具调用"}
	if contract.WebSearchRequested {
		contract.AcceptanceRequirements = append(contract.AcceptanceRequirements, "联网结论包含真实来源")
	}
	return contract
}

func persistAssistantGoalContract(ctx context.Context, st *store.Store, runID uuid.UUID, contract assistantGoalContract) error {
	if st == nil {
		return nil
	}
	raw, err := json.Marshal(contract)
	if err != nil {
		return err
	}
	return store.UpdateAgentTraceGoalContract(ctx, st.Pool, runID, raw)
}

func (w *Worker) recordAssistantGoalContract(ctx context.Context, runID uuid.UUID, contract assistantGoalContract) {
	if err := persistAssistantGoalContract(ctx, w.St, runID, contract); err != nil {
		log.Printf("assistant run %s goal contract update failed: %v", runID, err)
	}
}

func assistantToolArguments(raw string) json.RawMessage {
	raw = strings.TrimSpace(raw)
	if raw != "" && len(raw) <= 16_000 && json.Valid([]byte(raw)) {
		return json.RawMessage(raw)
	}
	encoded, _ := json.Marshal(map[string]any{"raw": truncateAssistantRunes(raw, 4000)})
	return encoded
}

type assistantCatalogImage struct {
	ID          string
	Label       string
	Description string
	Image       map[string]any
}

func assistantProposalFunctionTool(models []map[string]any) sub2api.FunctionTool {
	properties := map[string]any{
		"action":             map[string]any{"type": "string", "enum": []string{"generate", "edit"}},
		"prompt":             map[string]any{"type": "string", "description": "可直接交给图片模型的完整中文提示词；参考图使用图1、图2指代"},
		"promptMode":         map[string]any{"type": "string", "enum": []string{assistantPromptModeFaithful, assistantPromptModeEnhanced}, "description": "faithful=忠实执行用户原话；enhanced=补充视觉细节"},
		"faithfulPrompt":     map[string]any{"type": "string", "description": "保持用户目标和原始约束，不增加未要求主体或风格的执行提示词"},
		"enhancedPrompt":     map[string]any{"type": "string", "description": "不改变核心目标，补充构图、光线、材质和镜头的优化提示词"},
		"reason":             map[string]any{"type": "string", "description": "一句话说明方案依据"},
		"planningSummary":    map[string]any{"type": "string", "description": "面向用户的一句简短方案摘要"},
		"count":              map[string]any{"type": "integer", "minimum": 1, "maximum": assistantProposalCatalogMaxImages(models)},
		"model":              map[string]any{"type": "string", "description": "当前可用图片模型目录中的 id"},
		"referencedImageIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"referenceMode": map[string]any{
			"type": "string", "enum": []string{assistantReferenceModeShared, assistantReferenceModeIndividual},
			"description": "shared=多张参考图共同参与每张输出；individual=图1只生成结果1、图2只生成结果2，逐张一一对应",
		},
		"items": map[string]any{
			"type": "array", "maxItems": assistantProposalCatalogMaxImages(models),
			"description": "只有多张输出承担不同用途或需要不同提示词时填写；普通多张随机变体返回空数组",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":              map[string]any{"type": "string", "description": "简短用途，例如主图、场景图、细节图"},
					"prompt":             map[string]any{"type": "string", "description": "这一张图片独立执行的提示词"},
					"referencedImageIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				},
				"required":             []string{"title", "prompt", "referencedImageIds"},
				"additionalProperties": false,
			},
		},
	}
	required := []string{"action", "prompt", "promptMode", "faithfulPrompt", "enhancedPrompt", "reason", "planningSummary", "count", "model", "referencedImageIds", "referenceMode", "items"}
	capabilities := map[string][]string{
		"ratio":      assistantProposalCapabilityUnion(models, "aspectRatios"),
		"resolution": assistantProposalCapabilityUnion(models, "resolutions"),
		"quality":    assistantProposalCapabilityUnion(models, "qualities"),
	}
	if len(models) == 0 {
		capabilities["ratio"] = []string{"auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"}
		capabilities["resolution"] = []string{"1K", "2K", "4K"}
		capabilities["quality"] = []string{"low", "medium", "high"}
	} else {
		modelIDs := make([]string, 0, len(models))
		for _, model := range models {
			if id := assistantMapString(model, "id"); id != "" {
				modelIDs = append(modelIDs, id)
			}
		}
		properties["model"] = map[string]any{"type": "string", "enum": modelIDs, "description": "当前可用图片模型目录中的 id"}
	}
	for _, key := range []string{"ratio", "resolution", "quality"} {
		if values := capabilities[key]; len(values) > 0 {
			properties[key] = map[string]any{"type": "string", "enum": values}
		}
	}
	return sub2api.FunctionTool{
		Name:        "propose_image_action",
		Description: "用户明确希望生成或编辑图片时，提交一份可确认、可修改的图片方案。纯对话不要调用。",
		Parameters: map[string]any{
			"type":                 "object",
			"properties":           properties,
			"required":             required,
			"additionalProperties": false,
		},
	}
}

func assistantProposalCapabilityUnion(models []map[string]any, key string) []string {
	seen := map[string]bool{}
	values := make([]string, 0)
	for _, model := range models {
		for _, value := range assistantMapStrings(model, key) {
			normalized := strings.ToLower(strings.TrimSpace(value))
			if normalized == "" || seen[normalized] {
				continue
			}
			seen[normalized] = true
			values = append(values, value)
		}
	}
	return values
}

func assistantProposalCatalogMaxImages(models []map[string]any) int {
	maximum := 4
	if len(models) > 0 {
		maximum = 1
	}
	for _, model := range models {
		if value := assistantMapInt(model, "maxImages"); value > maximum {
			maximum = value
		}
	}
	return maximum
}

func assistantAgentInstructions(run *store.AssistantRun, catalog []assistantCatalogImage, models []map[string]any) string {
	instructions := `你是图片创作 Agent，全程使用简体中文，思考过程也使用简体中文。
	按以下规则完成判断和必要的工具调用：
	- 纯聊天、分析、解释或需求不明确时，立即自然回答；需要澄清时直接提问，不调用工具。
	- 用户询问本人任务进度、真实阶段、重试、失败原因、扣费或退款时调用 task_status；必须根据工具结果回答，禁止猜测，不得显示或推断内部任务 ID、线路、端点或密钥。
	- 问题涉及实时信息、近期变化、新闻、价格、版本、政策、当前人物/公司状态，或用户明确要求联网、搜索、查证时，先调用 web_search；只有工具真实成功后才能声称已经联网，并在回答中保留来源链接。
	- web_search 失败时必须明确返回真实错误，禁止用模型记忆冒充联网结果。稳定且不依赖时效的常识问题不必搜索。
	- 用户缺少参考图并要求找图时调用 image_search；必须展示真实来源和授权，不能把搜索结果冒充用户资产。
	- 用户要求截取公开网页视觉时调用 webpage_capture；内网、登录后页面或非公开地址会被拒绝。
	- 用户提供商品页并要带入 AI 电商时调用 product_import；只读取公开商品信息，最终导入必须由用户点击确认。
	- 用户要抠图、压缩、放大、裁剪或切图时调用 media_action；用户要把需求或图片送到其他业务工作区时调用 send_to_workspace。
	- 用户要求根据参考图搭建可编辑流程时调用 reference_rebuild；它只准备无限画布草稿，禁止声称已经运行或收费。
	- 用户要下载完整交付物时调用 delivery_export；它会在浏览器本地打包图片、提示词、参数和清单。
	- 用户明确要打开站内某个页面时调用 site_operator；只能使用工具允许的站内目的地。
	- media_action、send_to_workspace、reference_rebuild、product_import 和 delivery_export 返回的动作都必须等待用户在卡片上确认，禁止在回答中声称已执行、已扣费或已完成。
	- 用户明确要生成新图或编辑已有图片时，可以先给一句简短说明，然后调用 propose_image_action；工具调用成功后不要再输出 JSON 或重复提示词。
	- 有参考图、编辑已有图片，或用户强调原样、一模一样、提示词不要改时，promptMode=faithful，faithfulPrompt 必须保留用户目标和原始约束，禁止擅自增加风格、主体或构图。只有需求是模糊创意方向时才使用 enhanced。
	- 用户明确需要一套不同用途的图片（例如主图、场景图、细节图）时，items 为每张图填写独立 title、prompt 和 referencedImageIds，count 必须等于 items 数量。只是同一提示词生成多个随机变体时 items 返回空数组。
- 如果当前上游不支持工具调用，无法调用 propose_image_action，则只输出一个与该工具参数完全同结构的 JSON 对象，不要 Markdown、代码块或额外文字。
	- 编辑图片时 referencedImageIds 必须来自图片目录；提示词用“图1、图2”指代参考图，不臆造参考图内容。
	- 编辑图片时必须判断参考图映射：用户要求分别、逐张、各自或一一对应处理时 referenceMode=individual，且 count 等于参考图数量；多张参考图需要共同融合、共同指导每张输出时 referenceMode=shared。
	- 生成全新图片或没有参考图时 referenceMode=shared。
	- 生成全新图片时 referencedImageIds 默认必须为空；只有用户明确提到上一张、图1/图2、之前图片的主体/风格，或明确要求修改历史图片时才可引用图片目录。
- 用户明确要求几张图时必须原样写入 count；未指定时使用当前默认数量。
- 参数只从工具允许值和模型目录选择，系统还会按模型能力做最终校验。`
	defaults := []string{fmt.Sprintf("数量=%d", assistantParamInt(run.Params, "count", 1))}
	for _, item := range []struct{ label, key string }{{"比例", "ratio"}, {"分辨率", "resolution"}, {"质量", "quality"}, {"图片模型", "_imageModelConfigId"}} {
		if value := assistantParamString(run.Params, item.key, ""); value != "" {
			defaults = append(defaults, item.label+"="+value)
		}
	}
	instructions += "\n\n当前默认参数：" + strings.Join(defaults, "，") + "。"
	if catalogText := renderAssistantImageCatalog(catalog); catalogText != "" {
		instructions += "\n\n当前可用图片目录：\n" + catalogText
	} else {
		instructions += "\n\n当前可用图片目录：空"
	}
	if modelText := renderAssistantModelCatalog(models); modelText != "" {
		instructions += "\n\n当前可用图片模型：\n" + modelText
	}
	return instructions
}

func (w *Worker) executeAssistantAgent(
	ctx context.Context,
	client *sub2api.Client,
	run *store.AssistantRun,
	references []string,
	history []*store.AssistantMessage,
) error {
	run.ResolvedMode = "agent"
	imageCatalog := buildAssistantImageCatalog(history, run.AssistantMessageID)
	modelCatalog := assistantProposalModelCatalog(run.Params)
	historicalVisionCatalog := assistantHistoricalVisionCatalog(run.Prompt,
		buildAssistantImageCatalog(history, run.UserMessageID, run.AssistantMessageID), len(references))
	initialGoal := assistantBaseGoalContract(run)
	initialGoal.ReferencedImageCount = len(references)
	initialGoal.AcceptanceRequirements = []string{"识别用户目标", "完整结束执行"}
	w.recordAssistantGoalContract(ctx, run.ID, initialGoal)
	agentReferences := append([]string(nil), references...)
	if len(historicalVisionCatalog) > 0 {
		items := make([]map[string]any, 0, len(historicalVisionCatalog))
		for _, item := range historicalVisionCatalog {
			items = append(items, item.Image)
		}
		loaded, loadErr := w.loadAssistantReferenceItems(ctx, items)
		if loadErr != nil {
			return fmt.Errorf("读取历史参考图失败：%w", loadErr)
		}
		agentReferences = append(agentReferences, loaded...)
	}
	nextStage := "thinking"
	if len(agentReferences) > 0 {
		nextStage = "analyzing-image"
	}
	instructions := assistantAgentInstructions(run, imageCatalog, modelCatalog)
	if len(historicalVisionCatalog) > 0 {
		mappings := make([]string, 0, len(historicalVisionCatalog))
		for index, item := range historicalVisionCatalog {
			mappings = append(mappings, fmt.Sprintf("附加视觉图%d=%s（id=%s）", len(references)+index+1, item.Label, item.ID))
		}
		instructions += "\n\n本轮已真实读取这些历史图片像素：" + strings.Join(mappings, "，") + "。只能对这些图片声称已看过。"
	}
	payload, _, err := w.prepareAssistantContext(ctx, run, "agent",
		instructions, history, agentReferences, false, nextStage)
	if err != nil {
		return err
	}

	lastCheckpoint := time.Now()
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	answering := false
	started := time.Now()
	var firstVisible time.Time
	lastWasImage := lastAssistantMessageWasImage(history, run.UserMessageID, run.AssistantMessageID)
	fastIntent, fastIntentCertain := fastAssistantIntent(run.Prompt, len(references) > 0, lastWasImage)
	forceWebSearchTool := assistantPromptRequestsWebSearch(run.Prompt)
	forceTaskStatusTool := assistantPromptRequestsTaskStatus(run.Prompt)
	forcedWorkspaceTool := assistantForcedWorkspaceTool(run.Prompt)
	forceProposalTool := fastIntentCertain && fastIntent == "image" && !forceWebSearchTool && !forceTaskStatusTool && forcedWorkspaceTool == ""
	suppressProposalTool := fastIntentCertain && fastIntent == "chat"
	proposalTool := assistantProposalFunctionTool(modelCatalog)
	taskStatusRegistry, taskStatusTool, err := w.assistantTaskStatusRegistry()
	if err != nil {
		return err
	}
	workspaceToolRegistry, workspaceTools, err := w.assistantWorkspaceToolRegistry()
	if err != nil {
		return err
	}
	tools := []sub2api.FunctionTool{proposalTool, webSearchTool(), taskStatusTool}
	tools = append(tools, workspaceTools...)
	var result sub2api.AgentChatResult
	var searches []sub2api.WebSearchResult
	var toolActions []map[string]any
	taskStatusCalls := 0
	var aggregateUsage sub2api.ChatUsage
	reasoningParts := make([]string, 0, 2)
	onUpdate := func(fullText, reasoning string) error {
		markAssistantFirstToken(&firstVisible, fullText)
		markAssistantFirstToken(&firstVisible, reasoning)
		if time.Since(lastTerminationCheck) >= 400*time.Millisecond {
			lastTerminationCheck = time.Now()
			if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
				if err != nil {
					return err
				}
				return context.Canceled
			}
		}
		if !answering {
			if err := w.setAssistantRunStage(ctx, run, "agent", "answering"); err != nil {
				return err
			}
			answering = true
		}
		visibleText := fullText
		if forceProposalTool {
			visibleText = ""
		}
		if (visibleText != "" || reasoning != "") && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: visibleText, Reasoning: reasoning, Kind: "agent", Stage: "answering"})
		}
		if forceProposalTool || fullText == "" || time.Since(lastCheckpoint) < time.Second {
			return nil
		}
		lastCheckpoint = time.Now()
		metadata := assistantMessageMetadata(run, nil, "answering", "")
		attachAssistantReasoning(metadata, reasoning)
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, fullText, "agent", "running", metadata)
	}
	for iteration := 0; iteration < 6; iteration++ {
		toolChoice := ""
		if iteration == 0 {
			if forceTaskStatusTool {
				toolChoice = taskStatusTool.Name
			} else if forceWebSearchTool {
				toolChoice = webSearchTool().Name
			} else if forcedWorkspaceTool != "" {
				toolChoice = forcedWorkspaceTool
			} else if forceProposalTool {
				toolChoice = proposalTool.Name
			}
		}
		next, callErr := client.ChatAgentWithTools(ctx, payload, nil, tools, toolChoice, onUpdate)
		aggregateUsage = aggregateUsage.Add(next.Usage)
		if value := strings.TrimSpace(next.Reasoning); value != "" && (len(reasoningParts) == 0 || reasoningParts[len(reasoningParts)-1] != value) {
			reasoningParts = append(reasoningParts, value)
		}
		result = next
		if callErr != nil {
			return &assistantProviderError{err: callErr, outputStarted: result.Text != "" || result.Reasoning != "" || result.ToolCall != nil}
		}
		if next.ToolCall == nil || next.ToolCall.Name == proposalTool.Name {
			break
		}
		var observation string
		switch next.ToolCall.Name {
		case webSearchTool().Name:
			if len(searches) >= 3 {
				return errors.New("联网搜索次数过多，请缩小问题范围后重试")
			}
			var searchResult sub2api.WebSearchResult
			observation, searchResult, err = w.runAssistantAgentWebSearch(ctx, run, next.ToolCall)
			if err != nil {
				return err
			}
			searches = append(searches, searchResult)
		case taskStatusTool.Name:
			if taskStatusCalls >= 2 {
				return errors.New("任务状态查询次数过多，请明确需要查看哪一条任务")
			}
			observation, err = w.runAssistantAgentTaskStatus(ctx, run, taskStatusRegistry, next.ToolCall)
			if err != nil {
				return err
			}
			taskStatusCalls++
		default:
			if !workspaceToolRegistry.Has(next.ToolCall.Name) {
				return fmt.Errorf("AI 助手请求了不支持的工具：%s", next.ToolCall.Name)
			}
			var actions []map[string]any
			observation, actions, err = w.runAssistantAgentWorkspaceTool(ctx, run, workspaceToolRegistry, next.ToolCall)
			if err != nil {
				return err
			}
			toolActions = append(toolActions, actions...)
		}
		payload = append(payload, canvasAgentToolMessages(next, observation)...)
		answering = false
		if err := w.setAssistantRunStage(ctx, run, "agent", "thinking"); err != nil {
			return err
		}
	}
	result.Usage = aggregateUsage
	if len(reasoningParts) > 0 {
		result.Reasoning = strings.Join(reasoningParts, "\n\n")
	}
	if result.ToolCall != nil && result.ToolCall.Name != proposalTool.Name {
		return fmt.Errorf("工具 %s 已完成，但模型没有生成最终回答，请重试", result.ToolCall.Name)
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}

	if forceProposalTool || (!suppressProposalTool && result.ToolCall != nil && result.ToolCall.Name == proposalTool.Name) {
		requestID := uuid.NewString()
		arguments := assistantToolArguments(result.Text)
		if result.ToolCall != nil && result.ToolCall.Name == proposalTool.Name {
			if strings.TrimSpace(result.ToolCall.ID) != "" {
				requestID = strings.TrimSpace(result.ToolCall.ID)
			}
			arguments = assistantToolArguments(result.ToolCall.Arguments)
		}
		_ = store.UpsertAgentToolStepClaim(ctx, w.St.Pool, run.ID, requestID, proposalTool.Name, arguments, "server", false)
		proposal := defaultAssistantProposal(run)
		parsedTextFallback := false
		if result.ToolCall != nil && result.ToolCall.Name == proposalTool.Name {
			parsed, parseErr := parseAssistantProposal(result.ToolCall.Arguments)
			if parseErr != nil {
				_ = store.CompleteAgentToolStep(ctx, w.St.Pool, run.ID, requestID, nil, parseErr.Error(), time.Now().UTC())
				return fmt.Errorf("解析 Agent 图片方案失败: %w", parseErr)
			}
			proposal = parsed
		} else if parsed, parseErr := parseAssistantProposal(result.Text); parseErr == nil {
			proposal = parsed
			parsedTextFallback = true
		} else {
			if refinedPrompt, ok := assistantProposalPromptFromAgentText(result.Text); ok {
				proposal.Prompt = refinedPrompt
			}
			proposal.Reason = "已根据你的要求整理可编辑的图片创作方案。"
			proposal.PlanningSummary = fmt.Sprintf("已整理 %d 张图片的生成方案。", proposal.Count)
		}
		proposal = normalizeAssistantProposalWithModels(proposal, run, modelCatalog)
		proposal = attachAssistantProposalReferences(proposal, run, imageCatalog, modelCatalog)
		proposal.InspectedImageIDs = assistantCatalogImageIDs(historicalVisionCatalog)
		traceItems := make([]map[string]any, 0, len(proposal.Items))
		for _, item := range proposal.Items {
			traceItems = append(traceItems, map[string]any{
				"id": item.ID, "title": item.Title, "prompt": truncateAssistantRunes(item.Prompt, 1000),
				"referencedImageIds": item.ReferencedImageIDs,
			})
		}
		proposalResult, _ := json.Marshal(map[string]any{
			"action": proposal.Action, "promptMode": proposal.PromptMode, "count": proposal.Count,
			"model": proposal.Model, "referencedImageIds": proposal.ReferencedImageIDs,
			"inspectedImageIds": proposal.InspectedImageIDs, "items": traceItems,
		})
		_ = store.CompleteAgentToolStep(ctx, w.St.Pool, run.ID, requestID, proposalResult, "", time.Now().UTC())
		w.recordAssistantGoalContract(ctx, run.ID, assistantProposalGoalContract(run, proposal, len(searches)))
		content := strings.TrimSpace(result.Text)
		if parsedTextFallback {
			content = "图片创作方案已准备，可以调整后开始生成。"
		}
		if content == "" {
			content = "图片创作方案已准备，可以调整后开始生成。"
		}
		metadata := assistantMessageMetadata(run, nil, "complete", "")
		attachAssistantUsage(metadata, finalizeAssistantUsage(result.Usage, started, firstVisible, run, content))
		attachAssistantWebSearches(metadata, searches)
		if len(toolActions) > 0 {
			metadata["toolActions"] = toolActions
		}
		metadata["proposal"] = proposal
		if strings.TrimSpace(result.Text) != "" && !parsedTextFallback {
			metadata["agentAnalysis"] = result.Text
		}
		if strings.TrimSpace(result.Reasoning) != "" {
			metadata["reasoning"] = result.Reasoning
		}
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "proposal", "complete", metadata); err != nil {
			return err
		}
		completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "proposal")
		if err != nil {
			return err
		}
		if !completed {
			return context.Canceled
		}
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Content: content, Reasoning: result.Reasoning, Kind: "proposal", Stage: "complete", Done: true, Status: "succeeded",
			Usage: finalizeAssistantUsage(result.Usage, started, firstVisible, run, content).Map(),
		})
		return nil
	}

	text := strings.TrimSpace(result.Text)
	if text == "" {
		text = "没有收到模型回复，请重试。"
	}
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	attachAssistantUsage(metadata, finalizeAssistantUsage(result.Usage, started, firstVisible, run, text))
	attachAssistantWebSearches(metadata, searches)
	if len(toolActions) > 0 {
		metadata["toolActions"] = toolActions
	}
	if strings.TrimSpace(result.Reasoning) != "" {
		metadata["reasoning"] = result.Reasoning
	}
	w.recordAssistantGoalContract(ctx, run.ID, assistantChatGoalContract(run, len(searches)))
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, "chat", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "chat")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Content: text, Reasoning: result.Reasoning, Kind: "chat", Stage: "complete", Done: true, Status: "succeeded",
		Usage: finalizeAssistantUsage(result.Usage, started, firstVisible, run, text).Map(),
	})
	return nil
}

func attachAssistantWebSearches(metadata map[string]any, searches []sub2api.WebSearchResult) {
	if len(searches) == 0 {
		return
	}
	metadata["webSearches"] = searches
}

func (w *Worker) runAssistantAgentWebSearch(
	ctx context.Context,
	run *store.AssistantRun,
	call *sub2api.ToolCall,
) (string, sub2api.WebSearchResult, error) {
	requestID := uuid.NewString()
	rawArguments := ""
	if call != nil {
		rawArguments = call.Arguments
		if strings.TrimSpace(call.ID) != "" {
			requestID = strings.TrimSpace(call.ID)
		}
	}
	argumentsJSON := assistantToolArguments(rawArguments)
	_ = store.UpsertAgentToolStepClaim(ctx, w.St.Pool, run.ID, requestID, webSearchTool().Name, argumentsJSON, "server", false)
	var tracedResult json.RawMessage
	var tracedError string
	defer func() {
		traceCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = store.CompleteAgentToolStep(traceCtx, w.St.Pool, run.ID, requestID, tracedResult, tracedError, time.Now().UTC())
	}()
	var arguments struct {
		Query          string   `json:"query"`
		RecencyDays    int      `json:"recencyDays"`
		AllowedDomains []string `json:"allowedDomains"`
	}
	if call == nil || json.Unmarshal([]byte(strings.TrimSpace(call.Arguments)), &arguments) != nil || strings.TrimSpace(arguments.Query) == "" {
		tracedError = "联网搜索参数无效"
		return "", sub2api.WebSearchResult{}, errors.New("联网搜索参数无效，请重新描述需要查询的问题")
	}
	client, err := w.configuredAssistantWebSearchClient(ctx, run)
	if err != nil {
		tracedError = err.Error()
		return "", sub2api.WebSearchResult{}, err
	}
	if err := w.setAssistantRunStage(ctx, run, "agent", "web_search"); err != nil {
		tracedError = err.Error()
		return "", sub2api.WebSearchResult{}, err
	}
	pendingTool := map[string]any{
		"requestId": requestID, "name": webSearchTool().Name, "arguments": call.Arguments,
		"execution": "server", "status": "running", "stage": "web_search",
	}
	if err := store.MergeAssistantMessageMetadata(ctx, w.St.Pool, run.AssistantMessageID, map[string]any{
		"pendingTool": pendingTool, "statusStage": "web_search",
	}); err != nil {
		tracedError = err.Error()
		return "", sub2api.WebSearchResult{}, err
	}
	defer func() {
		_, _ = store.ClearAssistantMessagePendingTool(context.Background(), w.St.Pool, run.AssistantMessageID, requestID)
	}()
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "agent", Stage: "web_search",
		Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: webSearchTool().Name, Arguments: call.Arguments, Execution: "server", Status: "running"},
	})
	searchCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	result, err := client.WebSearch(searchCtx, strings.TrimSpace(arguments.Query), sub2api.WebSearchOptions{
		RecencyDays: arguments.RecencyDays, AllowedDomains: arguments.AllowedDomains,
	})
	if err != nil {
		message := truncateForModel(err.Error(), 1000)
		tracedError = message
		assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
			Kind: "agent", Stage: "web_search",
			Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: webSearchTool().Name, Arguments: call.Arguments, Execution: "server", Status: "failed", Error: message},
		})
		return "", sub2api.WebSearchResult{}, fmt.Errorf("联网搜索失败：%s", message)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		tracedError = err.Error()
		return "", sub2api.WebSearchResult{}, fmt.Errorf("联网搜索结果序列化失败：%w", err)
	}
	tracedResult, _ = json.Marshal(map[string]any{
		"query": result.Query, "text": truncateAssistantRunes(result.Text, 2000), "sources": result.Sources,
	})
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "agent", Stage: "web_search",
		Tool: &assistantstream.ToolCallEvent{RequestID: requestID, Name: webSearchTool().Name, Arguments: call.Arguments, Execution: "server", Status: "completed", Result: raw},
	})
	return "工具 web_search 的真实联网结果：\n" + string(raw) + "\n回答时必须保留与结论对应的来源链接。", result, nil
}

func (w *Worker) executeAssistantProposal(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string, history []*store.AssistantMessage) error {
	transcript := buildAssistantIntentTranscript(history, run.UserMessageID, run.AssistantMessageID, run.Prompt)
	imageCatalog := buildAssistantImageCatalog(history, run.UserMessageID, run.AssistantMessageID)
	modelCatalog := assistantProposalModelCatalog(run.Params)
	system := `你是图像创作 Agent 的方案规划器。根据对话整理一份可直接执行的图片生成或编辑方案。
		只输出一个 JSON 对象，不要 Markdown、代码块或解释。字段必须包含：
		action（generate 或 edit）、prompt、reason、planningSummary、count、model、referencedImageIds、referenceMode。
		prompt 使用简体中文，完整描述目标画面和修改要求；有参考图时用“图1、图2”指代，不要臆造参考图内容。
		referenceMode 只能是 shared 或 individual：要求逐张、一一对应分别编辑时用 individual 且 count 等于参考图数量；多图需要共同融合或共同指导每张输出时用 shared；无参考图时用 shared。
	ratio、resolution、quality 仅在所选模型目录明确提供对应可选值时填写，且只能使用目录列出的值；模型未提供的参数不要输出。
	count 不得超过所选模型目录中的最大生成数量。
reason 用一句话说明方案如何响应用户需求；planningSummary 用一句面向用户的简短规划摘要，不要输出思维过程。
model 必须从模型目录选择；referencedImageIds 只填写图片目录中的 id，没有历史引用时返回空数组。`
	system += `生成全新图片时 referencedImageIds 默认返回空数组；只有用户明确提到上一张、图1/图2、之前图片的主体/风格，或明确要求修改历史图片时才可引用图片目录。`
	if catalogText := renderAssistantImageCatalog(imageCatalog); catalogText != "" {
		system += "\n\n当前对话图片目录（序号从旧到新，可用于理解‘上一张/第二张/图1’）：\n" + catalogText
	}
	if modelText := renderAssistantModelCatalog(modelCatalog); modelText != "" {
		system += "\n\n可用图片模型目录：\n" + modelText
	}
	payload := []sub2api.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: transcript, ReferenceImages: references},
	}
	planningCtx, cancel := context.WithTimeout(ctx, assistantProposalTimeout)
	defer cancel()
	started := time.Now()
	completion, err := client.CompleteChatTextWithImages(planningCtx, payload, nil, nil)
	raw := completion.Text
	proposal := defaultAssistantProposal(run)
	if err == nil {
		if parsed, parseErr := parseAssistantProposal(raw); parseErr == nil {
			proposal = normalizeAssistantProposalWithModels(parsed, run, modelCatalog)
		}
	}
	proposal = attachAssistantProposalReferences(proposal, run, imageCatalog, modelCatalog)
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	metadata["proposal"] = proposal
	content := "我整理了一份图片创作方案，你可以调整后再开始生成。"
	usage := finalizeAssistantUsage(completion.Usage, started, time.Time{}, run, content)
	attachAssistantUsage(metadata, usage)
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "proposal", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "proposal")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Kind: "proposal", Done: true, Status: "succeeded", Usage: usage.Map()})
	return nil
}

func defaultAssistantProposal(run *store.AssistantRun) assistantImageProposal {
	action := "generate"
	if len(assistantProposalReferences(run.Params)) > 0 {
		action = "edit"
	}
	promptMode := assistantDefaultPromptMode(run, action)
	faithfulPrompt := strings.TrimSpace(run.Prompt)
	return assistantImageProposal{
		Action: action, Prompt: faithfulPrompt, PromptMode: promptMode,
		FaithfulPrompt: faithfulPrompt, EnhancedPrompt: faithfulPrompt,
		Reason:          "已根据当前对话整理生成目标和可调整参数。",
		PlanningSummary: "已结合当前对话、历史图片和可用模型整理执行方案。",
		Ratio:           assistantParamString(run.Params, "ratio", ""),
		Resolution:      assistantParamString(run.Params, "resolution", ""),
		Count:           assistantParamInt(run.Params, "count", 1),
		Quality:         assistantParamString(run.Params, "quality", ""),
		Model:           assistantParamString(run.Params, "_imageModelConfigId", ""),
		ModelName:       assistantParamString(run.Params, "_imageModelDisplayName", "默认图片模型"),
		RequestSize:     assistantParamString(run.Params, "requestSize", ""),
		Width:           assistantParamInt(run.Params, "width", 0), Height: assistantParamInt(run.Params, "height", 0),
	}
}

// assistantProposalPromptFromAgentText preserves a useful plan returned by
// gateways that ignore tool calls. It removes confirmation/control text and
// keeps only the visual brief that can be sent directly to an image model.
func assistantProposalPromptFromAgentText(raw string) (string, bool) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	if raw == "" || (!strings.Contains(raw, "画面设定") && !strings.Contains(raw, "元素限制")) {
		return "", false
	}
	lines := strings.Split(raw, "\n")
	visualBrief := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(strings.ReplaceAll(line, "**", ""))
		if line == "" {
			continue
		}
		compact := strings.ReplaceAll(line, " ", "")
		if strings.HasPrefix(compact, "默认参数") || strings.Contains(compact, "等待确认") {
			break
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "-"))
		compact = strings.ReplaceAll(line, " ", "")
		if strings.HasPrefix(compact, "方案确认") || strings.HasPrefix(compact, "数量：") {
			continue
		}
		if line != "" {
			visualBrief = append(visualBrief, line)
		}
	}
	if len(visualBrief) < 3 {
		return "", false
	}
	return truncateAssistantRunes(strings.Join(visualBrief, "\n"), 6000), true
}

func parseAssistantProposal(raw string) (assistantImageProposal, error) {
	raw = strings.TrimSpace(raw)
	start, end := strings.Index(raw, "{"), strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return assistantImageProposal{}, errors.New("proposal JSON not found")
	}
	var proposal assistantImageProposal
	if err := json.Unmarshal([]byte(raw[start:end+1]), &proposal); err != nil {
		return assistantImageProposal{}, err
	}
	if strings.TrimSpace(proposal.Prompt) == "" && strings.TrimSpace(proposal.FaithfulPrompt) == "" && strings.TrimSpace(proposal.EnhancedPrompt) == "" {
		return assistantImageProposal{}, errors.New("proposal prompt is empty")
	}
	return proposal, nil
}

func normalizeAssistantProposal(proposal assistantImageProposal, run *store.AssistantRun) assistantImageProposal {
	return normalizeAssistantProposalWithModels(proposal, run, nil)
}

func normalizeAssistantProposalWithModels(proposal assistantImageProposal, run *store.AssistantRun, models []map[string]any) assistantImageProposal {
	fallback := defaultAssistantProposal(run)
	modelPrompt := strings.TrimSpace(proposal.Prompt)
	proposal.FaithfulPrompt = strings.TrimSpace(run.Prompt)
	proposal.EnhancedPrompt = strings.TrimSpace(proposal.EnhancedPrompt)
	if proposal.EnhancedPrompt == "" {
		proposal.EnhancedPrompt = modelPrompt
	}
	if proposal.EnhancedPrompt == "" {
		proposal.EnhancedPrompt = proposal.FaithfulPrompt
	}
	defaultMode := assistantDefaultPromptMode(run, proposal.Action)
	if defaultMode == assistantPromptModeFaithful {
		proposal.PromptMode = assistantPromptModeFaithful
	} else if proposal.PromptMode != assistantPromptModeFaithful && proposal.PromptMode != assistantPromptModeEnhanced {
		proposal.PromptMode = defaultMode
	}
	if proposal.PromptMode == assistantPromptModeFaithful {
		proposal.Prompt = proposal.FaithfulPrompt
	} else {
		proposal.Prompt = proposal.EnhancedPrompt
	}
	proposal.Reason = strings.TrimSpace(proposal.Reason)
	if proposal.Reason == "" {
		proposal.Reason = fallback.Reason
	}
	proposal.PlanningSummary = strings.TrimSpace(proposal.PlanningSummary)
	if proposal.PlanningSummary == "" {
		proposal.PlanningSummary = proposal.Reason
	}
	proposal.PlanningSummary = truncateAssistantRunes(proposal.PlanningSummary, 220)
	if proposal.Action != "edit" && proposal.Action != "generate" {
		proposal.Action = fallback.Action
	}
	if proposal.ReferenceMode != assistantReferenceModeIndividual && proposal.ReferenceMode != assistantReferenceModeShared {
		proposal.ReferenceMode = assistantReferenceModeShared
	}
	if proposal.Action != "edit" {
		proposal.ReferenceMode = assistantReferenceModeShared
	}
	selectedModel := assistantProposalModel(proposal.Model, models)
	if len(models) > 0 && selectedModel == nil {
		selectedModel = assistantProposalModel(fallback.Model, models)
		if selectedModel == nil {
			selectedModel = models[0]
		}
	}
	configuredCatalog := len(models) > 0
	allowedRatios := assistantMapStrings(selectedModel, "aspectRatios")
	if !configuredCatalog && len(allowedRatios) == 0 {
		allowedRatios = assistantParamStrings(run.Params, "_modelAspectRatios")
	}
	if !configuredCatalog && len(allowedRatios) == 0 {
		allowedRatios = []string{"auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "9:21", "21:9"}
	}
	proposal.Ratio = assistantNormalizedProposalValue(allowedRatios, proposal.Ratio, fallback.Ratio)
	allowedResolutions := assistantMapStrings(selectedModel, "resolutions")
	if !configuredCatalog && len(allowedResolutions) == 0 {
		allowedResolutions = assistantParamStrings(run.Params, "_modelResolutions")
	}
	proposal.Resolution = assistantNormalizedProposalValue(allowedResolutions, proposal.Resolution, fallback.Resolution)
	countModelID := proposal.Model
	if selectedModel != nil {
		countModelID = assistantMapString(selectedModel, "id")
	}
	maxImages := assistantProposalMaxImages(countModelID, models)
	proposal.Items = normalizeAssistantImagePlanItems(proposal.Items, maxImages, proposal.Prompt)
	if len(proposal.Items) > 1 {
		proposal.Count = len(proposal.Items)
	}
	if proposal.Count < 1 || proposal.Count > maxImages {
		proposal.Count = fallback.Count
		if proposal.Count < 1 || proposal.Count > maxImages {
			proposal.Count = 1
		}
	}
	allowedQualities := assistantMapStrings(selectedModel, "qualities")
	if !configuredCatalog && len(allowedQualities) == 0 {
		allowedQualities = assistantParamStrings(run.Params, "_modelQualities")
	}
	if !configuredCatalog && len(allowedQualities) == 0 {
		allowedQualities = []string{"low", "medium", "high"}
	}
	proposal.Quality = assistantNormalizedProposalValue(allowedQualities, proposal.Quality, fallback.Quality)
	if selectedModel != nil {
		proposal.Model = assistantMapString(selectedModel, "id")
		proposal.ModelName = assistantMapString(selectedModel, "name")
	} else {
		proposal.Model = fallback.Model
		proposal.ModelName = fallback.ModelName
	}
	if proposal.Resolution == "" {
		proposal.RequestSize = ""
		proposal.Width = 0
		proposal.Height = 0
	} else {
		proposal.RequestSize = fallback.RequestSize
		proposal.Width = fallback.Width
		proposal.Height = fallback.Height
	}
	return proposal
}

func normalizeAssistantImagePlanItems(items []assistantImagePlanItem, limit int, fallbackPrompt string) []assistantImagePlanItem {
	if len(items) < 2 || limit < 2 {
		return nil
	}
	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]assistantImagePlanItem, 0, len(items))
	for index, item := range items {
		item.ID = fmt.Sprintf("item-%d", index+1)
		item.Title = strings.TrimSpace(item.Title)
		if item.Title == "" {
			item.Title = fmt.Sprintf("图片 %d", index+1)
		}
		item.Title = truncateAssistantRunes(item.Title, 40)
		item.Prompt = strings.TrimSpace(item.Prompt)
		if item.Prompt == "" {
			item.Prompt = strings.TrimSpace(fallbackPrompt)
		}
		if item.Prompt == "" {
			continue
		}
		item.Prompt = truncateAssistantRunes(item.Prompt, 12_000)
		item.ReferencedImageIDs = uniqueAssistantStrings(item.ReferencedImageIDs, 4)
		item.ReferenceImages = nil
		out = append(out, item)
	}
	if len(out) < 2 {
		return nil
	}
	for index := range out {
		out[index].ID = fmt.Sprintf("item-%d", index+1)
	}
	return out
}

func uniqueAssistantStrings(values []string, limit int) []string {
	out := make([]string, 0, min(len(values), limit))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] || len(out) >= limit {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

var assistantFaithfulPromptCue = regexp.MustCompile(`原样|不要改|别改|不要优化|无需优化|一模一样|完全一致|保持不变|照着做|提示词.{0,8}(一样|不变)|exact prompt|verbatim|do not (change|rewrite)`)

func assistantDefaultPromptMode(run *store.AssistantRun, action string) string {
	if run == nil {
		return assistantPromptModeEnhanced
	}
	if len(assistantProposalReferences(run.Params)) > 0 || action == "edit" ||
		assistantHistoricalVisualCue.MatchString(strings.ToLower(run.Prompt)) || assistantFaithfulPromptCue.MatchString(strings.ToLower(run.Prompt)) {
		return assistantPromptModeFaithful
	}
	return assistantPromptModeEnhanced
}

func assistantNormalizedProposalValue(allowed []string, requested, fallback string) string {
	if len(allowed) == 0 {
		return ""
	}
	if value, ok := assistantAllowedValue(allowed, requested); ok {
		return value
	}
	if value, ok := assistantAllowedValue(allowed, fallback); ok {
		return value
	}
	return allowed[0]
}

func assistantProposalReferences(params map[string]any) []map[string]any {
	items, _ := params["referenceImages"].([]any)
	if typed, ok := params["referenceImages"].([]map[string]any); ok {
		return append([]map[string]any(nil), typed...)
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func assistantProposalModelCatalog(params map[string]any) []map[string]any {
	if typed, ok := params["_imageModelCatalog"].([]map[string]any); ok {
		return typed
	}
	items, _ := params["_imageModelCatalog"].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func assistantProposalModel(id string, models []map[string]any) map[string]any {
	for _, model := range models {
		if assistantMapString(model, "id") == strings.TrimSpace(id) {
			return model
		}
	}
	return nil
}

func assistantProposalMaxReferences(modelID string, models []map[string]any) int {
	limit := 4
	if model := assistantProposalModel(modelID, models); model != nil {
		limit = max(0, assistantMapInt(model, "maxReferenceImages"))
	}
	return limit
}

func assistantProposalMaxImages(modelID string, models []map[string]any) int {
	limit := 4
	if model := assistantProposalModel(modelID, models); model != nil {
		if value := assistantMapInt(model, "maxImages"); value > 0 {
			limit = value
		}
	}
	return limit
}

func buildAssistantImageCatalog(history []*store.AssistantMessage, excluded ...uuid.UUID) []assistantCatalogImage {
	skip := make(map[uuid.UUID]bool, len(excluded))
	for _, id := range excluded {
		skip[id] = true
	}
	out := make([]assistantCatalogImage, 0)
	seen := map[string]bool{}
	for _, message := range history {
		if message == nil || skip[message.ID] || message.Status == "failed" {
			continue
		}
		fields := []string{"referenceImages"}
		if message.Role == "assistant" {
			fields = append(fields, "images")
		}
		for _, field := range fields {
			for index, image := range assistantMetadataImages(message.Metadata, field) {
				key := assistantMapString(image, "id")
				if key == "" {
					key = assistantMapString(image, "fileKey")
				}
				if key == "" {
					key = assistantMapString(image, "dataUrl")
				}
				if key == "" || seen[key] {
					continue
				}
				seen[key] = true
				copyImage := make(map[string]any, len(image)+1)
				for k, v := range image {
					copyImage[k] = v
				}
				id := assistantMapString(copyImage, "id")
				if id == "" {
					id = fmt.Sprintf("%s-%s-%d", message.ID, field, index+1)
					copyImage["id"] = id
				}
				description := assistantMapString(copyImage, "revisedPrompt")
				if description == "" {
					description = assistantMapString(message.Metadata, "prompt")
				}
				if description == "" {
					description = assistantMapString(copyImage, "name")
				}
				if description == "" {
					description = strings.TrimSpace(message.Content)
				}
				out = append(out, assistantCatalogImage{ID: id, Label: fmt.Sprintf("图%d", len(out)+1), Description: truncateAssistantRunes(description, 120), Image: copyImage})
			}
		}
	}
	return out
}

func assistantCatalogImageIDs(catalog []assistantCatalogImage) []string {
	ids := make([]string, 0, len(catalog))
	for _, item := range catalog {
		if strings.TrimSpace(item.ID) != "" {
			ids = append(ids, item.ID)
		}
	}
	return ids
}

func assistantHistoricalVisionCatalog(promptText string, catalog []assistantCatalogImage, currentReferences int) []assistantCatalogImage {
	limit := max(0, 4-currentReferences)
	if limit == 0 || len(catalog) == 0 || !assistantPromptAllowsHistoricalReferences(promptText, "edit") {
		return nil
	}
	selected := make([]assistantCatalogImage, 0, limit)
	seen := map[string]bool{}
	appendIndex := func(index int) {
		if index < 0 || index >= len(catalog) || len(selected) >= limit || seen[catalog[index].ID] {
			return
		}
		seen[catalog[index].ID] = true
		selected = append(selected, catalog[index])
	}
	for _, match := range regexp.MustCompile(`(?:图\s*|第)([1-9])张?`).FindAllStringSubmatch(promptText, -1) {
		appendIndex(int(match[1][0] - '1'))
	}
	chineseNumbers := map[string]int{"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "七": 6, "八": 7, "九": 8}
	for _, match := range regexp.MustCompile(`(?:图\s*|第)([一二三四五六七八九])张?`).FindAllStringSubmatch(promptText, -1) {
		appendIndex(chineseNumbers[match[1]])
	}
	if len(selected) == 0 {
		appendIndex(len(catalog) - 1)
	}
	return selected
}

func assistantMetadataImages(metadata map[string]any, field string) []map[string]any {
	if typed, ok := metadata[field].([]map[string]any); ok {
		return typed
	}
	items, _ := metadata[field].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func renderAssistantImageCatalog(catalog []assistantCatalogImage) string {
	lines := make([]string, 0, len(catalog))
	for _, item := range catalog {
		lines = append(lines, fmt.Sprintf("- %s id=%s：%s", item.Label, item.ID, item.Description))
	}
	return strings.Join(lines, "\n")
}

func renderAssistantModelCatalog(models []map[string]any) string {
	lines := make([]string, 0, len(models))
	for _, model := range models {
		lines = append(lines, fmt.Sprintf(
			"- id=%s，名称=%s，说明=%s，比例=%s，分辨率=%s，质量=%s，最多生成=%d，最多参考图=%d",
			assistantMapString(model, "id"), assistantMapString(model, "name"), assistantMapString(model, "description"),
			strings.Join(assistantMapStrings(model, "aspectRatios"), "/"), strings.Join(assistantMapStrings(model, "resolutions"), "/"),
			strings.Join(assistantMapStrings(model, "qualities"), "/"), assistantMapInt(model, "maxImages"), assistantMapInt(model, "maxReferenceImages"),
		))
	}
	return strings.Join(lines, "\n")
}

func attachAssistantProposalReferences(proposal assistantImageProposal, run *store.AssistantRun, imageCatalog []assistantCatalogImage, modelCatalog []map[string]any) assistantImageProposal {
	currentReferences := assistantProposalReferences(run.Params)
	historicalReferences := []map[string]any(nil)
	if assistantPromptAllowsHistoricalReferences(run.Prompt, proposal.Action) {
		historicalReferences = resolveAssistantProposalReferences(proposal.ReferencedImageIDs, imageCatalog, run.Prompt)
	}
	if len(currentReferences) > 0 {
		historicalReferences = nil
	}
	proposal.ReferenceImages = mergeAssistantProposalReferences(
		currentReferences, historicalReferences, assistantProposalMaxReferences(proposal.Model, modelCatalog),
	)
	if len(proposal.Items) > 1 {
		unionReferences := make([]map[string]any, 0)
		for index := range proposal.Items {
			item := &proposal.Items[index]
			itemReferences := resolveAssistantProposalReferences(item.ReferencedImageIDs, imageCatalog, run.Prompt)
			if len(itemReferences) == 0 && len(item.ReferencedImageIDs) == 0 {
				itemReferences = proposal.ReferenceImages
			}
			item.ReferenceImages = mergeAssistantProposalReferences(
				itemReferences, assistantProposalMaxReferences(proposal.Model, modelCatalog),
			)
			item.ReferencedImageIDs = assistantReferenceIDs(item.ReferenceImages)
			unionReferences = append(unionReferences, item.ReferenceImages...)
		}
		proposal.ReferenceImages = mergeAssistantProposalReferences(
			unionReferences, assistantProposalMaxReferences(proposal.Model, modelCatalog),
		)
		proposal.ReferencedImageIDs = assistantReferenceIDs(proposal.ReferenceImages)
		proposal.ReferenceMode = assistantReferenceModeShared
		proposal.Count = len(proposal.Items)
	}
	if len(proposal.ReferenceImages) == 0 {
		proposal.ReferenceMode = assistantReferenceModeShared
	} else if proposal.ReferenceMode == assistantReferenceModeIndividual &&
		len(proposal.ReferenceImages) <= assistantProposalMaxImages(proposal.Model, modelCatalog) {
		proposal.Count = len(proposal.ReferenceImages)
	}
	proposal.ReferencedImageIDs = assistantReferenceIDs(proposal.ReferenceImages)
	return proposal
}

var assistantHistoricalVisualCue = regexp.MustCompile(`这张|这幅|这个图|该图|那张|上图|上一张|前一张|最后一张|刚才.{0,8}(图|图片|画面)|之前.{0,8}(图|图片|画面)|图中|图片中|照片中|截图中|画面中|previous|last image|图\s*[1-9]|第[一二三四五六七八九1-9]张`)
var assistantFreshVisualRequest = regexp.MustCompile(`(生成|创建|制作|绘制|画|设计|做|来|给我).{0,14}([1-9一二两三四五六七八九十]\s*)?(张|幅)?\s*(新)?(图|图片|图像|海报|插画|头像|壁纸|封面|logo|标志)`)
var assistantHistoricalEditCue = regexp.MustCompile(`(?:(修改|编辑|重绘|替换|换成|改成|变成|风格化|美化|换背景|去背景|抠图|擦除|移除|删除|添加|修复|扩图|裁剪|上色).{0,12}(图|图片|图像|照片|截图|画面|文字|背景|人物|主体|颜色|构图|风格)|(图|图片|图像|照片|截图|画面|文字|背景|人物|主体|颜色|构图|风格).{0,12}(修改|编辑|重绘|替换|换成|改成|变成|风格化|美化|换背景|去背景|抠图|擦除|移除|删除|添加|修复|扩图|裁剪|上色))`)

func assistantPromptAllowsHistoricalReferences(prompt, action string) bool {
	text := strings.ToLower(strings.TrimSpace(prompt))
	if text == "" {
		return false
	}
	if assistantHistoricalVisualCue.MatchString(text) {
		return true
	}
	if assistantFreshVisualRequest.MatchString(text) {
		return false
	}
	return action == "edit" && assistantHistoricalEditCue.MatchString(text)
}

func resolveAssistantProposalReferences(ids []string, catalog []assistantCatalogImage, prompt string) []map[string]any {
	byID := map[string]map[string]any{}
	for _, item := range catalog {
		byID[item.ID] = item.Image
	}
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		if image := byID[strings.TrimSpace(id)]; image != nil {
			out = append(out, image)
		}
	}
	if len(out) == 0 && len(catalog) > 0 && regexp.MustCompile(`上一张|最后一张|刚才那张|previous|last image`).MatchString(strings.ToLower(prompt)) {
		out = append(out, catalog[len(catalog)-1].Image)
	}
	if len(out) == 0 && len(catalog) > 0 {
		if match := regexp.MustCompile(`(?:第|图\s*)([1-9])张?`).FindStringSubmatch(prompt); len(match) == 2 {
			index := int(match[1][0] - '1')
			if index >= 0 && index < len(catalog) {
				out = append(out, catalog[index].Image)
			}
		}
		if match := regexp.MustCompile(`第?([一二三四五六七八九])张|图([一二三四五六七八九])`).FindStringSubmatch(prompt); len(match) == 3 {
			value := match[1]
			if value == "" {
				value = match[2]
			}
			index := map[string]int{"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "七": 6, "八": 7, "九": 8}[value]
			if index >= 0 && index < len(catalog) {
				out = append(out, catalog[index].Image)
			}
		}
	}
	return out
}

func mergeAssistantProposalReferences(groups ...any) []map[string]any {
	limit := 4
	if len(groups) > 0 {
		if value, ok := groups[len(groups)-1].(int); ok {
			limit = value
			groups = groups[:len(groups)-1]
		}
	}
	out := make([]map[string]any, 0, limit)
	seen := map[string]bool{}
	for _, group := range groups {
		images, _ := group.([]map[string]any)
		for _, image := range images {
			key := assistantMapString(image, "id")
			if key == "" {
				key = assistantMapString(image, "fileKey")
			}
			if key == "" {
				key = assistantMapString(image, "dataUrl")
			}
			if key == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, image)
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}

func assistantReferenceIDs(images []map[string]any) []string {
	out := make([]string, 0, len(images))
	for _, image := range images {
		if id := assistantMapString(image, "id"); id != "" {
			out = append(out, id)
		}
	}
	return out
}

func assistantMapStrings(item map[string]any, key string) []string {
	if item == nil {
		return nil
	}
	if typed, ok := item[key].([]string); ok {
		return typed
	}
	values, _ := item[key].([]any)
	out := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, text)
		}
	}
	return out
}
func assistantMapInt(item map[string]any, key string) int {
	if item == nil {
		return 0
	}
	switch value := item[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	}
	return 0
}

func assistantParamStrings(params map[string]any, key string) []string {
	items, _ := params[key].([]any)
	if typed, ok := params[key].([]string); ok {
		return typed
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if value, ok := item.(string); ok && strings.TrimSpace(value) != "" {
			out = append(out, value)
		}
	}
	return out
}

func assistantAllowedValue(values []string, value string) (string, bool) {
	for _, candidate := range values {
		if strings.EqualFold(strings.TrimSpace(candidate), strings.TrimSpace(value)) {
			return candidate, true
		}
	}
	return "", false
}

type assistantChatTextClient interface {
	CompleteChatTextWithImages(context.Context, []sub2api.Message, []string, func(string, string) error) (sub2api.ChatCompletion, error)
}

func parseLeadingAssistantSearchInvocation(text string) (argument, suffix string, complete bool) {
	trimmed := strings.TrimLeftFunc(text, unicode.IsSpace)
	const prefix = "search("
	if !strings.HasPrefix(trimmed, prefix) {
		return "", "", false
	}

	input := trimmed[len(prefix):]
	decoder := json.NewDecoder(strings.NewReader(input))
	if err := decoder.Decode(&argument); err != nil {
		return "", "", false
	}
	consumed := int(decoder.InputOffset())
	remainder := input[consumed:]
	closeOffset := len(remainder) - len(strings.TrimLeftFunc(remainder, unicode.IsSpace))
	if closeOffset >= len(remainder) || remainder[closeOffset] != ')' {
		return "", "", false
	}
	return argument, remainder[closeOffset+1:], true
}

func assistantLeakedSearchMatchesPrompt(argument, prompt string) bool {
	argument = strings.TrimSpace(argument)
	prompt = strings.TrimSpace(prompt)
	if argument == "" || prompt == "" || !strings.HasPrefix(strings.ToLower(argument), "user:") {
		return false
	}
	if argument == prompt {
		return true
	}
	return strings.TrimSpace(argument[len("user:"):]) == prompt
}

func cleanAssistantChatOutput(text, prompt string) (string, bool) {
	argument, suffix, complete := parseLeadingAssistantSearchInvocation(text)
	if !complete || !assistantLeakedSearchMatchesPrompt(argument, prompt) {
		return text, false
	}
	return strings.TrimLeftFunc(suffix, unicode.IsSpace), true
}

func visibleAssistantChatOutput(text, prompt string) (string, bool) {
	if cleaned, leaked := cleanAssistantChatOutput(text, prompt); leaked {
		return cleaned, strings.TrimSpace(cleaned) == ""
	}
	trimmed := strings.TrimLeftFunc(text, unicode.IsSpace)
	if strings.HasPrefix("search(", trimmed) || strings.HasPrefix(trimmed, "search(") {
		if _, _, complete := parseLeadingAssistantSearchInvocation(text); !complete {
			return "", true
		}
	}
	return text, false
}

func requestAssistantChatText(
	ctx context.Context,
	client assistantChatTextClient,
	payload []sub2api.Message,
	prompt string,
	onText func(string, string) error,
	onLeak func(attempt int, hasUsableSuffix bool),
) (string, sub2api.ChatUsage, error) {
	requestPayload := payload
	for attempt := 0; attempt < assistantChatAttempts; attempt++ {
		result, err := client.CompleteChatTextWithImages(ctx, requestPayload, nil, func(fullText, reasoning string) error {
			visible, hold := visibleAssistantChatOutput(fullText, prompt)
			if hold || onText == nil {
				return nil
			}
			return onText(visible, reasoning)
		})
		if err != nil {
			return result.Text, result.Usage, err
		}
		cleaned, leaked := cleanAssistantChatOutput(result.Text, prompt)
		if leaked && onLeak != nil {
			onLeak(attempt+1, strings.TrimSpace(cleaned) != "")
		}
		if !leaked || strings.TrimSpace(cleaned) != "" {
			if onText != nil && strings.TrimSpace(result.Reasoning) != "" {
				_ = onText(cleaned, result.Reasoning)
			}
			return cleaned, result.Usage, nil
		}
		if attempt == assistantChatAttempts-1 {
			return "", result.Usage, errAssistantLeakedToolOutput
		}
		requestPayload = make([]sub2api.Message, 0, len(payload)+1)
		requestPayload = append(requestPayload, sub2api.Message{Role: "system", Content: assistantChatRetryInstruction})
		requestPayload = append(requestPayload, payload...)
	}
	return "", sub2api.ChatUsage{}, errAssistantLeakedToolOutput
}

func (w *Worker) executeAssistantChat(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	messages, err := store.ListAssistantMessages(ctx, w.St.Pool, run.ConversationID, assistantMessageLimitForContext)
	if err != nil {
		// The current run prompt is authoritative; history is optional context.
		messages = nil
	}
	messages = assistantMessagesAfterContextBoundary(messages)
	systemPrompt := assistantChatSystemPrompt
	if len(assistantRunFileIDs(run)) > 0 {
		_, skill, skillErr := w.assistantDocumentSkill(run)
		if skillErr != nil {
			return skillErr
		}
		systemPrompt += "\n\nDocument analysis rules:\n" + skill.Instructions
	}
	nextStage := "thinking"
	if len(assistantRunFileIDs(run)) > 0 {
		nextStage = "analyzing-document"
	} else if len(references) > 0 {
		nextStage = "analyzing-image"
	}
	payload, _, err := w.prepareAssistantContext(ctx, run, "chat", systemPrompt, messages, references, false, nextStage)
	if err != nil {
		return err
	}
	lastCheckpoint := time.Now()
	lastPublish := time.Time{}
	lastTerminationCheck := time.Time{}
	answering := false
	started := time.Now()
	var firstVisible time.Time
	var latestReasoning string
	onText := func(fullText, reasoning string) error {
		if strings.TrimSpace(reasoning) != "" {
			latestReasoning = reasoning
		}
		markAssistantFirstToken(&firstVisible, fullText)
		markAssistantFirstToken(&firstVisible, latestReasoning)
		// 真流式文本经 Redis 即时推送；PostgreSQL 只保留低频断线恢复检查点。
		if (fullText != "" || latestReasoning != "") && time.Since(lastPublish) >= 50*time.Millisecond {
			lastPublish = time.Now()
			assistantstream.Publish(ctx, w.Stream, run.ID.String(),
				assistantstream.Event{Content: fullText, Reasoning: latestReasoning, Kind: "chat", Stage: "answering"})
		}
		if time.Since(lastTerminationCheck) >= 400*time.Millisecond {
			lastTerminationCheck = time.Now()
			if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
				if err != nil {
					return err
				}
				return context.Canceled
			}
		}
		if !answering {
			if err := w.setAssistantRunStage(ctx, run, "chat", "answering"); err != nil {
				return err
			}
			answering = true
		}
		if fullText == "" || time.Since(lastCheckpoint) < time.Second {
			return nil
		}
		lastCheckpoint = time.Now()
		metadata := assistantMessageMetadata(run, nil, "answering", "")
		attachAssistantReasoning(metadata, latestReasoning)
		return store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, fullText, "chat", "running", metadata)
	}
	var text string
	var usedTools []string
	var artifacts []map[string]any
	var usage sub2api.ChatUsage
	if len(assistantRunFileIDs(run)) > 0 {
		text, usedTools, artifacts, usage, err = w.requestAssistantDocumentText(ctx, client, run, payload, onText)
	} else if assistantArtifactRequested(run.Prompt) {
		text, usedTools, artifacts, usage, err = w.requestAssistantArtifactText(ctx, client, run, payload, onText)
	} else {
		text, usage, err = requestAssistantChatText(ctx, client, payload, run.Prompt, onText, func(attempt int, hasUsableSuffix bool) {
			log.Printf("assistant run %s filtered leaked search prefix model=%s attempt=%d usable_suffix=%t",
				run.ID, client.ChatModel(), attempt, hasUsableSuffix)
		})
	}
	if err != nil {
		return &assistantProviderError{err: err, outputStarted: strings.TrimSpace(text) != "" || len(artifacts) > 0}
	}
	if strings.TrimSpace(text) == "" {
		text = "没有收到模型回复，请重试。"
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	usage = finalizeAssistantUsage(usage, started, firstVisible, run, text)
	attachAssistantUsage(metadata, usage)
	attachAssistantReasoning(metadata, latestReasoning)
	if len(usedTools) > 0 {
		metadata["toolsUsed"] = usedTools
		if len(assistantRunFileIDs(run)) > 0 {
			metadata["skill"] = assistanttools.SkillDocumentAnalysis
		}
	}
	if len(artifacts) > 0 {
		metadata["artifacts"] = artifacts
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, "chat", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "chat")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Content: text, Reasoning: latestReasoning, Kind: "chat", Done: true, Status: "succeeded", Usage: usage.Map()})
	return nil
}

func (w *Worker) storeAssistantImageBytes(ctx context.Context, run *store.AssistantRun, index, count int, data []byte, revisedPrompt string) (map[string]any, error) {
	if maskKey := assistantParamString(run.Params, "_maskKey", ""); maskKey != "" {
		baseKey := assistantParamString(run.Params, "_maskBaseKey", "")
		rect, err := media.ParseMaskRect(assistantParamString(run.Params, "_maskRect", ""))
		if err != nil || baseKey == "" {
			return nil, errors.New("局部编辑参数无效")
		}
		maskData, err := w.loadTaskImageBytes(ctx, maskKey)
		if err != nil {
			return nil, fmt.Errorf("读取局部编辑蒙版失败: %w", err)
		}
		baseData, err := w.loadTaskImageBytes(ctx, baseKey)
		if err != nil {
			return nil, fmt.Errorf("读取局部编辑底图失败: %w", err)
		}
		data, err = media.CompositeMaskedEdit(baseData, maskData, data, rect)
		if err != nil {
			return nil, fmt.Errorf("局部编辑结果合成失败: %w", err)
		}
	}
	if len(data) == 0 || len(data) > assistantOutputLimit {
		return nil, errors.New("上游图片超过大小限制")
	}
	contentType, ext := assistantImageType(data)
	if contentType == "" || ext == "" {
		return nil, errors.New("上游返回了不支持的图片格式")
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return nil, fmt.Errorf("上游返回的图片无法读取: %w", err)
	}
	key := fmt.Sprintf("tasks/%s/assistant/%s/%d.%s", run.UserID, run.ID, index+1, ext)
	if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
		return nil, &assistantStorageError{err: err}
	}
	stored := map[string]any{
		"id": uuid.NewString(), "index": index, "dataUrl": "/api/v1/files/" + key, "fileKey": key,
		"revisedPrompt": revisedPrompt,
	}
	// 小图/展示图变体：尽力而为，失败只影响加载速度（前端回退原图）。
	thumbURL, displayURL := "", ""
	variantKeys := store.AssistantVariantKeys(key)
	if len(variantKeys) == 2 {
		variantCfg := w.imageVariantConfig(ctx)
		if thumb, err := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Quality: 75, MaxEdge: variantCfg.ThumbMaxEdge,
		}); err == nil {
			if err := w.Storage.UploadBytes(ctx, variantKeys[0], thumb.Data, thumb.ContentType); err == nil {
				thumbURL = "/api/v1/files/" + variantKeys[0]
				stored["thumbUrl"] = thumbURL
			}
		}
		if display, err := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Lossless: variantCfg.Lossless,
			Quality: variantCfg.Quality, MaxEdge: variantCfg.DisplayMaxEdge,
		}); err == nil {
			if err := w.Storage.UploadBytes(ctx, variantKeys[1], display.Data, display.ContentType); err == nil {
				displayURL = "/api/v1/files/" + variantKeys[1]
				stored["displayUrl"] = displayURL
			}
		}
	}
	stage := run.Stage
	if stage == "" {
		stage = "saving-image"
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Kind: "image", Stage: stage, ImageTotal: count,
		Image: &assistantstream.ImageEvent{
			ID: stored["id"].(string), Index: index, DataURL: stored["dataUrl"].(string),
			FileKey: key, ThumbURL: thumbURL, DisplayURL: displayURL, RevisedPrompt: revisedPrompt,
		},
	})
	return stored, nil
}

func assistantImageOutputKeys(images []map[string]any) []string {
	keys := make([]string, 0, len(images))
	seen := make(map[string]struct{}, len(images))
	for _, image := range images {
		key := strings.TrimSpace(assistantMapString(image, "fileKey"))
		if !strings.HasPrefix(key, "tasks/") {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func (w *Worker) enqueueAssistantOutputCleanup(keys []string) {
	if w == nil || w.St == nil || len(keys) == 0 {
		return
	}
	// 把约定路径下的小图/展示图变体一并清理。
	for _, key := range keys[:len(keys):len(keys)] {
		keys = append(keys, store.AssistantVariantKeys(key)...)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.EnqueueObjectCleanup(ctx, w.St.Pool, keys); err != nil {
		log.Printf("assistant output cleanup enqueue failed: %v", err)
	}
}

func (w *Worker) completeAssistantImageRun(ctx context.Context, run *store.AssistantRun, storedByIndex []map[string]any, expected, actual int) error {
	stored := compactAssistantImages(storedByIndex)
	content := "图片已生成"
	if actual < expected {
		content = fmt.Sprintf("已生成 %d/%d 张图片，其余图片经自动重试后仍未完成", actual, expected)
	}
	metadata := assistantMessageMetadata(run, stored, "complete", "")
	attachAssistantUsage(metadata, assistantUsageFromStartedAt(run))
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, content, "image", "complete",
		metadata); err != nil {
		w.enqueueAssistantOutputCleanup(assistantImageOutputKeys(stored))
		return err
	}
	completed, err := assistantbilling.CompleteImageAttempt(ctx, w.St, run.ID, run.Attempt, actual)
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	settled := run
	if latest, loadErr := store.GetAssistantRun(ctx, w.St.Pool, run.ID); loadErr == nil && latest != nil {
		settled = latest
	}
	if _, _, persistErr := store.SyncUIDesignAssetHistoryFromRun(ctx, w.St.Pool, settled, assistantImageOutputKeys(stored)); persistErr != nil {
		log.Printf("ui design asset history persist failed for run %s: %v", run.ID, persistErr)
	} else if settled != nil {
		if history, histErr := store.GetTaskByIdemKey(ctx, w.St.Pool, settled.UserID, store.UIDesignAssetHistoryIdempotencyKey(settled.ID)); histErr == nil && history != nil {
			w.publishTaskEvent(ctx, history, taskstream.Event{
				Stage: "complete", Status: history.Status, ImageCount: len(history.OutputKeys), Done: true,
			})
		}
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(),
		assistantstream.Event{Kind: "image", Done: true, Status: "succeeded", ImageTotal: expected, Usage: assistantUsageFromStartedAt(run).Map()})
	return nil
}

func (w *Worker) executeAssistantImageC2A(ctx context.Context, run *store.AssistantRun, references []string, serviceKey string) error {
	taskType := "t2i"
	if serviceKey == "ui_design_asset" {
		taskType = "ui_design"
	}
	model, err := settings.TaskModel(ctx, w.St.Pool, taskType)
	if err != nil {
		return err
	}
	client := w.upstreamClient(ctx)
	return w.executeAssistantImageC2AClient(ctx, run, references, client, model)
}

func generateAssistantC2AItems(
	ctx context.Context,
	runID string,
	count int,
	generate func(context.Context, string) ([]string, error),
	onImage func(int, string) error,
) (int, error) {
	if count < 1 {
		return 0, errors.New("assistant image count must be positive")
	}
	images, generateErr := generate(ctx, runID)
	actual := 0
	for index, encoded := range images {
		if index >= count || strings.TrimSpace(encoded) == "" {
			continue
		}
		if err := onImage(index, encoded); err != nil {
			return actual, err
		}
		actual++
	}
	if actual == 0 {
		if generateErr != nil {
			return 0, generateErr
		}
		return 0, errors.New("上游未返回图片")
	}
	// Preserve useful partial output. The completion path settles only the
	// images that were actually returned and releases the remaining reserve.
	return actual, nil
}

func generateAssistantC2AIndividualItems(
	ctx context.Context,
	runID string,
	count int,
	generate func(context.Context, string, int) ([]string, error),
	onImage func(int, string) error,
) (int, error) {
	if count < 1 {
		return 0, errors.New("assistant image count must be positive")
	}
	batchCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan assistantC2AImageResult, count)
	for index := 0; index < count; index++ {
		go func(index int) {
			taskID := fmt.Sprintf("%s-%d", runID, index+1)
			currentTaskID := taskID
			var lastErr error
			for attempt := 0; attempt < assistantC2AItemAttempts; attempt++ {
				images, err := generate(batchCtx, currentTaskID, index)
				if len(images) > 0 && strings.TrimSpace(images[0]) != "" {
					results <- assistantC2AImageResult{index: index, encoded: images[0]}
					return
				}
				if err == nil {
					err = errors.New("上游图片任务未返回图片")
				}
				lastErr = err
				if !c2a.IsRetryableError(err) || attempt == assistantC2AItemAttempts-1 {
					break
				}
				var networkErr *c2a.NetworkError
				if !errors.As(err, &networkErr) {
					currentTaskID = fmt.Sprintf("%s-retry-%d", taskID, attempt+1)
				}
			}
			results <- assistantC2AImageResult{index: index, err: lastErr}
		}(index)
	}

	actual := 0
	var firstGenerateErr error
	var callbackErr error
	for range count {
		result := <-results
		if result.err != nil {
			if firstGenerateErr == nil {
				firstGenerateErr = result.err
			}
			continue
		}
		if callbackErr != nil {
			continue
		}
		if err := onImage(result.index, result.encoded); err != nil {
			callbackErr = err
			cancel()
			continue
		}
		actual++
	}
	if callbackErr != nil {
		return actual, callbackErr
	}
	if actual == 0 {
		if firstGenerateErr != nil {
			return 0, firstGenerateErr
		}
		return 0, errors.New("上游未返回图片")
	}
	return actual, nil
}

func assistantImageExecutionPlan(params map[string]any) ([]assistantImageExecutionItem, error) {
	items := assistantMetadataImages(params, "imagePlanItems")
	if len(items) < 2 {
		return nil, nil
	}
	references := assistantMetadataImages(params, "referenceImages")
	referenceIndexes := map[string]int{}
	for index, reference := range references {
		for _, key := range []string{"id", "fileKey"} {
			if value := assistantMapString(reference, key); value != "" {
				referenceIndexes[value] = index
			}
		}
	}
	out := make([]assistantImageExecutionItem, 0, len(items))
	for index, item := range items {
		promptText := strings.TrimSpace(assistantMapString(item, "prompt"))
		if promptText == "" {
			return nil, fmt.Errorf("第 %d 张图片缺少独立提示词", index+1)
		}
		execution := assistantImageExecutionItem{Title: assistantMapString(item, "title"), Prompt: promptText}
		seen := map[int]bool{}
		for _, id := range assistantMapStrings(item, "referenceImageIds") {
			referenceIndex, ok := referenceIndexes[id]
			if !ok {
				return nil, fmt.Errorf("第 %d 张图片引用了不存在的参考图", index+1)
			}
			if !seen[referenceIndex] {
				seen[referenceIndex] = true
				execution.ReferenceIndexes = append(execution.ReferenceIndexes, referenceIndex)
			}
		}
		out = append(out, execution)
	}
	return out, nil
}

func assistantExecutionReferences[T any](values []T, indexes []int) ([]T, error) {
	out := make([]T, 0, len(indexes))
	for _, index := range indexes {
		if index < 0 || index >= len(values) {
			return nil, errors.New("独立多图方案的参考图映射无效")
		}
		out = append(out, values[index])
	}
	return out, nil
}

func generateAssistantSub2PlanItems(
	ctx context.Context,
	client *sub2api.Client,
	plan []assistantImageExecutionItem,
	references []string,
	params map[string]any,
	size string,
	quality string,
	onImage func(int, sub2api.Image) error,
) (int, error) {
	batchCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan assistantSub2ImageResult, len(plan))
	for index := range plan {
		go func(index int) {
			itemReferences, err := assistantExecutionReferences(references, plan[index].ReferenceIndexes)
			if err != nil {
				results <- assistantSub2ImageResult{index: index, err: err}
				return
			}
			var generated sub2api.Image
			images, err := client.GenerateImageProgressive(batchCtx,
				prompt.ConstrainAutoAspectRatio(plan[index].Prompt, params), size, quality, 1, itemReferences,
				func(_ int, image sub2api.Image) error {
					generated = image
					return nil
				})
			if generated.DataURL == "" && len(images) > 0 {
				generated = images[0]
			}
			if err == nil && generated.DataURL == "" {
				err = errors.New("上游图片任务未返回图片")
			}
			results <- assistantSub2ImageResult{index: index, image: generated, err: err}
		}(index)
	}
	actual := 0
	var firstErr error
	for range plan {
		result := <-results
		if result.err != nil {
			if firstErr == nil {
				firstErr = result.err
			}
			continue
		}
		if err := onImage(result.index, result.image); err != nil {
			cancel()
			return actual, err
		}
		actual++
	}
	if actual == 0 {
		if firstErr != nil {
			return 0, firstErr
		}
		return 0, errors.New("上游未返回图片")
	}
	return actual, nil
}

func (w *Worker) executeAssistantImageC2AClient(ctx context.Context, run *store.AssistantRun, references []string, client *c2a.Client, model string) error {
	finalPrompt := prompt.ConstrainAutoAspectRatio(run.Prompt, run.Params)
	size := assistantParamString(run.Params, "requestSize", "")
	if size == "auto" {
		size = ""
	}
	quality := assistantParamString(run.Params, "quality", "high")
	count := assistantParamInt(run.Params, "count", 2)
	inputs := make([]string, 0, len(references))
	for _, reference := range references {
		data, _, _, loadErr := downloadAssistantImage(ctx, reference)
		if loadErr != nil {
			return loadErr
		}
		inputs = append(inputs, base64.StdEncoding.EncodeToString(data))
	}
	storedByIndex := make([]map[string]any, count)
	if err := w.setAssistantImageStage(ctx, run, "generating-image", nil); err != nil {
		return err
	}
	var fetchingStarted atomic.Bool
	var savingStarted atomic.Bool
	onImage := func(index int, encoded string) error {
		if terminated, terminateErr := w.assistantRunTerminated(ctx, run.ID); terminateErr != nil || terminated {
			if terminateErr != nil {
				return terminateErr
			}
			return context.Canceled
		}
		if fetchingStarted.CompareAndSwap(false, true) {
			if err := w.setAssistantImageStage(ctx, run, "fetching-image", compactAssistantImages(storedByIndex)); err != nil {
				return err
			}
		}
		data, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil {
			return decodeErr
		}
		if savingStarted.CompareAndSwap(false, true) {
			if err := w.setAssistantImageStage(ctx, run, "saving-image", compactAssistantImages(storedByIndex)); err != nil {
				return err
			}
		}
		stored, storeErr := w.storeAssistantImageBytes(ctx, run, index, count, data, "")
		if storeErr != nil {
			return storeErr
		}
		storedByIndex[index] = stored
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, compactAssistantImages(storedByIndex), "saving-image", "")); err != nil {
			w.enqueueAssistantOutputCleanup([]string{assistantMapString(stored, "fileKey")})
			return err
		}
		return nil
	}
	var actual int
	var err error
	plan, planErr := assistantImageExecutionPlan(run.Params)
	if planErr != nil {
		return planErr
	}
	if len(plan) > 0 {
		if len(plan) != count {
			return fmt.Errorf("独立多图方案数量不一致：方案 %d 张，输出 %d 张", len(plan), count)
		}
		actual, err = generateAssistantC2AIndividualItems(ctx, run.ID.String(), count,
			func(itemCtx context.Context, taskID string, index int) ([]string, error) {
				itemInputs, mapErr := assistantExecutionReferences(inputs, plan[index].ReferenceIndexes)
				if mapErr != nil {
					return nil, mapErr
				}
				itemPrompt := prompt.ConstrainAutoAspectRatio(plan[index].Prompt, run.Params)
				if len(itemInputs) > 0 {
					return client.EditImagesWithID(itemCtx, taskID, itemPrompt, model, 1, itemInputs, size, quality)
				}
				return client.GenerateImagesWithID(itemCtx, taskID, itemPrompt, model, 1, size, quality)
			}, onImage)
	} else if assistantParamString(run.Params, "referenceMode", assistantReferenceModeShared) == assistantReferenceModeIndividual {
		if len(inputs) != count {
			return fmt.Errorf("逐张编辑要求参考图数量与输出数量一致：参考图 %d 张，输出 %d 张", len(inputs), count)
		}
		actual, err = generateAssistantC2AIndividualItems(ctx, run.ID.String(), count,
			func(itemCtx context.Context, taskID string, index int) ([]string, error) {
				return client.EditImagesWithID(itemCtx, taskID, finalPrompt, model, 1, []string{inputs[index]}, size, quality)
			}, onImage)
	} else {
		actual, err = generateAssistantC2AItems(ctx, run.ID.String(), count, func(itemCtx context.Context, taskID string) ([]string, error) {
			if len(inputs) > 0 {
				return client.EditImagesWithID(itemCtx, taskID, finalPrompt, model, count, inputs, size, quality)
			}
			return client.GenerateImagesWithID(itemCtx, taskID, finalPrompt, model, count, size, quality)
		}, onImage)
	}
	if err != nil {
		return err
	}
	return w.completeAssistantImageRun(ctx, run, storedByIndex, count, actual)
}

func (w *Worker) crunAssistantReferenceURLs(ctx context.Context, run *store.AssistantRun) ([]string, []string, error) {
	items := assistantMetadataImages(run.Params, "referenceImages")
	urls := make([]string, 0, len(items))
	temporaryKeys := make([]string, 0, len(items))
	for index, item := range items {
		key := assistantMapString(item, "fileKey")
		value := assistantMapString(item, "dataUrl")
		if key == "" && strings.HasPrefix(value, "/api/v1/files/") {
			key = strings.TrimPrefix(value, "/api/v1/files/")
		}
		if key != "" {
			presigned, err := w.Storage.PresignGet(ctx, key)
			if err != nil {
				return nil, temporaryKeys, err
			}
			urls = append(urls, presigned)
			continue
		}
		if strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") {
			urls = append(urls, value)
			continue
		}
		if strings.HasPrefix(value, "data:image/") {
			data, contentType, ext, err := downloadAssistantImage(ctx, value)
			if err != nil {
				return nil, temporaryKeys, err
			}
			key = fmt.Sprintf("tasks/%s/assistant/%s/crun-input/%d.%s", run.UserID, run.ID, index+1, ext)
			if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
				return nil, temporaryKeys, err
			}
			temporaryKeys = append(temporaryKeys, key)
			presigned, err := w.Storage.PresignGet(ctx, key)
			if err != nil {
				return nil, temporaryKeys, err
			}
			urls = append(urls, presigned)
		}
	}
	return urls, temporaryKeys, nil
}

func (w *Worker) executeAssistantImageCRUN(ctx context.Context, run *store.AssistantRun) error {
	client, err := w.crunClient(ctx)
	if err != nil {
		return err
	}
	return w.executeAssistantImageCRUNClient(ctx, run, client, nil)
}

func createAssistantCRUNImageTasks(
	ctx context.Context,
	client *crun.Client,
	request crun.OpenAIImageRequest,
	referenceMode string,
	existing []string,
	onCreated func([]string) error,
) ([]string, error) {
	if referenceMode != assistantReferenceModeIndividual {
		return client.CreateImageTasks(ctx, request, existing, onCreated)
	}
	if len(request.ImageURLs) != request.N || request.N < 1 {
		return nil, fmt.Errorf("逐张编辑要求参考图数量与输出数量一致：参考图 %d 张，输出 %d 张", len(request.ImageURLs), request.N)
	}
	taskIDs := append([]string(nil), existing...)
	if len(taskIDs) > request.N {
		taskIDs = taskIDs[:request.N]
	}
	for len(taskIDs) < request.N {
		index := len(taskIDs)
		itemRequest := request
		itemRequest.N = 1
		itemRequest.ImageURLs = []string{request.ImageURLs[index]}
		taskID, err := client.CreateTaskWithRequest(ctx, itemRequest)
		if err != nil {
			return nil, err
		}
		taskIDs = append(taskIDs, taskID)
		if onCreated != nil {
			if err := onCreated(append([]string(nil), taskIDs...)); err != nil {
				return nil, err
			}
		}
	}
	return taskIDs, nil
}

func createAssistantCRUNPlanTasks(
	ctx context.Context,
	client *crun.Client,
	base crun.OpenAIImageRequest,
	plan []assistantImageExecutionItem,
	references []string,
	params map[string]any,
	existing []string,
	onCreated func([]string) error,
) ([]string, error) {
	taskIDs := append([]string(nil), existing...)
	if len(taskIDs) > len(plan) {
		taskIDs = taskIDs[:len(plan)]
	}
	for len(taskIDs) < len(plan) {
		index := len(taskIDs)
		itemReferences, err := assistantExecutionReferences(references, plan[index].ReferenceIndexes)
		if err != nil {
			return nil, err
		}
		request := base
		request.N = 1
		request.Prompt = crunPrompt(prompt.ConstrainAutoAspectRatio(plan[index].Prompt, params))
		request.ImageURLs = itemReferences
		taskID, err := client.CreateTaskWithRequest(ctx, request)
		if err != nil {
			return nil, err
		}
		taskIDs = append(taskIDs, taskID)
		if onCreated != nil {
			if err := onCreated(append([]string(nil), taskIDs...)); err != nil {
				return nil, err
			}
		}
	}
	return taskIDs, nil
}

func (w *Worker) executeAssistantImageCRUNClient(
	ctx context.Context,
	run *store.AssistantRun,
	client *crun.Client,
	allowedInputFields []string,
) error {
	finalPrompt := prompt.ConstrainAutoAspectRatio(run.Prompt, run.Params)
	references, temporaryKeys, err := w.crunAssistantReferenceURLs(ctx, run)
	if len(temporaryKeys) > 0 {
		defer w.enqueueAssistantOutputCleanup(temporaryKeys)
	}
	if err != nil {
		return err
	}
	count := assistantParamInt(run.Params, "count", 2)
	aspectRatio := normalizeCRUNAspectRatio(run.Params, assistantParamString(run.Params, "requestSize", ""))
	resolution := normalizeCRUNResolutionForAspect(normalizeCRUNResolution(run.Params), aspectRatio)
	request := crun.OpenAIImageRequest{
		Prompt: crunPrompt(finalPrompt), N: count,
		Size:    assistantParamString(run.Params, "requestSize", ""),
		Quality: assistantParamString(run.Params, "quality", ""), ImageURLs: references,
		AspectRatio: aspectRatio, Resolution: resolution,
		AllowedInputFields: allowedInputFields,
	}
	if err := w.setAssistantImageStage(ctx, run, "generating-image", nil); err != nil {
		return err
	}
	plan, planErr := assistantImageExecutionPlan(run.Params)
	if planErr != nil {
		return planErr
	}
	onCreated := func(created []string) error {
		if err := store.SetAssistantRunCRUNTaskIDs(ctx, w.St.Pool, run.ID, created); err != nil {
			return err
		}
		run.Params["_crunTaskIds"] = append([]string(nil), created...)
		return nil
	}
	var taskIDs []string
	if len(plan) > 0 {
		if len(plan) != count {
			return fmt.Errorf("独立多图方案数量不一致：方案 %d 张，输出 %d 张", len(plan), count)
		}
		taskIDs, err = createAssistantCRUNPlanTasks(ctx, client, request, plan, references, run.Params,
			taskParamStrings(run.Params, "_crunTaskIds"), onCreated)
	} else {
		taskIDs, err = createAssistantCRUNImageTasks(ctx, client, request,
			assistantParamString(run.Params, "referenceMode", assistantReferenceModeShared),
			taskParamStrings(run.Params, "_crunTaskIds"), onCreated)
	}
	if err != nil {
		return err
	}
	storedByIndex := make([]map[string]any, count)
	var fetchingStarted atomic.Bool
	var savingStarted atomic.Bool
	images, err := client.WaitTasks(ctx, taskIDs, func(index int, imageURL string) error {
		if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		if fetchingStarted.CompareAndSwap(false, true) {
			if err := w.setAssistantImageStage(ctx, run, "fetching-image", compactAssistantImages(storedByIndex)); err != nil {
				return err
			}
		}
		data, _, _, err := downloadAssistantImage(ctx, imageURL)
		if err != nil {
			return err
		}
		if savingStarted.CompareAndSwap(false, true) {
			if err := w.setAssistantImageStage(ctx, run, "saving-image", compactAssistantImages(storedByIndex)); err != nil {
				return err
			}
		}
		stored, err := w.storeAssistantImageBytes(ctx, run, index, count, data, "")
		if err != nil {
			return err
		}
		storedByIndex[index] = stored
		if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, compactAssistantImages(storedByIndex), "saving-image", "")); err != nil {
			w.enqueueAssistantOutputCleanup([]string{assistantMapString(stored, "fileKey")})
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	return w.completeAssistantImageRun(ctx, run, storedByIndex, count, len(images))
}

func (w *Worker) executeAssistantImage(ctx context.Context, client *sub2api.Client, run *store.AssistantRun, references []string) error {
	finalPrompt := prompt.ConstrainAutoAspectRatio(run.Prompt, run.Params)
	size := assistantParamString(run.Params, "requestSize", "auto")
	quality := assistantParamString(run.Params, "quality", "high")
	count := assistantParamInt(run.Params, "count", 2)
	storedByIndex := make([]map[string]any, count)
	if err := w.setAssistantImageStage(ctx, run, "generating-image", nil); err != nil {
		return err
	}
	requestCtx, cancelRequest := context.WithTimeout(ctx, assistantSynchronousImageLimit)
	defer cancelRequest()
	var fetchingStarted atomic.Bool
	var savingStarted atomic.Bool
	storeImage := func(index int, image sub2api.Image) error {
		if terminated, err := w.assistantRunTerminated(requestCtx, run.ID); err != nil || terminated {
			if err != nil {
				return err
			}
			return context.Canceled
		}
		if fetchingStarted.CompareAndSwap(false, true) {
			if err := w.setAssistantImageStage(requestCtx, run, "fetching-image", compactAssistantImages(storedByIndex)); err != nil {
				return err
			}
		}
		data, _, _, err := downloadAssistantImage(requestCtx, image.DataURL)
		if err != nil {
			return err
		}
		if savingStarted.CompareAndSwap(false, true) {
			if err := w.setAssistantImageStage(requestCtx, run, "saving-image", compactAssistantImages(storedByIndex)); err != nil {
				return err
			}
		}
		stored, err := w.storeAssistantImageBytes(requestCtx, run, index, count, data, image.RevisedPrompt)
		if err != nil {
			return err
		}
		storedByIndex[index] = stored
		partial := compactAssistantImages(storedByIndex)
		if err := store.UpdateAssistantMessage(requestCtx, w.St.Pool, run.AssistantMessageID, "", "image", "running",
			assistantMessageMetadata(run, partial, "saving-image", "")); err != nil {
			w.enqueueAssistantOutputCleanup([]string{assistantMapString(stored, "fileKey")})
			return err
		}
		return nil
	}
	actual := 0
	var err error
	plan, planErr := assistantImageExecutionPlan(run.Params)
	if planErr != nil {
		return planErr
	}
	if len(plan) > 0 {
		if len(plan) != count {
			return fmt.Errorf("独立多图方案数量不一致：方案 %d 张，输出 %d 张", len(plan), count)
		}
		actual, err = generateAssistantSub2PlanItems(requestCtx, client, plan, references, run.Params, size, quality, storeImage)
	} else if assistantParamString(run.Params, "referenceMode", assistantReferenceModeShared) == assistantReferenceModeIndividual {
		if len(references) != count {
			return fmt.Errorf("逐张编辑要求参考图数量与输出数量一致：参考图 %d 张，输出 %d 张", len(references), count)
		}
		for index, reference := range references {
			images, generateErr := client.GenerateImageProgressive(requestCtx, finalPrompt, size, quality, 1, []string{reference}, func(_ int, image sub2api.Image) error {
				return storeImage(index, image)
			})
			actual += len(images)
			if generateErr != nil {
				err = generateErr
				break
			}
		}
	} else {
		var images []sub2api.Image
		images, err = client.GenerateImageProgressive(requestCtx, finalPrompt, size, quality, count, references, storeImage)
		actual = len(images)
	}
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
			return errors.New("图片生成超过 5 分钟仍未完成，请重试或切换图片模型")
		}
		return err
	}
	if terminated, err := w.assistantRunTerminated(ctx, run.ID); err != nil || terminated {
		if err != nil {
			return err
		}
		return context.Canceled
	}
	return w.completeAssistantImageRun(ctx, run, storedByIndex, count, actual)
}

func compactAssistantImages(images []map[string]any) []map[string]any {
	completed := make([]map[string]any, 0, len(images))
	for _, image := range images {
		if image != nil {
			completed = append(completed, image)
		}
	}
	return completed
}

func (w *Worker) assistantRunTerminated(ctx context.Context, id uuid.UUID) (bool, error) {
	run, err := store.GetAssistantRun(ctx, w.St.Pool, id)
	return run == nil || (run.Status != "queued" && run.Status != "running"), err
}

func (w *Worker) loadAssistantReferences(ctx context.Context, params map[string]any) ([]string, error) {
	if typed, ok := params["referenceImages"].([]map[string]any); ok {
		return w.loadAssistantReferenceItems(ctx, typed)
	}
	items, _ := params["referenceImages"].([]any)
	return w.loadAssistantReferenceItems(ctx, assistantMapItems(items))
}

func assistantMapItems(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, raw := range items {
		if item, ok := raw.(map[string]any); ok {
			out = append(out, item)
		}
	}
	return out
}

func (w *Worker) loadAssistantReferenceItems(ctx context.Context, items []map[string]any) ([]string, error) {
	out := make([]string, 0, len(items))
	for _, item := range items {
		key := assistantMapString(item, "fileKey")
		value := assistantMapString(item, "dataUrl")
		if key == "" && strings.HasPrefix(value, "/api/v1/files/") {
			key = strings.TrimPrefix(value, "/api/v1/files/")
		}
		if key != "" {
			data, err := w.Storage.GetBytesLimit(ctx, key, 16<<20)
			if err != nil {
				return nil, err
			}
			contentType, _ := assistantImageType(data)
			if contentType == "" {
				return nil, fmt.Errorf("assistant reference %q is not a supported image", key)
			}
			if _, _, err := media.Dimensions(data); err != nil {
				return nil, fmt.Errorf("assistant reference %q cannot be decoded: %w", key, err)
			}
			out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
			continue
		}
		if strings.HasPrefix(value, "data:image/") {
			data, contentType, _, err := downloadAssistantImage(ctx, value)
			if err != nil {
				return nil, err
			}
			if len(data) > 16<<20 {
				return nil, errors.New("assistant reference image exceeds 16 MiB")
			}
			out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
			continue
		}
		if strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") {
			out = append(out, value)
		}
	}
	return out, nil
}

func assistantMessageMetadata(run *store.AssistantRun, images []map[string]any, stage, errorMessage string) map[string]any {
	metadata := make(map[string]any, len(run.Params)+6)
	for key, value := range run.Params {
		if key == "referenceImages" || key == "canvasSnapshot" || strings.HasPrefix(key, "_mask") {
			continue
		}
		metadata[key] = value
	}
	metadata["runId"] = run.ID.String()
	metadata["statusStage"] = stage
	metadata["pending"] = stage != "complete" && stage != "failed" && stage != "stopped"
	metadata["routing"] = stage == "routing"
	if run.Mode == "chat" {
		metadata["systemPromptVersion"] = assistantChatSystemPromptVersion
	}
	if images != nil {
		metadata["images"] = images
	}
	if errorMessage != "" {
		metadata["error"] = errorMessage
	} else {
		metadata["error"] = ""
	}
	return metadata
}

func resolvedAssistantMode(run *store.AssistantRun) string {
	if run.ResolvedMode != "" {
		return run.ResolvedMode
	}
	if run.Mode == "agent" {
		return "chat"
	}
	return run.Mode
}

func assistantParamString(params map[string]any, key, fallback string) string {
	if value, ok := params[key].(string); ok && strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func assistantParamInt(params map[string]any, key string, fallback int) int {
	switch value := params[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	}
	return fallback
}

func assistantMapString(item map[string]any, key string) string {
	if item == nil {
		return ""
	}
	value, _ := item[key].(string)
	return strings.TrimSpace(value)
}

func downloadAssistantImage(ctx context.Context, source string) ([]byte, string, string, error) {
	if strings.HasPrefix(source, "data:image/") {
		parts := strings.SplitN(source, ",", 2)
		if len(parts) != 2 {
			return nil, "", "", errors.New("invalid image data URL")
		}
		data, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, "", "", err
		}
		contentType, ext := assistantImageType(data)
		if contentType == "" || ext == "" {
			return nil, "", "", errors.New("unsupported image data URL")
		}
		if _, _, err := media.Dimensions(data); err != nil {
			return nil, "", "", fmt.Errorf("invalid image data URL: %w", err)
		}
		return data, contentType, ext, nil
	}
	if err := netguard.ValidateURL(source, false, false); err != nil {
		return nil, "", "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, "", "", err
	}
	resp, err := netguard.NewHTTPClient(90*time.Second, false, false).Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("download generated image: status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, assistantOutputLimit+1))
	if err != nil || len(data) > assistantOutputLimit {
		return nil, "", "", errors.New("generated image is unavailable or too large")
	}
	contentType, ext := assistantImageType(data)
	if contentType == "" || ext == "" {
		return nil, "", "", errors.New("downloaded data is not a supported image")
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return nil, "", "", fmt.Errorf("downloaded image cannot be decoded: %w", err)
	}
	return data, contentType, ext, nil
}

func assistantImageType(data []byte) (string, string) {
	ext, contentType := media.Detect(data)
	return contentType, ext
}
