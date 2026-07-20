// Package worker 实现 Asynq handler：run_task + 定时任务（session 清理、僵尸回收）。
package worker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
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
)

type Worker struct {
	Cfg        *config.Config
	St         *store.Store
	Storage    *storage.Storage
	C2A        *c2a.Client
	PromptSync *promptsync.Engine
}

func New(cfg *config.Config, st *store.Store, stg *storage.Storage, c2aClient *c2a.Client) *Worker {
	return &Worker{Cfg: cfg, St: st, Storage: stg, C2A: c2aClient, PromptSync: promptsync.New(st)}
}

// Run 启动 Asynq server + PeriodicTaskManager，阻塞运行。
func (w *Worker) Run() error {
	redisOpt, err := asynq.ParseRedisURI(w.Cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("parse redis url: %w", err)
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
		ctx, w.St.Pool, w.Cfg.C2ABaseURL, w.Cfg.C2AAPIKey, w.Cfg.C2ATimeoutSecs,
	)
	if err != nil {
		// 配置读取失败时退回启动时的客户端，任务仍可执行
		return w.C2A
	}
	return c2a.New(resolved.BaseURL, resolved.APIKey, resolved.TimeoutSecs)
}

func (w *Worker) callUpstream(ctx context.Context, task *store.Task, model string) ([]string, error) {
	client := w.upstreamClient(ctx)
	finalPrompt, size := prompt.Compile(task.Type, task.Prompt, task.Params)
	if len(task.InputKeys) > 0 {
		inputs, err := w.loadInputImagesB64(ctx, task.InputKeys)
		if err != nil {
			return nil, err
		}
		return client.EditImages(ctx, finalPrompt, model, task.Count, inputs, size)
	}
	return client.GenerateImages(ctx, finalPrompt, model, task.Count, size)
}

func (w *Worker) markFailed(ctx context.Context, taskID uuid.UUID, errorCode, errorMessage string) error {
	return w.St.Tx(ctx, func(tx pgx.Tx) error {
		task, err := store.GetTask(ctx, tx, taskID)
		if err != nil || task == nil {
			return err
		}
		_, err = taskflow.MarkFailed(ctx, tx, task, errorCode, errorMessage, "running")
		return err
	})
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

	model, err := settings.TaskModel(ctx, w.St.Pool, task.Type)
	if err != nil {
		return err
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
		var upErr *c2a.UpstreamError
		switch {
		case errors.As(callErr, &netErr):
			errorCode, errorMessage = "upstream_unreachable", callErr.Error()
		case errors.As(callErr, &upErr):
			errorCode, errorMessage = "upstream_error", callErr.Error()
		default:
			log.Printf("task %s unexpected error: %v", taskID, callErr)
			errorCode, errorMessage = "internal_error", callErr.Error()
		}
		imagesB64 = nil
	}

	if imagesB64 != nil {
		storeErr := func() error {
			outputKeys := make([]string, 0, len(imagesB64))
			for i, b64 := range imagesB64 {
				data, derr := base64.StdEncoding.DecodeString(b64)
				if derr != nil {
					return derr
				}
				key := fmt.Sprintf("tasks/%s/%s/%d.png", task.UserID, task.ID, i)
				if uerr := w.Storage.UploadBytes(ctx, key, data, "image/png"); uerr != nil {
					return uerr
				}
				outputKeys = append(outputKeys, key)
			}
			return w.St.Tx(ctx, func(tx pgx.Tx) error {
				dbTask, gerr := store.GetTask(ctx, tx, taskID)
				if gerr != nil || dbTask == nil {
					return gerr
				}
				_, merr := taskflow.MarkSucceeded(ctx, tx, dbTask, outputKeys, time.Now().UTC())
				return merr
			})
		}()
		if storeErr == nil {
			return nil
		}
		log.Printf("task %s failed to store outputs: %v", taskID, storeErr)
		errorCode, errorMessage = "storage_error", storeErr.Error()
	}

	return w.markFailed(ctx, taskID, errorCode, errorMessage)
}

// handleCleanupSessions cron：每小时清理过期 session。
func (w *Worker) handleCleanupSessions(ctx context.Context, _ *asynq.Task) error {
	n, err := store.DeleteExpiredSessions(ctx, w.St.Pool, time.Now().UTC())
	if err != nil {
		return err
	}
	if n > 0 {
		log.Printf("cleaned %d expired sessions", n)
	}
	return nil
}

// handleSyncPromptSources cron：每 30 分钟扫描到期的提示词数据源并同步。
func (w *Worker) handleSyncPromptSources(ctx context.Context, _ *asynq.Task) error {
	return w.PromptSync.SyncDue(ctx)
}

// handleReapZombies cron：每 10 分钟把 running 超过 30 分钟的任务判为 failed 并 release。
func (w *Worker) handleReapZombies(ctx context.Context, _ *asynq.Task) error {
	threshold := time.Now().UTC().Add(-zombieRunningMinutes * time.Minute)
	zombieIDs, err := store.ListZombieTaskIDs(ctx, w.St.Pool, threshold)
	if err != nil {
		return err
	}
	for _, taskID := range zombieIDs {
		err := w.St.Tx(ctx, func(tx pgx.Tx) error {
			task, gerr := store.GetTask(ctx, tx, taskID)
			if gerr != nil || task == nil || task.StartedAt == nil {
				return gerr
			}
			won, merr := taskflow.MarkFailed(ctx, tx, task, "timeout", "任务执行超时，已自动回收", "running")
			if merr != nil {
				return merr
			}
			if won {
				log.Printf("reaped zombie task %s", taskID)
			}
			return nil
		})
		if err != nil {
			log.Printf("failed to reap zombie task %s: %v", taskID, err)
		}
	}
	return nil
}
