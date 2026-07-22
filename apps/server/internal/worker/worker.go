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
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/prompt"
	"github.com/BlankLife886/startcloudsai/server/internal/promptsync"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

const (
	typeCleanupSessions   = "cron:cleanup_sessions"
	typeReapZombies       = "cron:reap_zombies"
	typeSyncPromptSources = "cron:sync_prompt_sources"

	zombieRunningMinutes = 30
	staleQueuedMinutes   = 10
)

type Worker struct {
	Cfg        *config.Config
	St         *store.Store
	Storage    *storage.Storage
	C2A        *c2a.Client
	Queue      *taskflow.Queue
	PromptSync *promptsync.Engine
}

func New(cfg *config.Config, st *store.Store, stg *storage.Storage, c2aClient *c2a.Client, queue *taskflow.Queue) *Worker {
	return &Worker{Cfg: cfg, St: st, Storage: stg, C2A: c2aClient, Queue: queue, PromptSync: promptsync.New(st, cfg.AppEnv == "development")}
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
	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: w.Cfg.WorkerConcurrency,
	})
	mux := asynq.NewServeMux()
	mux.HandleFunc(taskflow.TypeRunTask, w.handleRunTask)
	mux.HandleFunc(typeCleanupSessions, w.handleCleanupSessions)
	mux.HandleFunc(typeReapZombies, w.handleReapZombies)
	mux.HandleFunc(typeSyncPromptSources, w.handleSyncPromptSources)

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
	}, nil
}

// claimTask 条件更新 queued→running，抢不到返回 nil。
func (w *Worker) claimTask(ctx context.Context, taskID uuid.UUID) (*store.Task, error) {
	claimed, err := store.ClaimTask(ctx, w.St.Pool, taskID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if !claimed {
		return nil, nil
	}
	return store.GetTask(ctx, w.St.Pool, taskID)
}

func (w *Worker) loadInputImagesB64(ctx context.Context, inputKeys []string) ([]string, error) {
	images := make([]string, 0, len(inputKeys))
	for _, key := range inputKeys {
		data, err := w.Storage.GetBytes(ctx, key)
		if err != nil {
			return nil, err
		}
		images = append(images, base64.StdEncoding.EncodeToString(data))
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

func (w *Worker) callUpstream(ctx context.Context, task *store.Task, model string) ([]string, error) {
	client := w.upstreamClient(ctx)
	finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
	if len(task.InputKeys) > 0 {
		inputs, err := w.loadInputImagesB64(ctx, task.InputKeys)
		if err != nil {
			return nil, err
		}
		return client.EditImagesWithID(ctx, task.ID.String(), finalPrompt, model, task.Count, inputs, size)
	}
	return client.GenerateImagesWithID(ctx, task.ID.String(), finalPrompt, model, task.Count, size)
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
	}
	return err
}

// urlPattern H1 脱敏：过滤上游错误文案中的 URL，避免泄漏内部地址。
var urlPattern = regexp.MustCompile(`https?://\S+`)

// sanitizeUpstreamMessage 保留上游业务错误 message，但去掉其中的 URL。
func sanitizeUpstreamMessage(msg string) string {
	cleaned := strings.TrimSpace(urlPattern.ReplaceAllString(msg, ""))
	cleaned = strings.Join(strings.Fields(cleaned), " ")
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

	task, err := w.claimTask(ctx, taskID)
	if err != nil {
		return err
	}
	if task == nil {
		log.Printf("task %s not claimable, skip", taskID)
		return nil
	}

	// 模型在任务创建时已经快照，避免排队期间后台配置变化导致展示值与实际执行值不一致。
	model := strings.TrimSpace(task.Model)
	if model == "" {
		model, err = settings.TaskModel(ctx, w.St.Pool, task.Type)
		if err != nil {
			return err
		}
		if err := store.SetTaskModel(ctx, w.St.Pool, task.ID, model); err != nil {
			return err
		}
		task.Model = model
	}

	errorCode, errorMessage := "internal_error", "未知错误"
	var imagesB64 []string
	imagesB64, callErr := w.callUpstream(ctx, task, model)
	var netErr *c2a.NetworkError
	if callErr != nil && errors.As(callErr, &netErr) {
		// 连接/超时类错误重试一次（attempt+1 落库）
		log.Printf("task %s network error, retrying once: %v", taskID, callErr)
		if berr := store.BumpTaskAttempt(ctx, w.St.Pool, taskID); berr != nil {
			log.Printf("task %s bump attempt failed: %v", taskID, berr)
		}
		imagesB64, callErr = w.callUpstream(ctx, task, model)
	}
	if callErr != nil {
		// H1：error_message 只落用户可读文案，原始错误进日志（带 task_id）
		var upErr *c2a.UpstreamError
		switch {
		case errors.As(callErr, &netErr):
			errorCode, errorMessage = "upstream_unreachable", "生成服务暂时不可用，请稍后重试"
		case errors.As(callErr, &upErr):
			errorCode, errorMessage = "upstream_error", sanitizeUpstreamMessage(upErr.Message)
		default:
			errorCode, errorMessage = "internal_error", "任务执行失败，请稍后重试"
		}
		log.Printf("task %s upstream call failed (%s): %v", taskID, errorCode, callErr)
		imagesB64 = nil
	}

	if imagesB64 != nil {
		var succeeded *store.Task
		outputCount := 0
		var uploadedKeys []string
		storeErr := func() error {
			outputKeys := make([]string, 0, len(imagesB64))
			thumbnailKeys := make([]string, 0, len(imagesB64))
			for i, b64 := range imagesB64 {
				data, derr := base64.StdEncoding.DecodeString(b64)
				if derr != nil {
					return derr
				}
				if len(data) == 0 || len(data) > 20<<20 {
					return fmt.Errorf("output image exceeds 20 MiB limit")
				}
				ext, contentType := media.Detect(data)
				if ext == "" {
					return fmt.Errorf("upstream returned unsupported image data")
				}
				thumb, terr := media.ThumbnailJPEG(data, 512)
				if terr != nil {
					return terr
				}
				key := fmt.Sprintf("tasks/%s/%s/original/%d.%s", task.UserID, task.ID, i, ext)
				thumbKey := fmt.Sprintf("tasks/%s/%s/thumb/%d.jpg", task.UserID, task.ID, i)
				if uerr := w.Storage.UploadBytes(ctx, key, data, contentType); uerr != nil {
					return uerr
				}
				uploadedKeys = append(uploadedKeys, key)
				if uerr := w.Storage.UploadBytes(ctx, thumbKey, thumb, "image/jpeg"); uerr != nil {
					return uerr
				}
				uploadedKeys = append(uploadedKeys, thumbKey)
				outputKeys = append(outputKeys, key)
				thumbnailKeys = append(thumbnailKeys, thumbKey)
			}
			outputCount = len(outputKeys)
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
				taskflow.NotifyTaskSucceeded(ctx, w.St.Pool, succeeded, outputCount)
			}
			return nil
		}
		if len(uploadedKeys) > 0 {
			_ = w.Storage.DeleteKeys(ctx, uploadedKeys)
		}
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

// reapStaleQueued C1 第二种扫描：queued 超时的任务补一次入队（Asynq 同 task_id
// 重复入队无害），入队仍失败则 failed + release。
func (w *Worker) reapStaleQueued(ctx context.Context) error {
	threshold := time.Now().UTC().Add(-staleQueuedMinutes * time.Minute)
	staleIDs, err := store.ListStaleQueuedTaskIDs(ctx, w.St.Pool, threshold)
	if err != nil {
		return err
	}
	for _, taskID := range staleIDs {
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
