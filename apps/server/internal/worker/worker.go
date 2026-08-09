// Package worker 实现 Asynq handler：run_task + 定时任务（session 清理、僵尸回收）。
package worker

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/semaphore"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/prompt"
	"github.com/BlankLife886/startcloudsai/server/internal/promptsync"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

const (
	typeCleanupSessions      = "cron:cleanup_sessions"
	typeReapZombies          = "cron:reap_zombies"
	typeEnsureImagePolls     = "cron:ensure_image_polls"
	typeExpireTrialCampaigns = "cron:expire_trial_campaigns"
	typeSyncPromptSources    = "cron:sync_prompt_sources"
	typeBackfillPromptCovers = "cron:backfill_prompt_cover_dimensions"
	typeCleanupUserUploads   = "cron:cleanup_user_uploads"
	typeCleanupObjectJobs    = "cron:cleanup_object_jobs"

	taskCompletionLease      = 5 * time.Minute
	taskLease                = 2 * time.Minute
	taskHeartbeatInterval    = 30 * time.Second
	asyncTaskLease           = 15 * time.Minute
	upstreamAttemptPollLease = 2 * time.Minute
	staleQueuedMinutes       = 2
	maxTaskFailureRetries    = 100
	maxUpstreamMessageRunes  = 2000
	userUploadRetention      = 7 * 24 * time.Hour
	userUploadCleanupLimit   = 500
	maxTaskImageObjectBytes  = 20 << 20
	objectCleanupLimit       = 100
	objectCleanupRetryDelay  = 5 * time.Minute
)

var errTaskProviderUnavailable = errors.New("task provider unavailable")

type Worker struct {
	Cfg        *config.Config
	St         *store.Store
	Storage    *storage.Storage
	C2A        *c2a.Client
	Queue      *taskflow.Queue
	PromptSync *promptsync.Engine
	// Stream 用于把助手回答增量推给 API 层 SSE；nil 时静默降级为纯轮询。
	Stream           *redis.Client
	imageMemory      *semaphore.Weighted
	imageMemoryBytes int64
	pollWorkers      *semaphore.Weighted
	pollConcurrency  int
	workerID         string
	modelConfigMu    sync.Mutex
	modelConfig      modelconfig.Config
	modelConfigAt    time.Time
}

func (w *Worker) runtimeModelConfig(ctx context.Context) (modelconfig.Config, error) {
	w.modelConfigMu.Lock()
	defer w.modelConfigMu.Unlock()
	if !w.modelConfigAt.IsZero() && time.Since(w.modelConfigAt) < 3*time.Second {
		return w.modelConfig, nil
	}
	cfg, err := modelconfig.Runtime(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		return modelconfig.Config{}, err
	}
	w.modelConfig = cfg
	w.modelConfigAt = time.Now()
	return cfg, nil
}

func New(cfg *config.Config, st *store.Store, stg *storage.Storage, c2aClient *c2a.Client, queue *taskflow.Queue) *Worker {
	imageMemoryBytes := max(cfg.WorkerImageMemoryMiB, 64) << 20
	pollConcurrency := max(1, min(cfg.WorkerConcurrency/4, int(imageMemoryBytes/(256<<20))))
	host, _ := os.Hostname()
	workerID := fmt.Sprintf("%s:%d", host, os.Getpid())
	return &Worker{
		Cfg: cfg, St: st, Storage: stg, C2A: c2aClient, Queue: queue,
		PromptSync:       promptsync.New(st, cfg.AppEnv == "development"),
		Stream:           assistantstream.NewClient(cfg.RedisURL),
		imageMemory:      semaphore.NewWeighted(imageMemoryBytes),
		imageMemoryBytes: imageMemoryBytes,
		pollWorkers:      semaphore.NewWeighted(int64(pollConcurrency)),
		pollConcurrency:  pollConcurrency,
		workerID:         workerID,
	}
}

// Run 启动 Asynq server + PeriodicTaskManager，阻塞运行。
func (w *Worker) Run() error {
	redisOpt, err := asynq.ParseRedisURI(w.Cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("parse redis url: %w", err)
	}
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelStartup()
	if err := w.recoverRunningTasks(startupCtx); err != nil {
		return fmt.Errorf("recover running tasks: %w", err)
	}
	if err := w.reapStaleQueued(startupCtx); err != nil {
		return fmt.Errorf("recover queued tasks: %w", err)
	}
	if err := w.recoverAssistantRuns(startupCtx); err != nil {
		return fmt.Errorf("recover assistant runs: %w", err)
	}
	if _, err := w.expireTrialCampaigns(startupCtx); err != nil {
		return fmt.Errorf("expire trial campaigns: %w", err)
	}
	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: w.Cfg.WorkerConcurrency,
	})
	log.Printf("worker ready concurrency=%d poll_concurrency=%d image_memory_mib=%d", w.Cfg.WorkerConcurrency, w.pollConcurrency, w.imageMemoryBytes>>20)
	mux := asynq.NewServeMux()
	mux.HandleFunc(taskflow.TypeRunTask, w.handleRunTask)
	mux.HandleFunc(taskflow.TypePollImageTask, w.handlePollImageTask)
	mux.HandleFunc(taskflow.TypeRunAssistant, w.handleRunAssistant)
	mux.HandleFunc(typeCleanupSessions, w.handleCleanupSessions)
	mux.HandleFunc(typeReapZombies, w.handleReapZombies)
	mux.HandleFunc(typeEnsureImagePolls, w.handleEnsureImagePolls)
	mux.HandleFunc(typeExpireTrialCampaigns, w.handleExpireTrialCampaigns)
	mux.HandleFunc(typeSyncPromptSources, w.handleSyncPromptSources)
	mux.HandleFunc(typeBackfillPromptCovers, w.handleBackfillPromptCovers)
	mux.HandleFunc(typeCleanupUserUploads, w.handleCleanupUserUploads)
	mux.HandleFunc(typeCleanupObjectJobs, w.handleCleanupObjectJobs)

	provider := &staticPeriodicConfigProvider{}
	mgr, err := asynq.NewPeriodicTaskManager(asynq.PeriodicTaskManagerOpts{
		RedisConnOpt:               redisOpt,
		PeriodicTaskConfigProvider: provider,
		SyncInterval:               time.Minute,
	})
	if err != nil {
		return fmt.Errorf("create periodic task manager: %w", err)
	}
	if err := mgr.Start(); err != nil {
		return fmt.Errorf("start periodic task manager: %w", err)
	}
	defer mgr.Shutdown()

	return srv.Run(mux)
}

// recoverRunningTasks 接管上一个 Worker 进程被停止时遗留的任务。ChatGPT2API
// 以本地 task ID 作为 client_task_id，因此重新执行会查询原任务，而不会再生成一份。
func (w *Worker) recoverRunningTasks(ctx context.Context) error {
	ids, err := store.RequeueExpiredRunningTasks(ctx, w.St.Pool, time.Now().UTC())
	if err != nil {
		return err
	}
	for _, taskID := range ids {
		if err := w.Queue.EnqueueRunTaskRecovery(ctx, taskID.String()); err != nil {
			// 保持 queued；stale queued 定时任务还会继续补入队。
			log.Printf("recovered task %s enqueue failed: %v", taskID, err)
			continue
		}
		log.Printf("recovered interrupted running task %s", taskID)
	}
	return nil
}

func (w *Worker) heartbeatTaskLease(ctx context.Context, taskID uuid.UUID, owner string, cancelWork context.CancelFunc) {
	ticker := time.NewTicker(taskHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			ok, err := store.RenewTaskLease(ctx, w.St.Pool, taskID, owner, now.UTC(), taskLease)
			if err != nil {
				log.Printf("task %s lease heartbeat failed: %v", taskID, err)
			} else if !ok {
				log.Printf("task %s lease was lost", taskID)
				cancelWork()
				return
			}
		}
	}
}

type staticPeriodicConfigProvider struct{}

func (p *staticPeriodicConfigProvider) GetConfigs() ([]*asynq.PeriodicTaskConfig, error) {
	return []*asynq.PeriodicTaskConfig{
		{Cronspec: "@every 1h", Task: asynq.NewTask(typeCleanupSessions, nil, asynq.MaxRetry(0))},
		{Cronspec: "@every 2m", Task: asynq.NewTask(typeReapZombies, nil, asynq.MaxRetry(3))},
		{Cronspec: "@every 1m", Task: asynq.NewTask(typeEnsureImagePolls, nil, asynq.MaxRetry(3))},
		{Cronspec: "@every 1m", Task: asynq.NewTask(typeExpireTrialCampaigns, nil, asynq.MaxRetry(3))},
		{Cronspec: "@every 30m", Task: asynq.NewTask(typeSyncPromptSources, nil, asynq.MaxRetry(0))},
		{Cronspec: "@every 10m", Task: asynq.NewTask(typeBackfillPromptCovers, nil, asynq.MaxRetry(0))},
		{Cronspec: "@every 1h", Task: asynq.NewTask(typeCleanupUserUploads, nil, asynq.MaxRetry(3))},
		{Cronspec: "@every 5m", Task: asynq.NewTask(typeCleanupObjectJobs, nil, asynq.MaxRetry(3))},
	}, nil
}

// claimTask 条件更新 queued→running，抢不到返回 nil。
func (w *Worker) claimTask(ctx context.Context, taskID uuid.UUID) (*store.Task, string, error) {
	queued, err := store.GetTask(ctx, w.St.Pool, taskID)
	if err != nil || queued == nil || queued.Status != "queued" {
		return nil, "", err
	}
	var candidates []modelconfig.Selection
	providerID := taskParamString(queued.Params, "_providerConfigId")
	routeID := taskParamString(queued.Params, "_providerRouteId")
	modelID := taskParamString(queued.Params, "_modelConfigId")
	if providerID != "" && modelID != "" {
		cfg, runtimeErr := w.runtimeModelConfig(ctx)
		if runtimeErr != nil {
			return nil, "", runtimeErr
		}
		balanceAcrossProviders, settingErr := settings.GetBool(ctx, w.St.Pool, "cross_provider_same_model_balancing_enabled")
		if settingErr != nil {
			return nil, "", settingErr
		}
		unitPrice, hasUnitPrice := taskParamInt64(queued.Params, "_unitPriceCents")
		if balanceAcrossProviders && hasUnitPrice {
			candidates = modelconfig.ExecutionCandidatesRouteAcrossProviders(cfg, providerID, modelID, routeID, unitPrice)
			compatible := candidates[:0]
			for _, candidate := range candidates {
				isBoundModel := candidate.Provider.ID == providerID && candidate.Model.ID == modelID
				isCompatibleTool := candidate.Model.Kind == modelconfig.ModelKindImageTool && candidate.Model.Tool == taskParamString(queued.Params, "_modelTool")
				if isBoundModel || isCompatibleTool || taskflow.ValidateModelImageCapabilities(candidate.Model, queued.Params, len(queued.InputKeys)) == nil {
					compatible = append(compatible, candidate)
				}
			}
			candidates = compatible
		} else {
			candidates = modelconfig.ExecutionCandidatesRoute(cfg, providerID, modelID, routeID)
		}
		if len(candidates) == 0 {
			return nil, "", fmt.Errorf("%w: 任务绑定的模型没有可用服务商", errTaskProviderUnavailable)
		}
	}
	var claimedTask *store.Task
	deferReason := ""
	leaseOwner := w.workerID + ":" + uuid.NewString()
	err = w.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockGlobalTaskExecution(ctx, tx); err != nil {
			return err
		}
		if err := store.LockUserTaskExecution(ctx, tx, queued.UserID); err != nil {
			return err
		}
		globalLimit, err := settings.GetInt(ctx, tx, "global_max_concurrent_tasks")
		if err != nil {
			return err
		}
		if globalLimit <= 0 {
			globalLimit = 4
		}
		globalRunning, err := store.CountTasksInStatuses(ctx, tx, []string{"running"})
		if err != nil {
			return err
		}
		if globalRunning >= globalLimit {
			deferReason = "global_execution_limit"
			return nil
		}
		userLimit, err := settings.GetInt(ctx, tx, "user_max_concurrent_tasks")
		if err != nil {
			return err
		}
		if userLimit <= 0 {
			userLimit = 2
		}
		running, err := store.CountRunningTasks(ctx, tx, queued.UserID)
		if err != nil {
			return err
		}
		if running >= userLimit {
			deferReason = "user_execution_limit"
			return nil
		}
		if len(candidates) > 0 {
			providerIDs := make([]string, 0, len(candidates))
			for _, candidate := range candidates {
				providerIDs = append(providerIDs, modelconfig.ExecutionRouteKey(candidate.Provider))
			}
			runningByProvider, err := store.RunningTasksByProvider(ctx, tx, providerIDs)
			if err != nil {
				return err
			}
			excluded := make(map[string]bool)
			for _, failedProviderID := range taskParamStrings(queued.Params, "_failedProviderConfigIds") {
				excluded[failedProviderID] = true
			}
			pendingRouteKeys, pendingErr := store.PendingTaskUpstreamAttemptRouteKeys(ctx, tx, taskID)
			if pendingErr != nil {
				return pendingErr
			}
			for _, pendingRouteKey := range pendingRouteKeys {
				excluded[pendingRouteKey] = true
			}
			selected, ok := selectExecutionCandidateExcluding(candidates, runningByProvider, excluded)
			if !ok {
				hasUntriedRoute := false
				for _, candidate := range candidates {
					if !excluded[modelconfig.ExecutionRouteKey(candidate.Provider)] {
						hasUntriedRoute = true
						break
					}
				}
				if !hasUntriedRoute {
					deferReason = "upstream_attempts_exhausted"
					return nil
				}
				deferReason = "provider_execution_limit"
				return nil
			}
			route := map[string]any{
				"_serviceProvider":     selected.Provider.Adapter,
				"_providerConfigId":    selected.Provider.ID,
				"_providerRouteId":     selected.Provider.RouteID,
				"_providerRouteKey":    modelconfig.ExecutionRouteKey(selected.Provider),
				"_modelConfigId":       selected.Model.ID,
				"_providerDisplayName": selected.Provider.Name,
				"_modelDisplayName":    selected.Model.Name,
			}
			updated, err := store.SetQueuedTaskExecutionRoute(ctx, tx, taskID, selected.Model.UpstreamModel, route)
			if err != nil || !updated {
				return err
			}
		}
		claimed, err := store.ClaimTask(ctx, tx, taskID, time.Now().UTC(), leaseOwner, taskLease)
		if err != nil || !claimed {
			return err
		}
		claimedTask, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return claimedTask, deferReason, err
}

func selectExecutionCandidate(candidates []modelconfig.Selection, running map[string]int64) (*modelconfig.Selection, bool) {
	return selectExecutionCandidateAvoiding(candidates, running, "")
}

func selectExecutionCandidateAvoiding(candidates []modelconfig.Selection, running map[string]int64, avoidProviderID string) (*modelconfig.Selection, bool) {
	excluded := map[string]bool{}
	if avoidProviderID != "" {
		excluded[avoidProviderID] = true
	}
	selected, ok := selectExecutionCandidateExcluding(candidates, running, excluded)
	if !ok && len(excluded) > 0 {
		return selectExecutionCandidateExcluding(candidates, running, nil)
	}
	return selected, ok
}

func selectExecutionCandidateExcluding(candidates []modelconfig.Selection, running map[string]int64, excluded map[string]bool) (*modelconfig.Selection, bool) {
	var selected *modelconfig.Selection
	var selectedRunning int64
	for index := range candidates {
		candidate := &candidates[index]
		routeKey := modelconfig.ExecutionRouteKey(candidate.Provider)
		if excluded[routeKey] {
			continue
		}
		limit := int64(candidate.Provider.MaxConcurrency)
		current := running[routeKey]
		if limit <= 0 || current >= limit {
			continue
		}
		if selected == nil || current*int64(selected.Provider.MaxConcurrency) < selectedRunning*limit {
			selected = candidate
			selectedRunning = current
		}
	}
	return selected, selected != nil
}

func (w *Worker) loadTaskImageBytes(ctx context.Context, key string) ([]byte, error) {
	data, err := w.Storage.GetBytesLimit(ctx, key, maxTaskImageObjectBytes)
	if err != nil {
		return nil, err
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return nil, fmt.Errorf("task input %q is not a valid image: %w", key, err)
	}
	return data, nil
}

func (w *Worker) loadInputImageBytes(ctx context.Context, inputKeys []string) ([][]byte, error) {
	images := make([][]byte, len(inputKeys))
	errs := make([]error, len(inputKeys))
	var wg sync.WaitGroup
	for index, key := range inputKeys {
		wg.Add(1)
		go func(index int, key string) {
			defer wg.Done()
			images[index], errs[index] = w.loadTaskImageBytes(ctx, key)
		}(index, key)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return images, nil
}

func (w *Worker) loadInputImagesB64(ctx context.Context, inputKeys []string) ([]string, error) {
	data, err := w.loadInputImageBytes(ctx, inputKeys)
	if err != nil {
		return nil, err
	}
	images := make([]string, len(data))
	for index := range data {
		images[index] = base64.StdEncoding.EncodeToString(data[index])
	}
	return images, nil
}

// upstreamClient 每次任务执行时解析生效配置（后台设置优先，环境变量兜底），
// 使后台修改 chatgpt2api 地址/Key 即时生效，无需重启 Worker。
func (w *Worker) upstreamClient(ctx context.Context) *c2a.Client {
	resolved, err := settings.ResolveC2A(
		ctx, w.St.Pool, w.Cfg.C2ABaseURL, w.Cfg.C2AAPIKey, w.Cfg.C2ATimeoutSecs, w.Cfg.AppSecret,
	)
	if err != nil {
		// 配置读取失败时退回启动时的客户端，任务仍可执行
		return w.C2A
	}
	return c2a.NewWithPolicy(resolved.BaseURL, resolved.APIKey, resolved.TimeoutSecs, w.Cfg.AppEnv == "development")
}

type imageReadyFunc func(index int, encoded string) error

type asyncImagePendingError struct{}

func (*asyncImagePendingError) Error() string { return "upstream image task pending" }

func compactEncodedImages(images []string) []string {
	completed := make([]string, 0, len(images))
	for _, image := range images {
		if image != "" {
			completed = append(completed, image)
		}
	}
	return completed
}

func deliverEncodedImages(images []string, onImage imageReadyFunc) error {
	if onImage == nil || len(images) == 0 {
		return nil
	}
	errs := make(chan error, len(images))
	for index, encoded := range images {
		go func(index int, encoded string) {
			errs <- onImage(index, encoded)
		}(index, encoded)
	}
	var firstErr error
	for range images {
		if err := <-errs; err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (w *Worker) callSub2APIClient(ctx context.Context, task *store.Task, client *sub2api.Client, model string, onImage imageReadyFunc) ([]string, error) {
	if model != "" {
		client = client.WithImageModel(model)
	}
	finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
	quality := taskParamString(task.Params, "quality")
	inputData, err := w.loadInputImageBytes(ctx, task.InputKeys)
	if err != nil {
		return nil, err
	}
	references := make([]string, 0, len(inputData))
	for _, data := range inputData {
		_, contentType := media.Detect(data)
		if contentType == "" {
			contentType = "image/png"
		}
		references = append(references, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	encodedByIndex := make([]string, task.Count)
	images, err := client.GenerateImageProgressiveWithOptions(ctx, finalPrompt, size, quality, task.Count, references, sub2api.ImageOptions{
		InputFidelity: taskParamString(task.Params, "inputFidelity"),
	}, func(index int, image sub2api.Image) error {
		if index < 0 || index >= len(encodedByIndex) {
			log.Printf("task %s ignored unexpected upstream output index=%d expected=%d", task.ID, index, len(encodedByIndex))
			return nil
		}
		data, _, _, downloadErr := downloadAssistantImage(ctx, image.DataURL)
		if downloadErr != nil {
			return downloadErr
		}
		encoded := base64.StdEncoding.EncodeToString(data)
		encodedByIndex[index] = encoded
		if onImage != nil {
			return onImage(index, encoded)
		}
		return nil
	})
	if err != nil {
		return compactEncodedImages(encodedByIndex), err
	}
	if len(compactEncodedImages(encodedByIndex)) == 0 && len(images) > 0 {
		return nil, errors.New("Sub2API completed without a persisted image")
	}
	return compactEncodedImages(encodedByIndex), nil
}

func (w *Worker) callSub2API(ctx context.Context, task *store.Task, model string, onImage imageReadyFunc) ([]string, error) {
	client, err := w.assistantClient(ctx)
	if err != nil {
		return nil, err
	}
	return w.callSub2APIClient(ctx, task, client, model, onImage)
}

func (w *Worker) crunClient(ctx context.Context) (*crun.Client, error) {
	resolved, err := settings.ResolveCRUN(ctx, w.St.Pool, settings.CRUNConfig{
		BaseURL: w.Cfg.CRUNBaseURL, APIKey: w.Cfg.CRUNAPIKey, TimeoutSecs: w.Cfg.CRUNTimeoutSecs,
	}, w.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	client, err := crun.New(resolved.BaseURL, resolved.APIKey, crun.DefaultModel, resolved.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if !client.Configured() {
		return nil, errors.New("CRUN API key is not configured")
	}
	return client, nil
}

func taskParamStrings(params map[string]any, key string) []string {
	if params == nil {
		return nil
	}
	switch values := params[key].(type) {
	case []string:
		return append([]string(nil), values...)
	case []any:
		out := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, strings.TrimSpace(text))
			}
		}
		return out
	default:
		return nil
	}
}

func normalizeCRUNResolution(params map[string]any) string {
	for _, key := range []string{"resolutionScale", "resolution"} {
		value := strings.ToUpper(taskParamString(params, key))
		switch value {
		case "4K", "8K":
			return "4K"
		case "2K":
			return "2K"
		case "1K":
			return "1K"
		}
	}
	return "1K"
}

func normalizeCRUNResolutionForAspect(resolution, aspectRatio string) string {
	if resolution == "4K" && aspectRatio == "1:1" {
		return "2K"
	}
	return resolution
}

func parseRatio(value string) float64 {
	value = strings.ReplaceAll(strings.TrimSpace(value), " ", "")
	separator := ":"
	if strings.Contains(value, "/") {
		separator = "/"
	}
	parts := strings.Split(value, separator)
	if len(parts) != 2 {
		return 0
	}
	width, _ := strconv.ParseFloat(parts[0], 64)
	height, _ := strconv.ParseFloat(parts[1], 64)
	if width <= 0 || height <= 0 {
		return 0
	}
	return width / height
}

func normalizeCRUNAspectRatio(params map[string]any, size string) string {
	allowed := []string{"1:1", "2:3", "3:2", "9:16", "16:9", "4:3", "3:4", "21:9"}
	value := taskParamString(params, "aspectRatio")
	if value == "" {
		value = taskParamString(params, "ratio")
	}
	value = strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), " ", ""), "/", ":")
	if strings.EqualFold(value, "auto") {
		return ""
	}
	for _, candidate := range allowed {
		if value == candidate {
			return candidate
		}
	}
	ratio := parseRatio(value)
	if ratio == 0 && strings.Contains(strings.ToLower(size), "x") {
		ratio = parseRatio(strings.ReplaceAll(strings.ToLower(size), "x", ":"))
	}
	if ratio == 0 {
		return "1:1"
	}
	closest := allowed[0]
	closestDistance := 1000.0
	for _, candidate := range allowed {
		distance := ratio - parseRatio(candidate)
		if distance < 0 {
			distance = -distance
		}
		if distance < closestDistance {
			closest, closestDistance = candidate, distance
		}
	}
	return closest
}

func crunPrompt(prompt string) string {
	runes := []rune(strings.TrimSpace(prompt))
	if len(runes) > 5000 {
		runes = runes[:5000]
	}
	return string(runes)
}

func (w *Worker) callCRUNClient(ctx context.Context, task *store.Task, client *crun.Client, onImage imageReadyFunc) ([]string, error) {
	taskIDs, err := w.createCRUNImageTasks(ctx, task, client)
	if err != nil {
		return nil, err
	}
	encodedByIndex := make([]string, len(taskIDs))
	imageURLs, err := client.WaitTasks(ctx, taskIDs, func(index int, imageURL string) error {
		if index < 0 || index >= len(encodedByIndex) {
			log.Printf("task %s ignored unexpected upstream output index=%d expected=%d", task.ID, index, len(encodedByIndex))
			return nil
		}
		data, _, _, downloadErr := downloadAssistantImage(ctx, imageURL)
		if downloadErr != nil {
			return downloadErr
		}
		encoded := base64.StdEncoding.EncodeToString(data)
		encodedByIndex[index] = encoded
		if onImage != nil {
			return onImage(index, encoded)
		}
		return nil
	})
	if err != nil {
		return compactEncodedImages(encodedByIndex), err
	}
	if len(compactEncodedImages(encodedByIndex)) == 0 && len(imageURLs) > 0 {
		return nil, errors.New("CRUN completed without a persisted image")
	}
	return compactEncodedImages(encodedByIndex), nil
}

func (w *Worker) createCRUNImageTasks(ctx context.Context, task *store.Task, client *crun.Client) ([]string, error) {
	finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
	aspectRatio := normalizeCRUNAspectRatio(task.Params, size)
	resolution := normalizeCRUNResolutionForAspect(normalizeCRUNResolution(task.Params), aspectRatio)
	if _, err := w.loadInputImageBytes(ctx, task.InputKeys); err != nil {
		return nil, err
	}
	references := make([]string, 0, len(task.InputKeys))
	for _, key := range task.InputKeys {
		presigned, presignErr := w.Storage.PresignGet(ctx, key)
		if presignErr != nil {
			return nil, presignErr
		}
		references = append(references, presigned)
	}
	taskIDs, err := client.CreateImageTasks(ctx, crun.OpenAIImageRequest{
		Prompt: crunPrompt(finalPrompt), N: task.Count, Size: size,
		Quality: taskParamString(task.Params, "quality"), ImageURLs: references,
		AspectRatio: aspectRatio, Resolution: resolution,
		TransparentBackground: taskParamBool(task.Params, "transparentPngEnabled", "transparentPng", "transparentBackground"),
		OutputFormat:          taskParamString(task.Params, "outputFormat"),
		ModerationLevel:       taskParamString(task.Params, "moderationLevel"),
	}, taskParamStrings(task.Params, "_crunTaskIds"), func(created []string) error {
		if err := store.SetTaskCRUNTaskIDsOwned(ctx, w.St.Pool, task.ID, created, taskLeaseOwner(task)); err != nil {
			return err
		}
		if task.Params == nil {
			task.Params = map[string]any{}
		}
		task.Params["_crunTaskIds"] = append([]string(nil), created...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return taskIDs, nil
}

func (w *Worker) createCRUNBackgroundRemovalTask(ctx context.Context, task *store.Task, client *crun.Client) (string, error) {
	existing := taskParamStrings(task.Params, "_crunTaskIds")
	if len(existing) > 0 && strings.TrimSpace(existing[0]) != "" {
		return strings.TrimSpace(existing[0]), nil
	}
	if len(task.InputKeys) != 1 {
		return "", errors.New("background removal requires exactly one input image")
	}
	if _, err := w.loadTaskImageBytes(ctx, task.InputKeys[0]); err != nil {
		return "", err
	}
	imageURL, err := w.Storage.PresignGet(ctx, task.InputKeys[0])
	if err != nil {
		return "", err
	}
	taskID, err := client.CreateBackgroundRemovalTask(ctx, imageURL)
	if err != nil {
		return "", err
	}
	if err := store.SetTaskCRUNTaskIDsOwned(ctx, w.St.Pool, task.ID, []string{taskID}, taskLeaseOwner(task)); err != nil {
		return "", err
	}
	if task.Params == nil {
		task.Params = map[string]any{}
	}
	task.Params["_crunTaskIds"] = []string{taskID}
	return taskID, nil
}

func (w *Worker) callCRUN(ctx context.Context, task *store.Task, onImage imageReadyFunc) ([]string, error) {
	client, err := w.crunClient(ctx)
	if err != nil {
		return nil, err
	}
	return w.callCRUNClient(ctx, task, client, onImage)
}

func (w *Worker) configuredModelSelection(ctx context.Context, task *store.Task) (*modelconfig.Selection, bool, error) {
	providerID := taskParamString(task.Params, "_providerConfigId")
	routeID := taskParamString(task.Params, "_providerRouteId")
	modelID := taskParamString(task.Params, "_modelConfigId")
	if providerID == "" || modelID == "" {
		return nil, false, nil
	}
	cfg, err := w.runtimeModelConfig(ctx)
	if err != nil {
		return nil, false, err
	}
	selection, found := modelconfig.FindExecutionRoute(cfg, providerID, modelID, routeID)
	if !found {
		return nil, false, errors.New("任务绑定的模型或服务商配置已失效")
	}
	return selection, true, nil
}

func (w *Worker) callConfiguredUpstream(ctx context.Context, task *store.Task, selection *modelconfig.Selection, onImage imageReadyFunc) ([]string, error) {
	provider := selection.Provider
	model := selection.Model.UpstreamModel
	if strings.TrimSpace(provider.APIKey) == "" {
		return nil, errors.New("模型服务商没有可用的 API Key")
	}
	timeout := provider.TimeoutSecs
	switch provider.Adapter {
	case modelconfig.AdapterOpenAI:
		client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, timeout, w.Cfg.AppEnv == "development")
		finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
		imageOptions := c2a.ImageOptions{
			Quality:               taskParamString(task.Params, "quality"),
			InputFidelity:         taskParamString(task.Params, "inputFidelity"),
			TransparentBackground: taskParamBool(task.Params, "transparentPngEnabled", "transparentPng", "transparentBackground"),
			OutputFormat:          taskParamString(task.Params, "outputFormat"),
			ModerationLevel:       taskParamString(task.Params, "moderationLevel"),
		}
		var images []string
		var pending bool
		var err error
		if len(task.InputKeys) > 0 {
			inputs, err := w.loadInputImagesB64(ctx, task.InputKeys)
			if err != nil {
				return nil, err
			}
			images, pending, err = client.SubmitEditImages(ctx, task.ID.String(), finalPrompt, model, task.Count, inputs, size, imageOptions)
		} else {
			images, pending, err = client.SubmitGenerateImages(ctx, task.ID.String(), finalPrompt, model, task.Count, size, imageOptions)
		}
		if err != nil {
			return images, err
		}
		if pending {
			return nil, &asyncImagePendingError{}
		}
		return images, deliverEncodedImages(images, onImage)
	case modelconfig.AdapterCRUN:
		client, err := crun.New(provider.BaseURL, provider.APIKey, model, timeout)
		if err != nil {
			return nil, err
		}
		if selection.Model.Kind == modelconfig.ModelKindImageTool {
			if selection.Model.Tool != modelconfig.ImageToolBackgroundRemove {
				return nil, errors.New("不支持的图片工具")
			}
			if _, err := w.createCRUNBackgroundRemovalTask(ctx, task, client); err != nil {
				return nil, err
			}
			return nil, &asyncImagePendingError{}
		}
		if _, err := w.createCRUNImageTasks(ctx, task, client); err != nil {
			return nil, err
		}
		return nil, &asyncImagePendingError{}
	default:
		return nil, errors.New("不支持的模型服务商类型")
	}
}

func (w *Worker) callUpstreamLegacy(ctx context.Context, task *store.Task, provider, model string, onImage imageReadyFunc) ([]string, error) {
	if provider == "sub2api" {
		return w.callSub2API(ctx, task, model, onImage)
	}
	if provider == "crun" {
		return w.callCRUN(ctx, task, onImage)
	}
	client := w.upstreamClient(ctx)
	finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
	imageOptions := c2a.ImageOptions{
		Quality:               taskParamString(task.Params, "quality"),
		InputFidelity:         taskParamString(task.Params, "inputFidelity"),
		TransparentBackground: taskParamBool(task.Params, "transparentPngEnabled", "transparentPng", "transparentBackground"),
		OutputFormat:          taskParamString(task.Params, "outputFormat"),
		ModerationLevel:       taskParamString(task.Params, "moderationLevel"),
	}
	var images []string
	if len(task.InputKeys) > 0 {
		inputs, err := w.loadInputImagesB64(ctx, task.InputKeys)
		if err != nil {
			return nil, err
		}
		images, err = client.EditImagesWithOptions(ctx, task.ID.String(), finalPrompt, model, task.Count, inputs, size, imageOptions)
		if err != nil {
			return images, err
		}
	} else {
		var err error
		images, err = client.GenerateImagesWithOptions(ctx, task.ID.String(), finalPrompt, model, task.Count, size, imageOptions)
		if err != nil {
			return images, err
		}
	}
	return images, deliverEncodedImages(images, onImage)
}

func (w *Worker) callUpstream(ctx context.Context, task *store.Task, provider, model string, onImage imageReadyFunc) ([]string, error) {
	selection, configured, err := w.configuredModelSelection(ctx, task)
	if err != nil {
		return nil, err
	}
	if configured {
		return w.callConfiguredUpstream(ctx, task, selection, onImage)
	}
	return w.callUpstreamLegacy(ctx, task, provider, model, onImage)
}

func upstreamAttemptExpiry(submittedAt time.Time, timeoutSecs int) time.Time {
	retention := 3 * time.Duration(max(timeoutSecs, 1)) * time.Second
	if retention < 30*time.Minute {
		retention = 30 * time.Minute
	}
	if retention > 2*time.Hour {
		retention = 2 * time.Hour
	}
	return submittedAt.Add(retention)
}

// registerConfiguredUpstreamAttempt persists the route snapshot before an
// upstream call can create work. A later config edit/disable therefore cannot
// make the already-submitted result unreachable.
func (w *Worker) registerConfiguredUpstreamAttempt(ctx context.Context, task *store.Task) (uuid.UUID, string, error) {
	selection, configured, err := w.configuredModelSelection(ctx, task)
	if err != nil || !configured {
		return uuid.Nil, "", err
	}
	provider := selection.Provider
	if provider.Adapter != modelconfig.AdapterOpenAI && provider.Adapter != modelconfig.AdapterCRUN {
		return uuid.Nil, "", nil
	}
	encryptedKey, err := settings.EncryptSecret(provider.APIKey, w.Cfg.AppSecret)
	if err != nil {
		return uuid.Nil, provider.Adapter, err
	}
	submittedAt := time.Now().UTC()
	timeoutSecs := providerTimeoutSecs(&provider)
	status := store.UpstreamAttemptPending
	upstreamIDs := []string{task.ID.String()}
	if provider.Adapter == modelconfig.AdapterCRUN {
		status = store.UpstreamAttemptSubmitting
		upstreamIDs = taskParamStrings(task.Params, "_crunTaskIds")
	}
	id, err := store.UpsertTaskUpstreamAttempt(ctx, w.St.Pool, store.UpstreamAttemptInput{
		TaskID: task.ID, TaskAttempt: task.Attempt,
		ProviderID: provider.ID, RouteID: provider.RouteID,
		RouteKey: modelconfig.ExecutionRouteKey(provider), Adapter: provider.Adapter,
		UpstreamModel: selection.Model.UpstreamModel, BaseURL: provider.BaseURL,
		APIKeyEncrypted: encryptedKey, TimeoutSecs: timeoutSecs,
		MaxConcurrency: provider.MaxConcurrency, UpstreamTaskIDs: upstreamIDs,
		Status: status, SubmittedAt: submittedAt,
		FailoverAt: submittedAt.Add(time.Duration(timeoutSecs) * time.Second),
		ExpiresAt:  upstreamAttemptExpiry(submittedAt, timeoutSecs),
	})
	return id, provider.Adapter, err
}

func taskParamString(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	if value, ok := params[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func taskLeaseOwner(task *store.Task) string {
	if task == nil || task.LeaseOwner == nil {
		return ""
	}
	return strings.TrimSpace(*task.LeaseOwner)
}

func taskParamInt64(params map[string]any, key string) (int64, bool) {
	if params == nil {
		return 0, false
	}
	switch value := params[key].(type) {
	case int:
		return int64(value), value >= 0
	case int64:
		return value, value >= 0
	case float64:
		converted := int64(value)
		return converted, value >= 0 && float64(converted) == value
	case json.Number:
		converted, err := value.Int64()
		return converted, err == nil && converted >= 0
	default:
		return 0, false
	}
}

func taskParamBool(params map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := params[key].(bool); ok && value {
			return true
		}
	}
	return false
}

// applyMaskEditComposite 局部编辑 crop-and-stitch 的贴回阶段：
// 上游只编辑了蒙版外扩后的裁剪图，这里把结果羽化混合回整图，
// 蒙版未选中的像素保持与原图一致。参数缺失时原样返回（非局部编辑任务）。
func (w *Worker) applyMaskEditComposite(ctx context.Context, task *store.Task, imagesB64 []string) ([]string, error) {
	if task == nil {
		return nil, errors.New("task is nil")
	}
	maskKey := taskParamString(task.Params, "maskKey")
	baseKey := taskParamString(task.Params, "maskBaseKey")
	rectRaw := taskParamString(task.Params, "maskRect")
	if maskKey == "" || baseKey == "" || rectRaw == "" {
		return imagesB64, nil
	}
	rect, err := media.ParseMaskRect(rectRaw)
	if err != nil {
		return nil, fmt.Errorf("bad mask rect %q: %w", rectRaw, err)
	}
	baseData, err := w.loadTaskImageBytes(ctx, baseKey)
	if err != nil {
		return nil, fmt.Errorf("load mask base: %w", err)
	}
	maskData, err := w.loadTaskImageBytes(ctx, maskKey)
	if err != nil {
		return nil, fmt.Errorf("load mask: %w", err)
	}
	out := make([]string, 0, len(imagesB64))
	for i, b64 := range imagesB64 {
		resultData, derr := base64.StdEncoding.DecodeString(b64)
		if derr != nil {
			return nil, fmt.Errorf("output %d has invalid base64: %w", i, derr)
		}
		merged, cerr := media.CompositeMaskedEdit(baseData, maskData, resultData, rect)
		if cerr != nil {
			return nil, fmt.Errorf("composite output %d: %w", i, cerr)
		}
		out = append(out, base64.StdEncoding.EncodeToString(merged))
	}
	return out, nil
}

func (w *Worker) applyPreservedSourceCanvas(ctx context.Context, task *store.Task, imagesB64 []string) ([]string, error) {
	if task == nil {
		return nil, errors.New("task is nil")
	}
	if !taskParamBool(task.Params, "preserveSourceCanvas") || len(task.InputKeys) == 0 {
		return imagesB64, nil
	}
	sourceData, err := w.loadTaskImageBytes(ctx, task.InputKeys[0])
	if err != nil {
		return nil, fmt.Errorf("load source canvas: %w", err)
	}
	out := make([]string, 0, len(imagesB64))
	for index, encoded := range imagesB64 {
		resultData, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil {
			return nil, fmt.Errorf("output %d has invalid base64: %w", index, decodeErr)
		}
		merged, mergeErr := media.CompositePreservedCanvas(sourceData, resultData)
		if mergeErr != nil {
			return nil, fmt.Errorf("restore output %d: %w", index, mergeErr)
		}
		out = append(out, base64.StdEncoding.EncodeToString(merged))
	}
	return out, nil
}

func (w *Worker) markFailedOwned(ctx context.Context, taskID uuid.UUID, errorCode, errorMessage, owner string) error {
	var task *store.Task
	won := false
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil || t == nil {
			return err
		}
		task = t
		won, err = taskflow.MarkFailedOwned(ctx, tx, t, errorCode, errorMessage, "running", owner)
		return err
	})
	if err == nil && won {
		// M4：通知在主事务提交后尽力而为
		taskflow.NotifyTaskFailed(ctx, w.St.Pool, task)
		w.publishTaskEvent(ctx, task, taskstream.Event{
			Stage: "failed", Status: "failed", Done: true,
		})
	}
	return err
}

func (w *Worker) markFailedClaimed(ctx context.Context, taskID uuid.UUID, errorCode, errorMessage, claimID string) error {
	var task *store.Task
	won := false
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil || t == nil {
			return err
		}
		task = t
		won, err = taskflow.MarkFailedClaimed(ctx, tx, t, errorCode, errorMessage, "running", claimID)
		return err
	})
	if err == nil && won {
		taskflow.NotifyTaskFailed(ctx, w.St.Pool, task)
		w.publishTaskEvent(ctx, task, taskstream.Event{Stage: "failed", Status: "failed", Done: true})
	}
	return err
}

func (w *Worker) publishTaskEvent(ctx context.Context, task *store.Task, event taskstream.Event) {
	if task == nil {
		return
	}
	event.TaskID = task.ID.String()
	taskstream.Publish(ctx, w.Stream, event.TaskID, event)
	taskstream.PublishUser(ctx, w.Stream, task.UserID.String(), event)
}

// urlPattern H1 脱敏：过滤上游错误文案中的 URL，避免泄漏内部地址。
var urlPattern = regexp.MustCompile(`https?://\S+`)

// sanitizeUpstreamMessage 保留上游业务错误 message，但去掉其中的 URL。
func sanitizeUpstreamMessage(msg string) string {
	cleaned := strings.TrimSpace(urlPattern.ReplaceAllString(msg, ""))
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	lower := strings.ToLower(cleaned)
	if strings.Contains(lower, "context deadline exceeded") ||
		strings.Contains(lower, "client.timeout") ||
		strings.Contains(lower, "timeout while reading body") {
		return "AI 服务响应超时，请重试；已返回的进度会尽量保留"
	}
	if cleaned == "" {
		return "生成服务返回错误，请稍后重试"
	}
	if runes := []rune(cleaned); len(runes) > maxUpstreamMessageRunes {
		cleaned = string(runes[:maxUpstreamMessageRunes])
	}
	return cleaned
}

func (w *Worker) taskFailureRetryCount(ctx context.Context) int {
	count, err := settings.GetInt(ctx, w.St.Pool, "task_failure_retry_count")
	if err != nil {
		log.Printf("read task failure retry count failed, retries disabled: %v", err)
		return 0
	}
	if count <= 0 {
		return 0
	}
	if count > maxTaskFailureRetries {
		return maxTaskFailureRetries
	}
	return int(count)
}

func (w *Worker) scheduleTaskRetry(ctx context.Context, task *store.Task, owner string) (bool, error) {
	if task == nil || task.Attempt >= w.taskFailureRetryCount(ctx) {
		return false, nil
	}
	failed := failedTaskProviderIDs(task)
	attempt, requeued, err := store.RetryRunningTaskOwned(ctx, w.St.Pool, task.ID, owner, task.Attempt, failed)
	if err != nil || !requeued {
		return false, err
	}
	task.Attempt = attempt
	if task.Params == nil {
		task.Params = map[string]any{}
	}
	delete(task.Params, "_upstreamStage")
	delete(task.Params, "_crunTaskIds")
	task.Params["_failedProviderConfigIds"] = failed
	delay := time.Duration(attempt*15) * time.Second
	if err := w.Queue.EnqueueRunTaskRecoveryIn(ctx, task.ID.String(), delay); err != nil {
		// The task remains queued so the stale-queue reaper can recover it.
		log.Printf("task %s retry enqueue failed; stale queue reaper will retry: %v", task.ID, err)
	} else {
		log.Printf("task %s retry scheduled attempt=%d delay=%s", task.ID, attempt, delay)
	}
	w.publishTaskEvent(ctx, task, taskstream.Event{Stage: "queued", Status: "queued"})
	return true, nil
}

func (w *Worker) handleRunTask(ctx context.Context, t *asynq.Task) error {
	var payload taskflow.RunTaskPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("bad payload: %w", err)
	}
	taskID, err := uuid.Parse(payload.TaskID)
	if err != nil {
		return fmt.Errorf("bad task_id: %w", err)
	}

	task, deferReason, err := w.claimTask(ctx, taskID)
	if err != nil {
		if errors.Is(err, errTaskProviderUnavailable) {
			_, failErr := taskflow.FailQueuedTask(ctx, w.St, taskID, "model_config_error", "任务绑定的模型暂时没有可用服务商，费用已退回")
			return failErr
		}
		return err
	}
	if deferReason != "" {
		if deferReason == "upstream_attempts_exhausted" {
			failed, failErr := taskflow.FailQueuedTask(ctx, w.St, taskID,
				"upstream_unreachable", "所有生成线路均已失联或失败，任务已终止并退款")
			if failErr == nil && failed {
				_ = store.SupersedePendingTaskUpstreamAttempts(ctx, w.St.Pool, taskID, time.Now().UTC())
				if closedTask, getErr := store.GetTask(ctx, w.St.Pool, taskID); getErr == nil && closedTask != nil {
					w.publishTaskEvent(ctx, closedTask, taskstream.Event{Stage: "failed", Status: "failed", Done: true})
				}
			}
			return failErr
		}
		delay := taskDispatchBackoff(deferReason, taskID)
		if err := w.Queue.EnqueueRunTaskRecoveryIn(ctx, taskID.String(), delay); err != nil {
			return err
		}
		log.Printf("task %s deferred reason=%s delay=%s", taskID, deferReason, delay)
		return nil
	}
	if task == nil {
		log.Printf("task %s not claimable, skip", taskID)
		return nil
	}
	leaseOwner := taskLeaseOwner(task)
	if leaseOwner == "" {
		return fmt.Errorf("task %s was claimed without a lease owner", taskID)
	}
	workCtx, cancelWork := context.WithCancel(ctx)
	defer cancelWork()
	ctx = workCtx
	go w.heartbeatTaskLease(workCtx, taskID, leaseOwner, cancelWork)
	w.publishTaskEvent(ctx, task, taskstream.Event{Stage: "running", Status: "running"})
	queueWait := time.Since(task.CreatedAt)
	if queueWait < 0 {
		queueWait = 0
	}
	log.Printf(
		"task %s claimed type=%s queue_wait_ms=%d",
		taskID, task.Type, queueWait.Milliseconds(),
	)
	provider := strings.ToLower(taskParamString(task.Params, "_serviceProvider"))
	if provider != "c2a" && provider != "sub2api" && provider != "crun" {
		provider, err = settings.ImageServiceProvider(ctx, w.St.Pool, task.Type)
		if err != nil {
			return w.markFailedOwned(ctx, taskID, "model_config_error", "图片服务配置读取失败，费用已退回", leaseOwner)
		}
	}
	// 服务在创建任务时快照；C2A 模型也在创建时固定，旧任务和 Sub2API 模型在首次执行时补齐。
	model := strings.TrimSpace(task.Model)
	if model == "" {
		if provider == "sub2api" {
			client, clientErr := w.assistantClient(ctx)
			if clientErr != nil {
				return w.markFailedOwned(ctx, taskID, "model_config_error", "图片服务配置不可用，费用已退回", leaseOwner)
			}
			model = client.ImageModel()
		} else if provider == "crun" {
			model = crun.DefaultModel
		} else {
			model, err = settings.TaskModel(ctx, w.St.Pool, task.Type)
		}
		if err != nil {
			return w.markFailedOwned(ctx, taskID, "model_config_error", "图片模型配置读取失败，费用已退回", leaseOwner)
		}
		updated, updateErr := store.SetTaskModelOwned(ctx, w.St.Pool, task.ID, model, leaseOwner)
		if updateErr != nil {
			return updateErr
		}
		if !updated {
			return fmt.Errorf("task %s lease lost before model selection", task.ID)
		}
		task.Model = model
	}

	errorCode, errorMessage := "internal_error", "未知错误"
	collector := newTaskOutputCollector(w, ctx, task)
	upstreamStartedAt := time.Now()
	attemptID, attemptAdapter, attemptErr := w.registerConfiguredUpstreamAttempt(ctx, task)
	var imagesB64 []string
	var callErr error
	if attemptErr != nil {
		callErr = fmt.Errorf("persist upstream attempt: %w", attemptErr)
	} else {
		imagesB64, callErr = w.callUpstream(ctx, task, provider, model, collector.persist)
	}
	var netErr *c2a.NetworkError
	var pendingErr *asyncImagePendingError
	ambiguousOpenAISubmit := attemptID != uuid.Nil && attemptAdapter == modelconfig.AdapterOpenAI &&
		callErr != nil && isRetryableTaskError(callErr)
	if errors.As(callErr, &pendingErr) || ambiguousOpenAISubmit {
		delay := 2*time.Second + time.Duration(taskID[0]%3)*time.Second
		providerID := taskParamString(task.Params, "_providerConfigId")
		routeID := taskParamString(task.Params, "_providerRouteId")
		routeKey := taskParamString(task.Params, "_providerRouteKey")
		if routeKey == "" {
			routeKey = providerID
		}
		if attemptID != uuid.Nil {
			upstreamIDs := []string{taskID.String()}
			if attemptAdapter == modelconfig.AdapterCRUN {
				upstreamIDs = taskParamStrings(task.Params, "_crunTaskIds")
			}
			if persistErr := store.SetTaskUpstreamAttemptPending(ctx, w.St.Pool, attemptID, upstreamIDs); persistErr != nil {
				_, _ = store.RequeueRunningTaskOwned(ctx, w.St.Pool, taskID, leaseOwner)
				return fmt.Errorf("persist pending upstream attempt: %w", persistErr)
			}
		}
		if markErr := store.MarkTaskUpstreamPendingOwned(ctx, w.St.Pool, taskID, leaseOwner); markErr != nil {
			_, _ = store.RequeueRunningTaskOwned(ctx, w.St.Pool, taskID, leaseOwner)
			return markErr
		}
		if transferred, transferErr := store.TransferTaskLease(ctx, w.St.Pool, taskID, leaseOwner,
			"poller:"+routeKey, time.Now().UTC(), asyncTaskLease); transferErr != nil || !transferred {
			_, _ = store.RequeueRunningTaskOwned(ctx, w.St.Pool, taskID, leaseOwner)
			if transferErr != nil {
				return transferErr
			}
			return fmt.Errorf("task %s lease transfer failed", taskID)
		}
		if enqueueErr := w.Queue.EnqueueImagePoll(ctx, providerID, routeID, routeKey, 0, delay); enqueueErr != nil {
			_, _ = store.RequeueRunningTaskOwned(ctx, w.St.Pool, taskID, "poller:"+routeKey)
			return enqueueErr
		}
		w.publishTaskEvent(ctx, task, taskstream.Event{Stage: "upstream_pending", Status: "running"})
		if ambiguousOpenAISubmit {
			log.Printf("task %s submit result ambiguous; preserving route attempt and polling by client task id: %v", taskID, callErr)
		}
		log.Printf("task %s submitted asynchronously attempt=%s poll_in=%s", taskID, attemptID, delay)
		return nil
	}
	if attemptID != uuid.Nil {
		attemptStatus := store.UpstreamAttemptSucceeded
		attemptMessage := ""
		if callErr != nil {
			attemptStatus = store.UpstreamAttemptFailed
			attemptMessage = callErr.Error()
		}
		_, _ = store.FinishTaskUpstreamAttempt(ctx, w.St.Pool, attemptID, attemptStatus, attemptMessage, time.Now().UTC())
	}
	outputKeys, thumbnailKeys := collector.completed()
	logTaskStage(taskID.String(), "upstream", upstreamStartedAt,
		"provider=%s model=%s returned=%d persisted=%d", provider, model, len(imagesB64), len(outputKeys))
	var outputProcessingErr *taskOutputProcessingError
	if callErr != nil {
		if errors.As(callErr, &outputProcessingErr) {
			// A post-processing failure must never be hidden by an earlier partial
			// image. Remove this attempt's objects before the task is refunded.
			collector.cleanup()
			outputKeys, thumbnailKeys = collector.completed()
		} else if len(outputKeys) > 0 {
			log.Printf("task %s upstream ended after partial success (%d/%d): %v", taskID, len(outputKeys), task.Count, callErr)
			callErr = nil
		}
	}
	if callErr != nil {
		// H1：error_message 只落用户可读文案，原始错误进日志（带 task_id）
		var upErr *c2a.UpstreamError
		var subErr *sub2api.UpstreamError
		var crunErr *crun.UpstreamError
		if outputProcessingErr != nil {
			errorCode, errorMessage = "image_processing_error", "图片处理失败，请重试"
		} else {
			switch {
			case errors.As(callErr, &netErr):
				errorCode, errorMessage = "upstream_unreachable", "生成服务暂时不可用，请稍后重试"
			case errors.As(callErr, &upErr):
				errorCode, errorMessage = "upstream_error", sanitizeUpstreamMessage(upErr.Message)
			case errors.As(callErr, &subErr):
				errorCode, errorMessage = "upstream_error", sanitizeUpstreamMessage(subErr.Message)
			case errors.As(callErr, &crunErr):
				errorCode, errorMessage = "upstream_error", sanitizeUpstreamMessage(crunErr.Message)
			default:
				errorCode, errorMessage = "internal_error", "任务执行失败，请稍后重试"
			}
		}
		log.Printf("task %s upstream call failed (%s): %v", taskID, errorCode, callErr)
	}
	configuredProvider := taskParamString(task.Params, "_providerConfigId") != ""
	if callErr != nil && isRetryableTaskError(callErr) && len(outputKeys) == 0 &&
		(configuredProvider || provider == "c2a" || provider == "crun") && taskRetryIsIdempotent(task, provider) {
		recoveryCtx, cancelRecovery := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelRecovery()
		retried, retryErr := w.scheduleTaskRetry(recoveryCtx, task, leaseOwner)
		if retried {
			return nil
		}
		if retryErr != nil {
			log.Printf("task %s retry scheduling failed: %v", taskID, retryErr)
		}
	}

	if callErr == nil && len(outputKeys) > 0 {
		var succeeded *store.Task
		storeErr := func() error {
			return w.St.Tx(ctx, func(tx pgx.Tx) error {
				dbTask, gerr := store.GetTask(ctx, tx, taskID)
				if gerr != nil || dbTask == nil {
					return gerr
				}
				won, merr := taskflow.MarkSucceededOwned(ctx, tx, dbTask, outputKeys, thumbnailKeys, time.Now().UTC(), leaseOwner)
				if won {
					if attemptID != uuid.Nil {
						if supersedeErr := store.SupersedeOtherTaskUpstreamAttempts(ctx, tx, taskID, attemptID, time.Now().UTC()); supersedeErr != nil {
							return supersedeErr
						}
					}
					succeeded = dbTask
				}
				return merr
			})
		}()
		if storeErr == nil {
			if succeeded == nil {
				// Another owner (for example an admin cancellation) won the
				// terminal transition. The uploaded attempt is no longer live.
				collector.cleanup()
				return nil
			}
			// M4：通知在主事务提交后尽力而为
			taskflow.NotifyTaskSucceeded(ctx, w.St.Pool, succeeded, len(outputKeys))
			w.enqueueAutomaticBackgroundRemoval(ctx, succeeded, outputKeys)
			w.publishTaskEvent(ctx, task, taskstream.Event{
				Stage: "complete", Status: "succeeded", ImageCount: len(outputKeys), Done: true,
			})
			return nil
		}
		collector.cleanup()
		log.Printf("task %s failed to store outputs: %v", taskID, storeErr)
		errorCode, errorMessage = "storage_error", "图片保存失败，请重试"
	}

	return w.markFailedOwned(ctx, taskID, errorCode, errorMessage, leaseOwner)
}

func taskRetryIsIdempotent(task *store.Task, provider string) bool {
	adapter := strings.ToLower(taskParamString(task.Params, "_serviceProvider"))
	if adapter == modelconfig.AdapterOpenAI || provider == "c2a" {
		return true
	}
	if adapter == modelconfig.AdapterCRUN || provider == "crun" {
		// CRUN does not expose a client idempotency key. It is safe to resume only
		// after every upstream task ID has been durably recorded.
		return len(taskParamStrings(task.Params, "_crunTaskIds")) > 0
	}
	return false
}

func taskDispatchBackoff(reason string, taskID uuid.UUID) time.Duration {
	if reason == "user_execution_limit" {
		return 5*time.Second + time.Duration(taskID[0]%6)*time.Second
	}
	// Provider and global saturation affect many queued tasks at once. A wider
	// deterministic jitter avoids a thundering herd against PostgreSQL and Redis
	// while image generation is already using all available upstream capacity.
	return 15*time.Second + time.Duration(taskID[0]%16)*time.Second
}

func isRetryableTaskError(err error) bool {
	if c2a.IsRetryableError(err) || crun.IsRetryableError(err) {
		return true
	}
	var networkErr net.Error
	return errors.As(err, &networkErr)
}

func (w *Worker) handlePollImageTask(ctx context.Context, t *asynq.Task) error {
	if w.pollWorkers != nil && !w.pollWorkers.TryAcquire(1) {
		var deferred taskflow.PollImageTasksPayload
		if json.Unmarshal(t.Payload(), &deferred) == nil {
			return w.Queue.EnqueueImagePoll(ctx, deferred.ProviderID, deferred.RouteID, deferred.RouteKey, deferred.Generation, time.Second)
		}
		return nil
	}
	if w.pollWorkers != nil {
		defer w.pollWorkers.Release(1)
	}
	var payload taskflow.PollImageTasksPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("bad poll payload: %w", err)
	}
	if strings.TrimSpace(payload.ProviderID) == "" {
		return errors.New("bad poll provider_id")
	}
	cfg, err := w.runtimeModelConfig(ctx)
	if err != nil {
		return err
	}
	var provider *modelconfig.Provider
	for index := range cfg.Providers {
		if cfg.Providers[index].ID == payload.ProviderID && cfg.Providers[index].Enabled {
			for _, route := range modelconfig.ExecutionRoutes(cfg.Providers[index]) {
				if payload.RouteID == "" || route.RouteID == payload.RouteID {
					selected := route
					provider = &selected
					break
				}
			}
			break
		}
	}
	routeKey := payload.RouteKey
	if routeKey == "" {
		routeKey = payload.ProviderID
	}
	if provider == nil {
		// A provider/route can be disabled or edited after submission. Poll with
		// the encrypted route snapshot captured by the attempt instead of losing
		// the upstream result.
		snapshot, snapshotErr := store.GetPendingUpstreamAttemptRoute(ctx, w.St.Pool, routeKey)
		if snapshotErr != nil {
			return snapshotErr
		}
		if snapshot != nil {
			provider = &modelconfig.Provider{
				ID: snapshot.ProviderID, RouteID: snapshot.RouteID,
				Adapter: snapshot.Adapter, BaseURL: snapshot.BaseURL,
				TimeoutSecs: snapshot.TimeoutSecs, MaxConcurrency: snapshot.MaxConcurrency,
				Enabled: true,
			}
		}
	}
	if provider == nil || (provider.Adapter != modelconfig.AdapterOpenAI && provider.Adapter != modelconfig.AdapterCRUN) {
		return w.requeueUnavailableProviderTasks(ctx, routeKey)
	}
	routeKey = modelconfig.ExecutionRouteKey(*provider)
	// Keep each poll short enough that result persistence cannot consume the
	// whole Asynq timeout. Provider capacity still controls total in-flight work.
	limit := min(max(provider.MaxConcurrency, 20), 10000)
	pollOwner := "attempt-poller:" + routeKey + ":" + uuid.NewString()
	tasks, err := store.ClaimPendingUpstreamTasksByRoute(ctx, w.St.Pool, routeKey, pollOwner,
		time.Now().UTC(), upstreamAttemptPollLease, limit)
	if err != nil {
		return err
	}
	if len(tasks) == 0 {
		pendingRoute, pendingErr := store.GetPendingUpstreamAttemptRoute(ctx, w.St.Pool, routeKey)
		if pendingErr != nil {
			return pendingErr
		}
		if pendingRoute == nil {
			return nil
		}
		// Keep one lightweight route coordinator alive. A submit racing with an
		// empty poll can otherwise have its enqueue deduplicated just before this
		// handler exits, leaving completed upstream work without a successor poll.
		return w.Queue.EnqueueImagePoll(ctx, provider.ID, provider.RouteID, routeKey, (payload.Generation+1)%2, 5*time.Second)
	}
	type providerTaskGroup struct {
		provider *modelconfig.Provider
		tasks    []*store.Task
	}
	groups := make(map[string]*providerTaskGroup)
	for _, task := range tasks {
		attemptProvider, providerErr := w.providerForUpstreamAttempt(task, provider)
		if providerErr != nil {
			w.finishFailedUpstreamAttempt(ctx, task, "model_config_error", "历史服务商凭据无法解密", "")
			continue
		}
		fingerprint := sha256.Sum256([]byte(strings.Join([]string{
			attemptProvider.Adapter, attemptProvider.BaseURL, attemptProvider.APIKey,
			strconv.Itoa(attemptProvider.TimeoutSecs),
		}, "\x00")))
		key := fmt.Sprintf("%x", fingerprint)
		group := groups[key]
		if group == nil {
			group = &providerTaskGroup{provider: attemptProvider}
			groups[key] = group
		}
		group.tasks = append(group.tasks, task)
	}
	for _, group := range groups {
		switch group.provider.Adapter {
		case modelconfig.AdapterOpenAI:
			w.pollOpenAIProviderTasks(ctx, group.provider, group.tasks)
		case modelconfig.AdapterCRUN:
			w.pollCRUNProviderTasks(ctx, group.provider, group.tasks)
		}
	}
	delay := 2*time.Second + time.Duration(len(tasks)%3)*time.Second
	return w.Queue.EnqueueImagePoll(ctx, provider.ID, provider.RouteID, routeKey, (payload.Generation+1)%2, delay)
}

func (w *Worker) providerForUpstreamAttempt(task *store.Task, fallback *modelconfig.Provider) (*modelconfig.Provider, error) {
	baseURL := taskParamString(task.Params, "_upstreamBaseURL")
	encryptedKey := taskParamString(task.Params, "_upstreamAPIKeyEncrypted")
	if baseURL == "" || encryptedKey == "" {
		if fallback == nil {
			return nil, errors.New("upstream attempt route snapshot unavailable")
		}
		copyProvider := *fallback
		return &copyProvider, nil
	}
	apiKey, err := settings.DecryptSecret(encryptedKey, w.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	timeout, _ := taskParamInt64(task.Params, "_upstreamTimeoutSecs")
	maxConcurrency, _ := taskParamInt64(task.Params, "_upstreamMaxConcurrency")
	return &modelconfig.Provider{
		ID:      taskParamString(task.Params, "_providerConfigId"),
		RouteID: taskParamString(task.Params, "_providerRouteId"),
		Adapter: taskParamString(task.Params, "_serviceProvider"),
		BaseURL: baseURL, APIKey: apiKey, TimeoutSecs: int(timeout),
		MaxConcurrency: max(1, int(maxConcurrency)), Enabled: true,
	}, nil
}

func (w *Worker) pollOpenAIProviderTasks(ctx context.Context, provider *modelconfig.Provider, tasks []*store.Task) {
	client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, provider.TimeoutSecs, w.Cfg.AppEnv == "development")
	for start := 0; start < len(tasks); start += 20 {
		end := min(start+20, len(tasks))
		batch := tasks[start:end]
		ids := make([]string, 0, len(batch))
		expected := make(map[string]int, len(batch))
		byID := make(map[string]*store.Task, len(batch))
		claims := make(map[string]string, len(batch))
		for _, task := range batch {
			id := task.ID.String()
			ids = append(ids, id)
			expected[id] = task.Count
			byID[id] = task
		}
		if len(ids) == 0 {
			continue
		}
		processed := make(map[string]bool, len(ids))
		client.PollImageTasksEachGuarded(ctx, ids, expected, func(taskID string) bool {
			task := byID[taskID]
			if task == nil {
				return false
			}
			claimID := uuid.NewString()
			claimed, err := store.TryClaimTaskCompletion(ctx, w.St.Pool, task.ID, claimID, time.Now().UTC(), taskCompletionLease)
			if err != nil {
				log.Printf("task %s async completion claim failed: %v", task.ID, err)
				return false
			}
			if claimed {
				claims[taskID] = claimID
			}
			return claimed
		}, func(taskID string, result c2a.ImageTaskPollResult) {
			task := byID[taskID]
			if task == nil {
				return
			}
			processed[taskID] = true
			claimID := claims[taskID]
			if result.Pending {
				if result.Missing {
					w.finishUncertainImagePoll(ctx, task, "upstream task missing from poll response", false, "")
				} else {
					w.finishPendingImagePoll(ctx, task, provider, "")
				}
				return
			}
			if result.Err != nil {
				if result.ExplicitFailure {
					if claimID == "" {
						var claimed bool
						claimID, claimed = w.claimAsyncTaskCompletion(ctx, task)
						if !claimed {
							w.releaseUpstreamAttemptPoll(ctx, task)
							return
						}
					}
					w.finishOpenAIPollError(ctx, task, result.Err, claimID)
					return
				}
				w.finishUncertainImagePoll(ctx, task, result.Err.Error(), !c2a.IsRetryableError(result.Err), claimID)
				return
			}
			if claimID == "" {
				// Another route owns completion; release only this attempt poll.
				w.releaseUpstreamAttemptPoll(ctx, task)
				return
			}
			if err := w.completePolledImageTask(ctx, task, result.Images, claimID); err != nil {
				log.Printf("task %s async completion failed: %v", task.ID, err)
			}
		})
		for taskID, task := range byID {
			if !processed[taskID] {
				if claimID := claims[taskID]; claimID != "" {
					_, _ = store.ReleaseTaskCompletionClaim(ctx, w.St.Pool, task.ID, claimID)
				}
				w.releaseUpstreamAttemptPoll(ctx, task)
			}
		}
	}
}

func (w *Worker) finishOpenAIPollError(ctx context.Context, task *store.Task, pollErr error, claimID string) {
	var upstreamErr *c2a.UpstreamError
	if errors.As(pollErr, &upstreamErr) {
		w.finishFailedUpstreamAttempt(ctx, task, "upstream_error", sanitizeUpstreamMessage(upstreamErr.Message), claimID)
		return
	}
	w.finishFailedUpstreamAttempt(ctx, task, "upstream_unreachable", "生成服务暂时不可用，请稍后重试", claimID)
}

func (w *Worker) pollCRUNProviderTasks(ctx context.Context, provider *modelconfig.Provider, tasks []*store.Task) {
	for _, task := range tasks {
		client, err := crun.New(provider.BaseURL, provider.APIKey, task.Model, provider.TimeoutSecs)
		if err != nil {
			claimID, claimed := w.claimAsyncTaskCompletion(ctx, task)
			if claimed {
				w.finishFailedUpstreamAttempt(ctx, task, "model_config_error", "任务绑定的服务商配置已失效", claimID)
			} else {
				w.releaseUpstreamAttemptPoll(ctx, task)
			}
			continue
		}
		urls, pending, pollErr := client.PollTasks(ctx, taskParamStrings(task.Params, "_crunTaskIds"))
		if pending || crun.IsRetryableError(pollErr) {
			w.finishPendingImagePoll(ctx, task, provider, "")
			continue
		}
		claimID, claimed := w.claimAsyncTaskCompletion(ctx, task)
		if !claimed {
			w.releaseUpstreamAttemptPoll(ctx, task)
			continue
		}
		if pollErr != nil {
			w.finishFailedUpstreamAttempt(ctx, task, "upstream_error", sanitizeUpstreamMessage(pollErr.Error()), claimID)
			continue
		}
		images := make([]string, 0, len(urls))
		for _, imageURL := range urls {
			data, _, _, err := downloadAssistantImage(ctx, imageURL)
			if err != nil {
				pollErr = err
				break
			}
			images = append(images, base64.StdEncoding.EncodeToString(data))
		}
		if pollErr != nil {
			_, _ = store.ReleaseTaskCompletionClaim(ctx, w.St.Pool, task.ID, claimID)
			w.releaseUpstreamAttemptPoll(ctx, task)
			log.Printf("task %s CRUN image download failed: %v", task.ID, pollErr)
			continue
		}
		if err := w.completePolledImageTask(ctx, task, images, claimID); err != nil {
			log.Printf("task %s CRUN completion failed: %v", task.ID, err)
		}
	}
}

func (w *Worker) claimAsyncTaskCompletion(ctx context.Context, task *store.Task) (string, bool) {
	claimID := uuid.NewString()
	claimed, err := store.TryClaimTaskCompletion(ctx, w.St.Pool, task.ID, claimID, time.Now().UTC(), taskCompletionLease)
	if err != nil {
		log.Printf("task %s completion claim failed: %v", task.ID, err)
		return "", false
	}
	return claimID, claimed
}

func providerTimeoutSecs(provider *modelconfig.Provider) int {
	if provider.TimeoutSecs > 0 {
		return provider.TimeoutSecs
	}
	if provider.Adapter == modelconfig.AdapterCRUN {
		return 1200
	}
	return 300
}

func upstreamAttemptID(task *store.Task) uuid.UUID {
	if task == nil {
		return uuid.Nil
	}
	id, err := uuid.Parse(taskParamString(task.Params, "_upstreamAttemptId"))
	if err != nil {
		return uuid.Nil
	}
	return id
}

func upstreamAttemptTime(task *store.Task, key string) (time.Time, bool) {
	value, ok := taskParamInt64(task.Params, key)
	if !ok || value <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(value).UTC(), true
}

func (w *Worker) releaseUpstreamAttemptPoll(ctx context.Context, task *store.Task) {
	id := upstreamAttemptID(task)
	owner := taskParamString(task.Params, "_upstreamAttemptPollOwner")
	if id == uuid.Nil || owner == "" {
		return
	}
	if err := store.ReleaseTaskUpstreamAttemptPoll(ctx, w.St.Pool, id, owner); err != nil {
		log.Printf("task %s attempt %s poll lease release failed: %v", task.ID, id, err)
	}
}

func taskUsesAttemptRoute(task *store.Task, attemptTask *store.Task) bool {
	if task == nil || attemptTask == nil {
		return false
	}
	return taskParamString(task.Params, "_providerRouteKey") == taskParamString(attemptTask.Params, "_providerRouteKey")
}

func (w *Worker) renewCurrentAttemptTaskLease(ctx context.Context, attemptTask *store.Task) {
	current, err := store.GetTask(ctx, w.St.Pool, attemptTask.ID)
	if err != nil || current == nil || current.Status != "running" || !taskUsesAttemptRoute(current, attemptTask) {
		return
	}
	owner := taskLeaseOwner(current)
	if owner != "poller:"+taskParamString(attemptTask.Params, "_providerRouteKey") {
		return
	}
	_, _ = store.RenewTaskLease(ctx, w.St.Pool, current.ID, owner, time.Now().UTC(), asyncTaskLease)
}

func (w *Worker) finalizeTaskAfterAttempts(ctx context.Context, attemptTask *store.Task, errorCode, errorMessage string) {
	pending, err := store.CountPendingTaskUpstreamAttempts(ctx, w.St.Pool, attemptTask.ID)
	if err != nil || pending > 0 {
		if err != nil {
			log.Printf("task %s count pending attempts failed: %v", attemptTask.ID, err)
		}
		return
	}
	current, err := store.GetTask(ctx, w.St.Pool, attemptTask.ID)
	if err != nil || current == nil {
		return
	}
	switch current.Status {
	case "queued":
		_, err = taskflow.FailQueuedTask(ctx, w.St, current.ID, errorCode, errorMessage)
	case "running":
		// Do not fail a newly claimed synchronous attempt during the tiny window
		// before its durable attempt row is registered.
		if !taskUsesAttemptRoute(current, attemptTask) {
			return
		}
		owner := taskLeaseOwner(current)
		if owner == "" {
			return
		}
		err = w.markFailedOwned(ctx, current.ID, errorCode, errorMessage, owner)
	}
	if err != nil {
		log.Printf("task %s final failure after attempts failed: %v", attemptTask.ID, err)
	}
}

func (w *Worker) failCurrentTaskAndCloseAttempts(ctx context.Context, attemptTask *store.Task, errorCode, errorMessage string) {
	var failedTask *store.Task
	won := false
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		current, getErr := store.GetTask(ctx, tx, attemptTask.ID)
		if getErr != nil || current == nil || current.Status != "running" || !taskUsesAttemptRoute(current, attemptTask) {
			return getErr
		}
		owner := taskLeaseOwner(current)
		if owner == "" {
			return nil
		}
		won, getErr = taskflow.MarkFailedOwned(ctx, tx, current, errorCode, errorMessage, "running", owner)
		if getErr != nil || !won {
			return getErr
		}
		if getErr = store.SupersedePendingTaskUpstreamAttempts(ctx, tx, current.ID, time.Now().UTC()); getErr != nil {
			return getErr
		}
		failedTask = current
		return nil
	})
	if err != nil {
		log.Printf("task %s terminal close after route exhaustion failed: %v", attemptTask.ID, err)
		return
	}
	if won && failedTask != nil {
		taskflow.NotifyTaskFailed(ctx, w.St.Pool, failedTask)
		w.publishTaskEvent(ctx, failedTask, taskstream.Event{Stage: "failed", Status: "failed", Done: true})
	}
}

func (w *Worker) finishUncertainImagePoll(ctx context.Context, task *store.Task, detail string, immediate bool, claimID string) {
	if claimID != "" {
		_, _ = store.ReleaseTaskCompletionClaim(ctx, w.St.Pool, task.ID, claimID)
	}
	defer w.releaseUpstreamAttemptPoll(ctx, task)
	attemptID := upstreamAttemptID(task)
	if attemptID == uuid.Nil {
		return
	}
	if len(detail) > 2000 {
		detail = detail[:2000]
	}
	if err := store.RecordTaskUpstreamAttemptPollError(ctx, w.St.Pool, attemptID, detail); err != nil {
		log.Printf("task %s attempt %s record unknown poll outcome failed: %v", task.ID, attemptID, err)
		return
	}
	now := time.Now().UTC()
	if !immediate {
		if submittedAt, ok := upstreamAttemptTime(task, "_upstreamAttemptSubmittedAtMs"); ok && now.Before(submittedAt.Add(30*time.Second)) {
			w.renewCurrentAttemptTaskLease(ctx, task)
			return
		}
	}
	scheduled, err := store.MarkTaskUpstreamAttemptFailoverScheduled(ctx, w.St.Pool, attemptID, now)
	if err != nil {
		log.Printf("task %s attempt %s unknown-outcome failover fence failed: %v", task.ID, attemptID, err)
		return
	}
	if !scheduled && !taskParamBool(task.Params, "_upstreamAttemptFailoverScheduled") {
		w.renewCurrentAttemptTaskLease(ctx, task)
		return
	}
	current, err := store.GetTask(ctx, w.St.Pool, task.ID)
	if err != nil || current == nil || current.Status != "running" || !taskUsesAttemptRoute(current, task) {
		return
	}
	retried, retryErr := w.scheduleTaskRetry(ctx, current, taskLeaseOwner(current))
	if retryErr != nil {
		log.Printf("task %s uncertain route failover scheduling failed: %v", task.ID, retryErr)
		return
	}
	if retried {
		log.Printf("task %s attempt %s route outcome unknown; switched route while retaining background recovery", task.ID, attemptID)
		return
	}
	w.failCurrentTaskAndCloseAttempts(ctx, task, "upstream_unreachable", "所有生成线路均已失联或失败，任务已终止并退款")
}

func (w *Worker) finishPendingImagePoll(ctx context.Context, task *store.Task, provider *modelconfig.Provider, claimID string) {
	if claimID != "" {
		_, _ = store.ReleaseTaskCompletionClaim(ctx, w.St.Pool, task.ID, claimID)
	}
	defer w.releaseUpstreamAttemptPoll(ctx, task)
	attemptID := upstreamAttemptID(task)
	if attemptID == uuid.Nil {
		return
	}
	now := time.Now().UTC()
	if expiresAt, ok := upstreamAttemptTime(task, "_upstreamAttemptExpiresAtMs"); ok && !now.Before(expiresAt) {
		finished, err := store.FinishTaskUpstreamAttempt(ctx, w.St.Pool, attemptID,
			store.UpstreamAttemptExpired, "upstream result recovery window expired", now)
		if err != nil {
			log.Printf("task %s attempt %s expiry failed: %v", task.ID, attemptID, err)
			return
		}
		if finished {
			w.finalizeTaskAfterAttempts(ctx, task, "upstream_unreachable", "生成服务响应超时，请重试")
		}
		return
	}
	if failoverAt, ok := upstreamAttemptTime(task, "_upstreamAttemptFailoverAtMs"); ok && !now.Before(failoverAt) {
		scheduled, err := store.MarkTaskUpstreamAttemptFailoverScheduled(ctx, w.St.Pool, attemptID, now)
		if err != nil {
			log.Printf("task %s attempt %s failover fence failed: %v", task.ID, attemptID, err)
		} else if scheduled || taskParamBool(task.Params, "_upstreamAttemptFailoverScheduled") {
			current, getErr := store.GetTask(ctx, w.St.Pool, task.ID)
			if getErr == nil && current != nil && current.Status == "running" && taskUsesAttemptRoute(current, task) {
				owner := taskLeaseOwner(current)
				retried, retryErr := w.scheduleTaskRetry(ctx, current, owner)
				if retryErr != nil {
					log.Printf("task %s timeout failover scheduling failed: %v", task.ID, retryErr)
				} else if retried {
					log.Printf("task %s attempt %s timed out; old result remains recoverable while a new route starts", task.ID, attemptID)
				} else {
					w.failCurrentTaskAndCloseAttempts(ctx, task, "upstream_unreachable", "所有生成线路均已失联或失败，任务已终止并退款")
				}
			}
		}
	}
	// Keep only a still-active route lease alive. Exhausted routes are closed
	// above instead of presenting a long recovery window as "generating".
	w.renewCurrentAttemptTaskLease(ctx, task)
}

func (w *Worker) requeueUnavailableProviderTasks(ctx context.Context, providerID string) error {
	owner := "unavailable-attempt:" + providerID + ":" + uuid.NewString()
	tasks, err := store.ClaimPendingUpstreamTasksByRoute(ctx, w.St.Pool, providerID, owner,
		time.Now().UTC(), upstreamAttemptPollLease, 10000)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		w.finishFailedUpstreamAttempt(ctx, task, "upstream_unreachable", "任务绑定的服务商当前不可用", "")
	}
	return nil
}

func (w *Worker) finishFailedUpstreamAttempt(ctx context.Context, task *store.Task, errorCode, errorMessage, claimID string) {
	if claimID != "" {
		_, _ = store.ReleaseTaskCompletionClaim(ctx, w.St.Pool, task.ID, claimID)
	}
	defer w.releaseUpstreamAttemptPoll(ctx, task)
	attemptID := upstreamAttemptID(task)
	if attemptID == uuid.Nil {
		return
	}
	finished, err := store.FinishTaskUpstreamAttempt(ctx, w.St.Pool, attemptID,
		store.UpstreamAttemptFailed, errorMessage, time.Now().UTC())
	if err != nil || !finished {
		if err != nil {
			log.Printf("task %s attempt %s failure persistence failed: %v", task.ID, attemptID, err)
		}
		return
	}
	current, getErr := store.GetTask(ctx, w.St.Pool, task.ID)
	if getErr == nil && current != nil && current.Status == "running" && taskUsesAttemptRoute(current, task) {
		retried, retryErr := w.scheduleTaskRetry(ctx, current, taskLeaseOwner(current))
		if retryErr != nil {
			log.Printf("task %s failed-route retry scheduling failed: %v", task.ID, retryErr)
		}
		if retried {
			return
		}
		w.failCurrentTaskAndCloseAttempts(ctx, task, errorCode, errorMessage)
		return
	}
	w.finalizeTaskAfterAttempts(ctx, task, errorCode, errorMessage)
}

func failedTaskProviderIDs(task *store.Task) []string {
	providerID := taskParamString(task.Params, "_providerRouteKey")
	if providerID == "" {
		providerID = taskParamString(task.Params, "_providerConfigId")
	}
	if providerID == "" {
		return taskParamStrings(task.Params, "_failedProviderConfigIds")
	}
	failed := taskParamStrings(task.Params, "_failedProviderConfigIds")
	for _, existing := range failed {
		if existing == providerID {
			return failed
		}
	}
	return append(failed, providerID)
}

func (w *Worker) completePolledImageTask(ctx context.Context, task *store.Task, images []string, claimID string) error {
	defer w.releaseUpstreamAttemptPoll(ctx, task)
	claimCtx, cancelClaim := context.WithCancel(ctx)
	defer cancelClaim()
	go func() {
		ticker := time.NewTicker(taskCompletionLease / 3)
		defer ticker.Stop()
		for {
			select {
			case <-claimCtx.Done():
				return
			case now := <-ticker.C:
				ok, err := store.RenewTaskCompletionClaim(claimCtx, w.St.Pool, task.ID, claimID, now, taskCompletionLease)
				if err != nil || !ok {
					if err != nil {
						log.Printf("task %s completion lease renewal failed: %v", task.ID, err)
					}
					return
				}
			}
		}
	}()
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = store.ReleaseTaskCompletionClaim(releaseCtx, w.St.Pool, task.ID, claimID)
	}()
	collector := newClaimedTaskOutputCollector(w, ctx, task, claimID)
	if err := deliverEncodedImages(images, collector.persist); err != nil {
		collector.cleanup()
		errorCode, errorMessage := "storage_error", "图片保存失败，请重试"
		var outputProcessingErr *taskOutputProcessingError
		if errors.As(err, &outputProcessingErr) {
			errorCode, errorMessage = "image_processing_error", "图片处理失败，请重试"
		}
		return w.markFailedClaimed(ctx, task.ID, errorCode, errorMessage, claimID)
	}
	outputKeys, thumbnailKeys := collector.completed()
	if len(outputKeys) == 0 {
		w.finishFailedUpstreamAttempt(ctx, task, "upstream_error", "生成服务未返回图片，请重试", claimID)
		return nil
	}
	var succeeded *store.Task
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		dbTask, getErr := store.GetTask(ctx, tx, task.ID)
		if getErr != nil || dbTask == nil {
			return getErr
		}
		won, markErr := taskflow.MarkSucceededClaimed(ctx, tx, dbTask, outputKeys, thumbnailKeys, time.Now().UTC(), claimID)
		if won {
			attemptID := upstreamAttemptID(task)
			if attemptID != uuid.Nil {
				finishedAt := time.Now().UTC()
				if _, attemptErr := store.FinishTaskUpstreamAttempt(ctx, tx, attemptID,
					store.UpstreamAttemptSucceeded, "", finishedAt); attemptErr != nil {
					return attemptErr
				}
				if supersedeErr := store.SupersedeOtherTaskUpstreamAttempts(ctx, tx, task.ID, attemptID, finishedAt); supersedeErr != nil {
					return supersedeErr
				}
			}
			succeeded = dbTask
		}
		return markErr
	})
	if err != nil {
		collector.cleanup()
		return w.markFailedClaimed(ctx, task.ID, "storage_error", "图片保存失败，请重试", claimID)
	}
	if succeeded == nil {
		collector.cleanup()
		return nil
	}
	if succeeded != nil {
		taskflow.NotifyTaskSucceeded(ctx, w.St.Pool, succeeded, len(outputKeys))
		w.enqueueAutomaticBackgroundRemoval(ctx, succeeded, outputKeys)
	}
	w.publishTaskEvent(ctx, task, taskstream.Event{
		Stage: "complete", Status: "succeeded", ImageCount: len(outputKeys), Done: true,
	})
	return nil
}

func automaticBackgroundRemovalModel(task *store.Task) string {
	if task == nil || task.Type != "t2i" || !taskParamBool(task.Params, "autoBackgroundRemovalEnabled") {
		return ""
	}
	return taskParamString(task.Params, "autoBackgroundRemovalModelKey")
}

// enqueueAutomaticBackgroundRemoval creates children only after the parent image task has
// committed as succeeded. The deterministic key makes completion replays harmless.
func (w *Worker) enqueueAutomaticBackgroundRemoval(ctx context.Context, parent *store.Task, outputKeys []string) {
	modelKey := automaticBackgroundRemovalModel(parent)
	if modelKey == "" || len(outputKeys) == 0 {
		return
	}
	for index, outputKey := range outputKeys {
		if strings.TrimSpace(outputKey) == "" {
			continue
		}
		idempotencyKey := fmt.Sprintf("background-remove:%s:%d", parent.ID, index)
		child, created, err := taskflow.CreateTask(ctx, w.St, parent.UserID, taskflow.CreateInput{
			Type:   "background_remove",
			Prompt: "移除图片背景",
			Params: map[string]any{
				"publicModelKey":     modelKey,
				"_kind":              "wallpaper-background-remove",
				"_parentTaskId":      parent.ID.String(),
				"_parentOutputIndex": index,
				"_automatic":         true,
			},
			InputKeys:      []string{outputKey},
			Count:          1,
			IdempotencyKey: &idempotencyKey,
		})
		if err != nil {
			log.Printf("task %s automatic background removal %d creation failed: %v", parent.ID, index, err)
			continue
		}
		if !created && child.Status != "queued" {
			continue
		}
		if err := w.Queue.EnqueueRunTask(ctx, child.ID.String()); err != nil {
			log.Printf("task %s automatic background removal %d enqueue deferred; durable queued recovery will retry: %v", parent.ID, index, err)
		}
	}
}

// handleCleanupSessions cron：每小时清理过期 session。
func (w *Worker) handleCleanupSessions(ctx context.Context, _ *asynq.Task) error {
	now := time.Now().UTC()
	n, err := store.DeleteExpiredSessions(ctx, w.St.Pool, now)
	if err != nil {
		return err
	}
	adminN, err := store.DeleteExpiredAdminSessions(ctx, w.St.Pool, now)
	if err != nil {
		return err
	}
	auditN, err := store.DeleteAuditLogsBefore(ctx, w.St.Pool, now.AddDate(0, -6, 0))
	if err != nil {
		return err
	}
	if n > 0 || adminN > 0 || auditN > 0 {
		log.Printf("cleaned %d user sessions, %d admin sessions and %d audit logs", n, adminN, auditN)
	}
	return nil
}

func userUploadObjectOwner(key string) (uuid.UUID, bool) {
	parts := strings.Split(key, "/")
	if len(parts) != 4 || parts[0] != "uploads" || (parts[2] != "original" && parts[2] != "thumb") || parts[3] == "" {
		return uuid.Nil, false
	}
	owner, err := uuid.Parse(parts[1])
	return owner, err == nil
}

// handleCleanupObjectJobs retries task/assistant objects after their database
// owner has gone away. The job rows remain locked while the bounded R2 delete
// runs, so cleanup workers cannot process the same job concurrently; task and
// assistant reference creation serializes against the owning rows and the
// candidate query rechecks the broader durable reference set before deletion.
func (w *Worker) handleCleanupObjectJobs(ctx context.Context, _ *asynq.Task) error {
	if w.Storage == nil {
		return errors.New("object storage is not configured")
	}
	tx, err := w.St.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	now := time.Now().UTC()
	keys, err := store.LockReadyObjectCleanupJobs(ctx, tx, now, objectCleanupLimit)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return tx.Commit(ctx)
	}
	if err := w.Storage.DeleteKeys(ctx, keys); err != nil {
		if recordErr := store.RecordObjectCleanupFailure(ctx, tx, keys, err.Error(), now.Add(objectCleanupRetryDelay)); recordErr != nil {
			return fmt.Errorf("delete task objects: %v; record retry: %w", err, recordErr)
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return commitErr
		}
		return err
	}
	deleted, err := store.DeleteObjectCleanupJobs(ctx, tx, keys)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if deleted > 0 {
		log.Printf("cleaned %d task/assistant objects", deleted)
	}
	return nil
}

// handleCleanupUserUploads removes objects that have survived the grace
// period without a durable database reference. The database transaction holds
// row locks while R2 deletion runs, so a concurrent reference either commits
// first or observes the object as deleted and fails instead of creating a
// dangling reference.
func (w *Worker) handleCleanupUserUploads(ctx context.Context, _ *asynq.Task) error {
	if w.Storage == nil {
		return errors.New("object storage is not configured")
	}
	cutoff := time.Now().UTC().Add(-userUploadRetention)
	tx, err := w.St.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	cursor, err := store.GetUserUploadCleanupCursor(ctx, tx)
	if err != nil {
		return err
	}
	objects, nextCursor, done, err := w.Storage.ListObjectsPage(ctx, "uploads/", cursor, userUploadCleanupLimit)
	if err != nil {
		return err
	}
	databaseKeys, err := store.ListUnreferencedUserUploadObjects(ctx, tx, cutoff, userUploadCleanupLimit)
	if err != nil {
		return err
	}
	if done {
		nextCursor = ""
	}
	registrations := make([]store.UserUploadObject, 0, len(objects))
	keys := make([]string, 0, len(objects))
	orphanKeys := make([]string, 0)
	candidateObjects := make([]store.UserUploadObject, 0, len(objects))
	ownerIDs := make([]uuid.UUID, 0, len(objects))
	ownerIDSet := make(map[uuid.UUID]struct{}, len(objects))
	seenKeys := make(map[string]struct{}, len(objects)+len(databaseKeys))
	for _, object := range objects {
		if object.LastModified.IsZero() || object.LastModified.After(cutoff) {
			continue
		}
		owner, ok := userUploadObjectOwner(object.Key)
		if !ok {
			continue
		}
		candidate := store.UserUploadObject{
			Key: object.Key, UserID: owner, CreatedAt: object.LastModified,
		}
		candidateObjects = append(candidateObjects, candidate)
		if _, exists := seenKeys[object.Key]; !exists {
			seenKeys[object.Key] = struct{}{}
			keys = append(keys, object.Key)
		}
		if _, exists := ownerIDSet[owner]; !exists {
			ownerIDSet[owner] = struct{}{}
			ownerIDs = append(ownerIDs, owner)
		}
	}
	for _, key := range databaseKeys {
		if _, exists := seenKeys[key]; exists {
			continue
		}
		seenKeys[key] = struct{}{}
		keys = append(keys, key)
	}
	existingOwners, err := store.LockExistingUserUploadOwners(ctx, tx, ownerIDs)
	if err != nil {
		return err
	}
	for _, candidate := range candidateObjects {
		if _, exists := existingOwners[candidate.UserID]; !exists {
			orphanKeys = append(orphanKeys, candidate.Key)
			continue
		}
		registrations = append(registrations, candidate)
	}
	if err := store.RegisterUserUploadObjectsAt(ctx, tx, registrations); err != nil {
		return err
	}
	claimed, err := store.ClaimUnreferencedUserUploadObjects(ctx, tx, keys, cutoff)
	if err != nil {
		return err
	}
	deleteKeys := append(append([]string(nil), orphanKeys...), claimed...)
	if len(deleteKeys) == 0 {
		if err := store.SetUserUploadCleanupCursor(ctx, tx, nextCursor); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err := w.Storage.DeleteKeys(ctx, deleteKeys); err != nil {
		return err
	}
	deleted, err := store.MarkUserUploadObjectsDeleted(ctx, tx, claimed)
	if err != nil {
		return err
	}
	if err := store.SetUserUploadCleanupCursor(ctx, tx, nextCursor); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if deleted > 0 {
		log.Printf("cleaned %d unreferenced user upload objects", deleted)
	}
	return nil
}

func (w *Worker) expireTrialCampaigns(ctx context.Context) (int64, error) {
	var expired int64
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockTrialCampaignLifecycle(ctx, tx); err != nil {
			return err
		}
		var err error
		expired, err = store.CloseExpiredTrialCampaigns(ctx, tx, time.Now().UTC())
		return err
	})
	return expired, err
}

func (w *Worker) handleExpireTrialCampaigns(ctx context.Context, _ *asynq.Task) error {
	expired, err := w.expireTrialCampaigns(ctx)
	if err != nil {
		return err
	}
	if expired > 0 {
		log.Printf("closed %d expired trial campaigns", expired)
	}
	return nil
}

// handleSyncPromptSources cron：每 30 分钟扫描到期的提示词数据源并同步。
func (w *Worker) handleSyncPromptSources(ctx context.Context, _ *asynq.Task) error {
	return w.PromptSync.SyncDue(ctx)
}

// handleBackfillPromptCovers 分批补齐历史远程封面的宽高元数据。
func (w *Worker) handleBackfillPromptCovers(ctx context.Context, _ *asynq.Task) error {
	return w.PromptSync.BackfillCoverDimensions(ctx, 24)
}

// handleReapZombies cron：每 2 分钟做两种回收——
//  1. lease 过期的孤儿任务恢复为 queued 并接管；
//  2. queued 超过 2 分钟的任务（入队丢失/Redis 异常）检查后补入队；
//     Redis 仍不可用时保持 queued，下一轮继续恢复。
func (w *Worker) handleReapZombies(ctx context.Context, _ *asynq.Task) error {
	// Lease expiry, rather than task age, determines whether a running task is
	// safe to recover. Long-running tasks remain protected by heartbeats.
	threshold := time.Now().UTC()
	zombieIDs, err := store.RequeueExpiredRunningTasks(ctx, w.St.Pool, threshold)
	if err != nil {
		return err
	}
	for _, taskID := range zombieIDs {
		if err := w.Queue.EnqueueRunTaskRecovery(ctx, taskID.String()); err != nil {
			log.Printf("recovered zombie task %s enqueue failed: %v", taskID, err)
			continue
		}
		log.Printf("recovered zombie task %s", taskID)
	}

	return w.reapStaleQueued(ctx)
}

func (w *Worker) handleEnsureImagePolls(ctx context.Context, _ *asynq.Task) error {
	routes, err := store.ListAsyncPendingRoutes(ctx, w.St.Pool, 1000)
	if err != nil {
		return err
	}
	for _, route := range routes {
		if err := w.Queue.EnqueueImagePoll(ctx, route.ProviderID, route.RouteID, route.RouteKey, 0, 0); err != nil {
			return fmt.Errorf("ensure image poll for route %s: %w", route.RouteKey, err)
		}
	}
	return nil
}

// reapStaleQueued 扫描 queued 超时任务，先按业务 task ID 检查
// 所有可执行队列记录，确实丢失时才补一次入队。
func (w *Worker) reapStaleQueued(ctx context.Context) error {
	threshold := time.Now().UTC().Add(-staleQueuedMinutes * time.Minute)
	staleIDs, err := store.ListStaleQueuedTaskIDs(ctx, w.St.Pool, threshold)
	if err != nil {
		return err
	}
	queuedTaskIDs, err := w.Queue.QueuedRunTaskIDs()
	if err != nil {
		return fmt.Errorf("inspect executable queue tasks: %w", err)
	}
	for _, taskID := range staleIDs {
		if _, queued := queuedTaskIDs[taskID.String()]; queued {
			continue
		}
		if err := w.Queue.EnqueueRunTaskRecovery(ctx, taskID.String()); err != nil {
			log.Printf("stale queued task %s re-enqueue failed; keeping durable queued state: %v", taskID, err)
			continue
		}
		log.Printf("re-enqueued stale queued task %s", taskID)
	}
	return nil
}
