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

const (
	TypeRunTask      = "task:run"
	TypeRunAssistant = "assistant:run"
)

// 后台允许把 C2A 超时动态调到 600 秒。队列超时必须覆盖这个上限，
// 否则后台调大上游超时后，Asynq 仍会按启动时的较小默认值提前取消任务。
const maxC2ATimeoutSecs = 600

type RunTaskPayload struct {
	TaskID string `json:"task_id"`
}

type RunAssistantPayload struct {
	RunID string `json:"run_id"`
}

// Queue 封装 Asynq 客户端入队 run_task。
type Queue struct {
	client    *asynq.Client
	inspector *asynq.Inspector
	timeout   time.Duration
}

type WorkerMetrics struct {
	ID          string         `json:"id"`
	Host        string         `json:"host"`
	PID         int            `json:"pid"`
	Concurrency int            `json:"concurrency"`
	Active      int            `json:"active"`
	Status      string         `json:"status"`
	StartedAt   time.Time      `json:"startedAt"`
	Queues      map[string]int `json:"queues"`
}

type QueueMetrics struct {
	Available         bool            `json:"available"`
	Paused            bool            `json:"paused"`
	LatencyMs         int64           `json:"latencyMs"`
	MemoryBytes       int64           `json:"memoryBytes"`
	Size              int             `json:"size"`
	Pending           int             `json:"pending"`
	Active            int             `json:"active"`
	Scheduled         int             `json:"scheduled"`
	Retry             int             `json:"retry"`
	Archived          int             `json:"archived"`
	ProcessedToday    int             `json:"processedToday"`
	FailedToday       int             `json:"failedToday"`
	OnlineWorkers     int             `json:"onlineWorkers"`
	WorkerConcurrency int             `json:"workerConcurrency"`
	ActiveWorkers     int             `json:"activeWorkers"`
	Workers           []WorkerMetrics `json:"workers"`
	Error             string          `json:"error,omitempty"`
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
		client:    asynq.NewClient(opt),
		inspector: asynq.NewInspector(opt),
		timeout:   time.Duration(c2aTimeoutSecs*2+120) * time.Second,
	}, nil
}

func (q *Queue) Close() error {
	clientErr := q.client.Close()
	inspectorErr := q.inspector.Close()
	if clientErr != nil {
		return clientErr
	}
	return inspectorErr
}

// Ping 检查 Redis 连通性（健康检查用）。
func (q *Queue) Ping() error { return q.client.Ping() }

// Metrics returns a lightweight Redis-backed queue and worker heartbeat
// snapshot for the authenticated operations dashboard.
func (q *Queue) Metrics() QueueMetrics {
	out := QueueMetrics{Workers: []WorkerMetrics{}}
	if q == nil || q.inspector == nil {
		out.Error = "queue_unavailable"
		return out
	}
	info, err := q.inspector.GetQueueInfo("default")
	if errors.Is(err, asynq.ErrQueueNotFound) {
		out.Available = true
	} else if err != nil {
		out.Error = "queue_unavailable"
		return out
	} else {
		out.Available = true
		out.Paused = info.Paused
		out.LatencyMs = info.Latency.Milliseconds()
		out.MemoryBytes = info.MemoryUsage
		out.Size = info.Size
		out.Pending = info.Pending
		out.Active = info.Active
		out.Scheduled = info.Scheduled
		out.Retry = info.Retry
		out.Archived = info.Archived
		out.ProcessedToday = info.Processed
		out.FailedToday = info.Failed
	}

	servers, err := q.inspector.Servers()
	if err != nil {
		out.Error = "worker_heartbeat_unavailable"
		return out
	}
	for _, server := range servers {
		if server == nil {
			continue
		}
		worker := WorkerMetrics{
			ID: server.ID, Host: server.Host, PID: server.PID,
			Concurrency: server.Concurrency, Active: len(server.ActiveWorkers),
			Status: server.Status, StartedAt: server.Started, Queues: server.Queues,
		}
		out.Workers = append(out.Workers, worker)
		out.OnlineWorkers++
		out.WorkerConcurrency += server.Concurrency
		out.ActiveWorkers += len(server.ActiveWorkers)
	}
	return out
}

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

func (q *Queue) EnqueueRunTaskRecoveryIn(ctx context.Context, taskID string, delay time.Duration) error {
	payload, err := json.Marshal(RunTaskPayload{TaskID: taskID})
	if err != nil {
		return err
	}
	_, err = q.client.EnqueueContext(ctx, asynq.NewTask(TypeRunTask, payload),
		asynq.MaxRetry(0), asynq.Timeout(q.timeout), asynq.ProcessIn(delay),
		asynq.TaskID(taskID+":recover:"+uuid.NewString()))
	return err
}

// QueuedRunTaskIDs scans executable queue records once and returns their
// business task IDs. Recovery queue records use unique Asynq IDs, so checking
// only the original queue ID would miss them and create duplicate recoveries.
func (q *Queue) QueuedRunTaskIDs() (map[string]struct{}, error) {
	queued := make(map[string]struct{})
	listers := []func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error){
		q.inspector.ListActiveTasks,
		q.inspector.ListPendingTasks,
		q.inspector.ListScheduledTasks,
		q.inspector.ListRetryTasks,
	}
	const pageSize = 1000
	for _, list := range listers {
		for page := 1; ; page++ {
			infos, err := list("default", asynq.Page(page), asynq.PageSize(pageSize))
			if errors.Is(err, asynq.ErrQueueNotFound) {
				return queued, nil
			}
			if err != nil {
				return nil, err
			}
			for _, info := range infos {
				if info == nil || info.Type != TypeRunTask {
					continue
				}
				var payload RunTaskPayload
				if json.Unmarshal(info.Payload, &payload) == nil && payload.TaskID != "" {
					queued[payload.TaskID] = struct{}{}
				}
			}
			if len(infos) < pageSize {
				break
			}
		}
	}
	return queued, nil
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

func (q *Queue) EnqueueAssistantRun(ctx context.Context, runID string) error {
	return q.enqueueAssistantRun(ctx, runID, runID)
}

func (q *Queue) EnqueueAssistantRunRecovery(ctx context.Context, runID string) error {
	return q.enqueueAssistantRun(ctx, runID, runID+":recover:"+uuid.NewString())
}

func (q *Queue) enqueueAssistantRun(ctx context.Context, runID, queueTaskID string) error {
	payload, err := json.Marshal(RunAssistantPayload{RunID: runID})
	if err != nil {
		return err
	}
	_, err = q.client.EnqueueContext(ctx, asynq.NewTask(TypeRunAssistant, payload),
		asynq.MaxRetry(0), asynq.Timeout(q.timeout), asynq.TaskID(queueTaskID))
	if errors.Is(err, asynq.ErrTaskIDConflict) {
		return nil
	}
	return err
}

// CancelAssistantRun interrupts an active worker task and removes a pending copy.
// Either operation may report that the task is not in that state, which is harmless.
func (q *Queue) CancelAssistantRun(runID string) {
	_ = q.inspector.CancelProcessing(runID)
	_ = q.inspector.DeleteTask("default", runID)
	// 恢复任务使用唯一的 Asynq TaskID（runID:recover:*）。按载荷补充查找，
	// 否则 Worker 重启后的图片请求只能改数据库状态，无法立刻取消上下文。
	for _, list := range []func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error){
		q.inspector.ListActiveTasks,
		q.inspector.ListPendingTasks,
	} {
		tasks, err := list("default", asynq.PageSize(100))
		if err != nil {
			continue
		}
		for _, task := range tasks {
			if task == nil || task.Type != TypeRunAssistant || task.ID == runID {
				continue
			}
			var payload RunAssistantPayload
			if json.Unmarshal(task.Payload, &payload) != nil || payload.RunID != runID {
				continue
			}
			_ = q.inspector.CancelProcessing(task.ID)
			_ = q.inspector.DeleteTask(task.Queue, task.ID)
		}
	}
}
