// Package taskflow 实现任务提交 / 取消 / 重跑 / 结算落库与 Asynq 入队。
package taskflow

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func now() time.Time { return time.Now().UTC() }

func strPtr(s string) *string { return &s }

type CreateInput struct {
	Type           string
	Prompt         string
	Params         map[string]any
	InputKeys      []string
	Count          int
	IdempotencyKey *string
}

// CreateTask 校验 + 冻结 + 建任务（单事务）。返回 (task, created)。
func CreateTask(ctx context.Context, st *store.Store, userID uuid.UUID, in CreateInput) (*store.Task, bool, error) {
	if !store.Contains(store.TaskTypes, in.Type) {
		return nil, false, apperr.E("validation_error", "不支持的任务类型", 422)
	}
	if in.Count < 1 || in.Count > 4 {
		return nil, false, apperr.E("validation_error", "count 须在 1-4 之间", 422)
	}

	var task *store.Task
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if in.IdempotencyKey != nil && *in.IdempotencyKey != "" {
			existing, err := store.GetTaskByIdemKey(ctx, tx, userID, *in.IdempotencyKey)
			if err != nil {
				return err
			}
			if existing != nil {
				task = existing
				return nil
			}
		}

		maxRunning, err := settings.GetInt(ctx, tx, "user_max_running_tasks")
		if err != nil {
			return err
		}
		if maxRunning <= 0 {
			maxRunning = 3
		}
		activeCount, err := store.CountActiveTasks(ctx, tx, userID)
		if err != nil {
			return err
		}
		if activeCount >= maxRunning {
			return apperr.E("user_task_limit", fmt.Sprintf("同时进行中的任务不能超过 %d 个", maxRunning), 429)
		}

		unitPrice, err := settings.TaskPriceCents(ctx, tx, in.Type)
		if err != nil {
			return err
		}
		costCents := unitPrice * int64(in.Count)

		taskID := uuid.New()
		task, err = store.InsertTask(ctx, tx, store.NewTask{
			ID:             taskID,
			UserID:         userID,
			Type:           in.Type,
			Prompt:         in.Prompt,
			Params:         in.Params,
			Count:          in.Count,
			InputKeys:      in.InputKeys,
			CostCents:      costCents,
			IdempotencyKey: in.IdempotencyKey,
		})
		if err != nil {
			return err
		}
		if costCents > 0 {
			_, err = wallet.FreezeForTask(ctx, tx, userID, taskID, costCents,
				strPtr(fmt.Sprintf("任务冻结（%s×%d）", in.Type, in.Count)))
			if err != nil {
				return err
			}
		}
		created = true
		return nil
	})
	if err != nil {
		// 幂等键并发竞态：唯一约束冲突时重放读取已有任务
		if store.IsUniqueViolation(err, "uq_tasks_user_idem") && in.IdempotencyKey != nil {
			existing, gerr := store.GetTaskByIdemKey(ctx, st.Pool, userID, *in.IdempotencyKey)
			if gerr == nil && existing != nil {
				return existing, false, nil
			}
		}
		return nil, false, err
	}
	return task, created, nil
}

// CancelTask 仅 queued 可取消：条件更新 + release，单事务。
func CancelTask(ctx context.Context, st *store.Store, userID, taskID uuid.UUID) (*store.Task, error) {
	var task *store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetUserTask(ctx, tx, userID, taskID)
		if err != nil {
			return err
		}
		if t == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		ok, err := store.CancelTask(ctx, tx, taskID, now())
		if err != nil {
			return err
		}
		if !ok {
			return apperr.E("task_not_cancelable", "仅排队中的任务可以取消", 400)
		}
		if t.CostCents > 0 {
			if _, err := wallet.ReleaseForTask(ctx, tx, userID, taskID, t.CostCents, strPtr("任务取消解冻")); err != nil {
				return err
			}
		}
		task, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return task, err
}

// MarkSucceeded running→succeeded + settle + 通知，同事务。返回是否抢到状态迁移。
func MarkSucceeded(ctx context.Context, q store.Q, task *store.Task, outputKeys []string, finishedAt time.Time) (bool, error) {
	ok, err := store.MarkTaskSucceeded(ctx, q, task.ID, outputKeys, finishedAt)
	if err != nil || !ok {
		return false, err
	}
	if task.CostCents > 0 {
		if _, err := wallet.SettleForTask(ctx, q, task.UserID, task.ID, task.CostCents, nil); err != nil {
			return false, err
		}
	}
	body := fmt.Sprintf("你的「%s」任务已生成 %d 张图片。", task.Type, len(outputKeys))
	if err := store.InsertNotification(ctx, q, &task.UserID, "task", "任务已完成", &body); err != nil {
		return false, err
	}
	return true, nil
}

// MarkFailed fromStatus→failed + release + 通知，同事务。返回是否抢到状态迁移。
func MarkFailed(ctx context.Context, q store.Q, task *store.Task, errorCode, errorMessage, fromStatus string) (bool, error) {
	msg := []rune(errorMessage)
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	ok, err := store.MarkTaskFailed(ctx, q, task.ID, fromStatus, errorCode, string(msg), now())
	if err != nil || !ok {
		return false, err
	}
	if task.CostCents > 0 {
		if _, err := wallet.ReleaseForTask(ctx, q, task.UserID, task.ID, task.CostCents, strPtr("任务失败解冻")); err != nil {
			return false, err
		}
	}
	body := fmt.Sprintf("你的「%s」任务执行失败，费用已退回。", task.Type)
	if err := store.InsertNotification(ctx, q, &task.UserID, "task", "任务失败", &body); err != nil {
		return false, err
	}
	return true, nil
}

// RequeueTask 后台重跑失败任务：failed→queued，重新冻结（失败时已解冻），不重复扣费。
func RequeueTask(ctx context.Context, st *store.Store, taskID uuid.UUID) (*store.Task, error) {
	var task *store.Task
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		t, err := store.GetTask(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if t == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		ok, err := store.RequeueTask(ctx, tx, taskID)
		if err != nil {
			return err
		}
		if !ok {
			return apperr.E("task_not_cancelable", "仅失败任务可以重新入队", 400)
		}
		if t.CostCents > 0 {
			if _, err := wallet.FreezeForTask(ctx, tx, t.UserID, taskID, t.CostCents, strPtr("任务重跑冻结")); err != nil {
				return err
			}
		}
		task, err = store.GetTask(ctx, tx, taskID)
		return err
	})
	return task, err
}
