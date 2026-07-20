package taskflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

const TypeRunTask = "task:run"

type RunTaskPayload struct {
	TaskID string `json:"task_id"`
}

// Queue 封装 Asynq 客户端入队 run_task。
type Queue struct {
	client  *asynq.Client
	timeout time.Duration
}

// NewQueue timeoutSecs 为任务执行超时（上游超时×2 + 上传余量）。
func NewQueue(redisURL string, c2aTimeoutSecs int) (*Queue, error) {
	opt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	return &Queue{
		client:  asynq.NewClient(opt),
		timeout: time.Duration(c2aTimeoutSecs*2+120) * time.Second,
	}, nil
}

func (q *Queue) Close() error { return q.client.Close() }

// Ping 检查 Redis 连通性（健康检查用）。
func (q *Queue) Ping() error { return q.client.Ping() }

// EnqueueRunTask payload 只放 task_id；MaxRetry=0，业务层自控重试。
// asynq.TaskID 固定为任务 uuid：同一任务重复入队返回 TaskIDConflict，
// 视为幂等成功（队列里已有一份待执行副本），补偿入队/幂等重试因此无害。
func (q *Queue) EnqueueRunTask(ctx context.Context, taskID string) error {
	payload, err := json.Marshal(RunTaskPayload{TaskID: taskID})
	if err != nil {
		return err
	}
	_, err = q.client.EnqueueContext(ctx, asynq.NewTask(TypeRunTask, payload),
		asynq.MaxRetry(0), asynq.Timeout(q.timeout), asynq.TaskID(taskID))
	if errors.Is(err, asynq.ErrTaskIDConflict) {
		return nil
	}
	return err
}
