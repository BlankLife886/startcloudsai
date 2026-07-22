package taskflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
)

const TypeRunTask = "task:run"

// 后台允许把 C2A 超时动态调到 600 秒。队列超时必须覆盖这个上限，
// 否则后台调大上游超时后，Asynq 仍会按启动时的较小默认值提前取消任务。
const maxC2ATimeoutSecs = 600

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
	if c2aTimeoutSecs < maxC2ATimeoutSecs {
		c2aTimeoutSecs = maxC2ATimeoutSecs
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
	return q.enqueueRunTask(ctx, taskID, taskID)
}

// EnqueueRunTaskRecovery creates a fresh queue record for the same database
// task. This is required after the old Asynq record has reached archived or
// completed state: reusing its TaskID would return ErrTaskIDConflict without
// actually placing work back in the pending queue. Database claiming and the
// upstream client_task_id keep the recovery idempotent.
func (q *Queue) EnqueueRunTaskRecovery(ctx context.Context, taskID string) error {
	return q.enqueueRunTask(ctx, taskID, taskID+":recover:"+uuid.NewString())
}

func (q *Queue) enqueueRunTask(ctx context.Context, taskID, queueTaskID string) error {
	payload, err := json.Marshal(RunTaskPayload{TaskID: taskID})
	if err != nil {
		return err
	}
	_, err = q.client.EnqueueContext(ctx, asynq.NewTask(TypeRunTask, payload),
		asynq.MaxRetry(0), asynq.Timeout(q.timeout), asynq.TaskID(queueTaskID))
	if errors.Is(err, asynq.ErrTaskIDConflict) {
		return nil
	}
	return err
}
