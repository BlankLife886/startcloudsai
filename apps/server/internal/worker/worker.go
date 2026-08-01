// Package worker 实现 Asynq handler：run_task + 定时任务（session 清理、僵尸回收）。
package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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
	typeSyncPromptSources    = "cron:sync_prompt_sources"
	typeBackfillPromptCovers = "cron:backfill_prompt_cover_dimensions"

	zombieRunningMinutes = 30
	staleQueuedMinutes   = 10
	maxNetworkRecoveries = 3
)

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
}

func New(cfg *config.Config, st *store.Store, stg *storage.Storage, c2aClient *c2a.Client, queue *taskflow.Queue) *Worker {
	imageMemoryBytes := max(cfg.WorkerImageMemoryMiB, 64) << 20
	return &Worker{
		Cfg: cfg, St: st, Storage: stg, C2A: c2aClient, Queue: queue,
		PromptSync:       promptsync.New(st, cfg.AppEnv == "development"),
		Stream:           assistantstream.NewClient(cfg.RedisURL),
		imageMemory:      semaphore.NewWeighted(imageMemoryBytes),
		imageMemoryBytes: imageMemoryBytes,
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
	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: w.Cfg.WorkerConcurrency,
	})
	log.Printf("worker ready concurrency=%d", w.Cfg.WorkerConcurrency)
	mux := asynq.NewServeMux()
	mux.HandleFunc(taskflow.TypeRunTask, w.handleRunTask)
	mux.HandleFunc(taskflow.TypeRunAssistant, w.handleRunAssistant)
	mux.HandleFunc(typeCleanupSessions, w.handleCleanupSessions)
	mux.HandleFunc(typeReapZombies, w.handleReapZombies)
	mux.HandleFunc(typeSyncPromptSources, w.handleSyncPromptSources)
	mux.HandleFunc(typeBackfillPromptCovers, w.handleBackfillPromptCovers)

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
	ids, err := store.RequeueAllRunningTasks(ctx, w.St.Pool)
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

type staticPeriodicConfigProvider struct{}

func (p *staticPeriodicConfigProvider) GetConfigs() ([]*asynq.PeriodicTaskConfig, error) {
	return []*asynq.PeriodicTaskConfig{
		{Cronspec: "@every 1h", Task: asynq.NewTask(typeCleanupSessions, nil, asynq.MaxRetry(0))},
		{Cronspec: "@every 10m", Task: asynq.NewTask(typeReapZombies, nil, asynq.MaxRetry(0))},
		{Cronspec: "@every 30m", Task: asynq.NewTask(typeSyncPromptSources, nil, asynq.MaxRetry(0))},
		{Cronspec: "@every 10m", Task: asynq.NewTask(typeBackfillPromptCovers, nil, asynq.MaxRetry(0))},
	}, nil
}

// claimTask 条件更新 queued→running，抢不到返回 nil。
func (w *Worker) claimTask(ctx context.Context, taskID uuid.UUID) (*store.Task, string, error) {
	queued, err := store.GetTask(ctx, w.St.Pool, taskID)
	if err != nil || queued == nil || queued.Status != "queued" {
		return nil, "", err
	}
	var claimedTask *store.Task
	deferReason := ""
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
		claimed, err := store.ClaimTask(ctx, tx, taskID, time.Now().UTC())
		if err != nil || !claimed {
			return err
		}
		claimedTask, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return claimedTask, deferReason, err
}

func (w *Worker) loadInputImageBytes(ctx context.Context, inputKeys []string) ([][]byte, error) {
	images := make([][]byte, len(inputKeys))
	errs := make([]error, len(inputKeys))
	var wg sync.WaitGroup
	for index, key := range inputKeys {
		wg.Add(1)
		go func(index int, key string) {
			defer wg.Done()
			images[index], errs[index] = w.Storage.GetBytes(ctx, key)
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
	images, err := client.GenerateImageProgressive(ctx, finalPrompt, size, quality, task.Count, references, func(index int, image sub2api.Image) error {
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
	finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
	aspectRatio := normalizeCRUNAspectRatio(task.Params, size)
	resolution := normalizeCRUNResolutionForAspect(normalizeCRUNResolution(task.Params), aspectRatio)
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
		if err := store.SetTaskCRUNTaskIDs(ctx, w.St.Pool, task.ID, created); err != nil {
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

func (w *Worker) callCRUN(ctx context.Context, task *store.Task, onImage imageReadyFunc) ([]string, error) {
	client, err := w.crunClient(ctx)
	if err != nil {
		return nil, err
	}
	return w.callCRUNClient(ctx, task, client, onImage)
}

func (w *Worker) configuredModelSelection(ctx context.Context, task *store.Task) (*modelconfig.Selection, bool, error) {
	providerID := taskParamString(task.Params, "_providerConfigId")
	modelID := taskParamString(task.Params, "_modelConfigId")
	if providerID == "" || modelID == "" {
		return nil, false, nil
	}
	cfg, err := modelconfig.Runtime(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		return nil, false, err
	}
	selection, found := modelconfig.FindExecution(cfg, providerID, modelID)
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
			TransparentBackground: taskParamBool(task.Params, "transparentPngEnabled", "transparentPng", "transparentBackground"),
			OutputFormat:          taskParamString(task.Params, "outputFormat"),
			ModerationLevel:       taskParamString(task.Params, "moderationLevel"),
		}
		var images []string
		var err error
		if len(task.InputKeys) > 0 {
			inputs, err := w.loadInputImagesB64(ctx, task.InputKeys)
			if err != nil {
				return nil, err
			}
			images, err = client.EditImagesWithOptions(ctx, task.ID.String(), finalPrompt, model, task.Count, inputs, size, imageOptions)
		} else {
			images, err = client.GenerateImagesWithOptions(ctx, task.ID.String(), finalPrompt, model, task.Count, size, imageOptions)
		}
		if err != nil {
			return images, err
		}
		return images, deliverEncodedImages(images, onImage)
	case modelconfig.AdapterCRUN:
		client, err := crun.New(provider.BaseURL, provider.APIKey, model, timeout)
		if err != nil {
			return nil, err
		}
		return w.callCRUNClient(ctx, task, client, onImage)
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

func taskParamString(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	if value, ok := params[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
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
func (w *Worker) applyMaskEditComposite(ctx context.Context, task *store.Task, imagesB64 []string) []string {
	maskKey := taskParamString(task.Params, "maskKey")
	baseKey := taskParamString(task.Params, "maskBaseKey")
	rectRaw := taskParamString(task.Params, "maskRect")
	if maskKey == "" || baseKey == "" || rectRaw == "" {
		return imagesB64
	}
	rect, err := media.ParseMaskRect(rectRaw)
	if err != nil {
		log.Printf("task %s mask composite skipped: bad rect %q: %v", task.ID, rectRaw, err)
		return imagesB64
	}
	baseData, err := w.Storage.GetBytes(ctx, baseKey)
	if err != nil {
		log.Printf("task %s mask composite skipped: load base: %v", task.ID, err)
		return imagesB64
	}
	maskData, err := w.Storage.GetBytes(ctx, maskKey)
	if err != nil {
		log.Printf("task %s mask composite skipped: load mask: %v", task.ID, err)
		return imagesB64
	}
	out := make([]string, 0, len(imagesB64))
	for i, b64 := range imagesB64 {
		resultData, derr := base64.StdEncoding.DecodeString(b64)
		if derr != nil {
			log.Printf("task %s mask composite output %d: bad base64: %v", task.ID, i, derr)
			out = append(out, b64)
			continue
		}
		merged, cerr := media.CompositeMaskedEdit(baseData, maskData, resultData, rect)
		if cerr != nil {
			log.Printf("task %s mask composite output %d failed, keep raw: %v", task.ID, i, cerr)
			out = append(out, b64)
			continue
		}
		out = append(out, base64.StdEncoding.EncodeToString(merged))
	}
	return out
}

func (w *Worker) markFailed(ctx context.Context, taskID uuid.UUID, errorCode, errorMessage string) error {
	var task *store.Task
	won := false
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil || t == nil {
			return err
		}
		task = t
		won, err = taskflow.MarkFailed(ctx, tx, t, errorCode, errorMessage, "running")
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
	return cleaned
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
		return err
	}
	if deferReason != "" {
		delay := 2*time.Second + time.Duration(taskID[0]%4)*time.Second
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
			return err
		}
	}
	// 服务在创建任务时快照；C2A 模型也在创建时固定，旧任务和 Sub2API 模型在首次执行时补齐。
	model := strings.TrimSpace(task.Model)
	if model == "" {
		if provider == "sub2api" {
			client, clientErr := w.assistantClient(ctx)
			if clientErr != nil {
				return clientErr
			}
			model = client.ImageModel()
		} else if provider == "crun" {
			model = crun.DefaultModel
		} else {
			model, err = settings.TaskModel(ctx, w.St.Pool, task.Type)
		}
		if err != nil {
			return err
		}
		if err := store.SetTaskModel(ctx, w.St.Pool, task.ID, model); err != nil {
			return err
		}
		task.Model = model
	}

	errorCode, errorMessage := "internal_error", "未知错误"
	collector := newTaskOutputCollector(w, ctx, task)
	upstreamStartedAt := time.Now()
	imagesB64, callErr := w.callUpstream(ctx, task, provider, model, collector.persist)
	var netErr *c2a.NetworkError
	if callErr != nil && errors.As(callErr, &netErr) {
		// 连接/超时类错误重试一次（attempt+1 落库）
		log.Printf("task %s network error, retrying once: %v", taskID, callErr)
		if berr := store.BumpTaskAttempt(ctx, w.St.Pool, taskID); berr != nil {
			log.Printf("task %s bump attempt failed: %v", taskID, berr)
		} else {
			task.Attempt++
		}
		imagesB64, callErr = w.callUpstream(ctx, task, provider, model, collector.persist)
	}
	outputKeys, thumbnailKeys := collector.completed()
	logTaskStage(taskID.String(), "upstream", upstreamStartedAt,
		"provider=%s model=%s returned=%d persisted=%d", provider, model, len(imagesB64), len(outputKeys))
	if callErr != nil {
		if len(outputKeys) > 0 {
			log.Printf("task %s upstream ended after partial success (%d/%d): %v", taskID, len(outputKeys), task.Count, callErr)
			callErr = nil
		}
	}
	if callErr != nil {
		// H1：error_message 只落用户可读文案，原始错误进日志（带 task_id）
		var upErr *c2a.UpstreamError
		var subErr *sub2api.UpstreamError
		var crunErr *crun.UpstreamError
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
		log.Printf("task %s upstream call failed (%s): %v", taskID, errorCode, callErr)
	}
	if callErr != nil && errors.As(callErr, &netErr) && len(outputKeys) == 0 &&
		(provider == "c2a" || provider == "crun") && task.Attempt < maxNetworkRecoveries {
		recoveryCtx, cancelRecovery := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelRecovery()
		requeued, requeueErr := store.RequeueRunningTask(recoveryCtx, w.St.Pool, taskID)
		if requeueErr == nil && requeued {
			delay := time.Duration(task.Attempt*15) * time.Second
			enqueueErr := w.Queue.EnqueueRunTaskRecoveryIn(recoveryCtx, taskID.String(), delay)
			if enqueueErr != nil {
				log.Printf("task %s network recovery enqueue failed; stale queue reaper will retry: %v", taskID, enqueueErr)
			} else {
				log.Printf("task %s network recovery scheduled attempt=%d delay=%s", taskID, task.Attempt, delay)
			}
			w.publishTaskEvent(recoveryCtx, task, taskstream.Event{Stage: "queued", Status: "queued"})
			return nil
		}
		if requeueErr != nil {
			log.Printf("task %s network recovery state update failed: %v", taskID, requeueErr)
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
				won, merr := taskflow.MarkSucceeded(ctx, tx, dbTask, outputKeys, thumbnailKeys, time.Now().UTC())
				if won {
					succeeded = dbTask
				}
				return merr
			})
		}()
		if storeErr == nil {
			if succeeded != nil {
				// M4：通知在主事务提交后尽力而为
				taskflow.NotifyTaskSucceeded(ctx, w.St.Pool, succeeded, len(outputKeys))
			}
			w.publishTaskEvent(ctx, task, taskstream.Event{
				Stage: "complete", Status: "succeeded", ImageCount: len(outputKeys), Done: true,
			})
			return nil
		}
		collector.cleanup()
		log.Printf("task %s failed to store outputs: %v", taskID, storeErr)
		errorCode, errorMessage = "storage_error", "图片保存失败，请重试"
	}

	return w.markFailed(ctx, taskID, errorCode, errorMessage)
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

// handleSyncPromptSources cron：每 30 分钟扫描到期的提示词数据源并同步。
func (w *Worker) handleSyncPromptSources(ctx context.Context, _ *asynq.Task) error {
	return w.PromptSync.SyncDue(ctx)
}

// handleBackfillPromptCovers 分批补齐历史远程封面的宽高元数据。
func (w *Worker) handleBackfillPromptCovers(ctx context.Context, _ *asynq.Task) error {
	return w.PromptSync.BackfillCoverDimensions(ctx, 24)
}

// handleReapZombies cron：每 10 分钟做两种回收——
//  1. running 超过 30 分钟的孤儿任务恢复为 queued 并接管；
//  2. queued 超过 10 分钟的任务（入队丢失/Redis 异常）重新入队一次，
//     再失败则 failed + release（C1 兜底）。
func (w *Worker) handleReapZombies(ctx context.Context, _ *asynq.Task) error {
	threshold := time.Now().UTC().Add(-zombieRunningMinutes * time.Minute)
	zombieIDs, err := store.ListZombieTaskIDs(ctx, w.St.Pool, threshold)
	if err != nil {
		return err
	}
	for _, taskID := range zombieIDs {
		requeued, err := store.RequeueRunningTask(ctx, w.St.Pool, taskID)
		if err != nil {
			log.Printf("failed to recover zombie task %s: %v", taskID, err)
			continue
		}
		if !requeued {
			continue
		}
		if err := w.Queue.EnqueueRunTaskRecovery(ctx, taskID.String()); err != nil {
			log.Printf("recovered zombie task %s enqueue failed: %v", taskID, err)
			continue
		}
		log.Printf("recovered zombie task %s", taskID)
	}

	return w.reapStaleQueued(ctx)
}

// reapStaleQueued C1 第二种扫描：queued 超时的任务先按业务 task ID 检查
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
			log.Printf("stale queued task %s re-enqueue failed, marking failed: %v", taskID, err)
			if _, ferr := taskflow.FailQueuedEnqueue(ctx, w.St, taskID); ferr != nil {
				log.Printf("stale queued task %s compensation failed: %v", taskID, ferr)
			}
			continue
		}
		log.Printf("re-enqueued stale queued task %s", taskID)
	}
	return nil
}
