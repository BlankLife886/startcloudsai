package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

const (
	incidentTaskQueueDelay     = "task_queue_delay"
	incidentTaskFailureRate    = "task_failure_rate"
	incidentQueueUnavailable   = "queue_unavailable"
	incidentQueuePaused        = "queue_paused"
	incidentQueueSaturation    = "queue_saturation"
	incidentObjectCleanup      = "object_cleanup_backlog"
	incidentFailureWindow      = 10 * time.Minute
	incidentQueueDelayWarning  = 5 * time.Minute
	incidentQueueDelayCritical = 15 * time.Minute
)

var operationalIncidentKeys = []string{
	incidentTaskQueueDelay,
	incidentTaskFailureRate,
	incidentQueueUnavailable,
	incidentQueuePaused,
	incidentQueueSaturation,
	incidentObjectCleanup,
}

func operationalIncidentSignals(
	now time.Time,
	pressure store.TaskPressure,
	performance *store.TaskPerformanceSummary,
	cleanup store.ObjectCleanupHealth,
	queue taskflow.QueueMetrics,
) map[string]store.OperationalIncident {
	out := make(map[string]store.OperationalIncident)
	if pressure.Queued > 0 && pressure.OldestQueuedAt != nil {
		age := now.Sub(*pressure.OldestQueuedAt)
		if age >= incidentQueueDelayWarning {
			severity := "warning"
			if age >= incidentQueueDelayCritical {
				severity = "critical"
			}
			out[incidentTaskQueueDelay] = store.OperationalIncident{
				Key: incidentTaskQueueDelay, Severity: severity, Title: "任务排队时间过长",
				Summary: fmt.Sprintf("%d 个任务正在排队，最早已等待 %s", pressure.Queued, conciseDuration(age)),
				Details: map[string]any{"queued": pressure.Queued, "oldestQueueAgeSeconds": int64(age.Seconds())},
			}
		}
	}
	if performance != nil {
		completed := performance.Succeeded + performance.Failed
		if completed >= 10 && performance.Failed*100 >= completed*30 {
			rate := float64(performance.Failed) * 100 / float64(completed)
			severity := "warning"
			if rate >= 50 {
				severity = "critical"
			}
			out[incidentTaskFailureRate] = store.OperationalIncident{
				Key: incidentTaskFailureRate, Severity: severity, Title: "近期任务失败率偏高",
				Summary: fmt.Sprintf("近 10 分钟完成 %d 个任务，失败 %d 个（%.1f%%）", completed, performance.Failed, rate),
				Details: map[string]any{"completed": completed, "failed": performance.Failed, "failureRate": rate},
			}
		}
	}
	if !queue.Available {
		out[incidentQueueUnavailable] = store.OperationalIncident{
			Key: incidentQueueUnavailable, Severity: "critical", Title: "任务队列不可用",
			Summary: "无法读取 Redis/Asynq 队列状态，请检查队列连接和 Worker",
			Details: map[string]any{"error": queue.Error},
		}
	} else {
		if queue.Paused {
			out[incidentQueuePaused] = store.OperationalIncident{
				Key: incidentQueuePaused, Severity: "critical", Title: "任务队列已暂停",
				Summary: "Asynq 队列处于暂停状态，新任务不会继续执行",
				Details: map[string]any{"pending": queue.Pending},
			}
		}
		threshold := max(32, queue.WorkerConcurrency*4)
		if queue.Pending >= threshold && queue.LatencyMs >= int64((2*time.Minute)/time.Millisecond) {
			out[incidentQueueSaturation] = store.OperationalIncident{
				Key: incidentQueueSaturation, Severity: "warning", Title: "任务队列持续积压",
				Summary: fmt.Sprintf("队列等待 %d 个任务，当前延迟 %s", queue.Pending, conciseDuration(time.Duration(queue.LatencyMs)*time.Millisecond)),
				Details: map[string]any{"pending": queue.Pending, "latencyMs": queue.LatencyMs, "workerConcurrency": queue.WorkerConcurrency},
			}
		}
	}
	if cleanup.Pending >= 500 || (cleanup.Failed > 0 && cleanup.OldestCreated != nil && now.Sub(*cleanup.OldestCreated) >= 15*time.Minute) {
		severity := "warning"
		age := time.Duration(0)
		if cleanup.OldestCreated != nil {
			age = now.Sub(*cleanup.OldestCreated)
		}
		if cleanup.Pending >= 2000 || age >= time.Hour {
			severity = "critical"
		}
		out[incidentObjectCleanup] = store.OperationalIncident{
			Key: incidentObjectCleanup, Severity: severity, Title: "对象清理任务积压",
			Summary: fmt.Sprintf("待清理对象 %d 个，其中 %d 个曾经失败", cleanup.Pending, cleanup.Failed),
			Details: map[string]any{"pending": cleanup.Pending, "failed": cleanup.Failed, "oldestAgeSeconds": int64(age.Seconds())},
		}
	}
	return out
}

func conciseDuration(value time.Duration) string {
	value = max(value, 0)
	if value < time.Minute {
		return fmt.Sprintf("%d 秒", int(value.Seconds()))
	}
	if value < time.Hour {
		return fmt.Sprintf("%d 分钟", int(value.Minutes()))
	}
	return fmt.Sprintf("%d 小时 %d 分钟", int(value.Hours()), int(value.Minutes())%60)
}

func (w *Worker) handleEvaluateOperationalIncidents(ctx context.Context, _ *asynq.Task) error {
	if w.St == nil || w.Queue == nil {
		return nil
	}
	now := time.Now().UTC()
	queue := w.Queue.Metrics()
	return w.St.Tx(ctx, func(tx pgx.Tx) error {
		pressure, err := store.GetTaskPressure(ctx, tx)
		if err != nil {
			return err
		}
		performance, err := store.GetTaskPerformanceSummary(ctx, tx, now.Add(-incidentFailureWindow))
		if err != nil {
			return err
		}
		cleanup, err := store.GetObjectCleanupHealth(ctx, tx)
		if err != nil {
			return err
		}
		signals := operationalIncidentSignals(now, pressure, performance, cleanup, queue)
		for _, key := range operationalIncidentKeys {
			incident, active := signals[key]
			if active {
				if err := store.UpsertOperationalIncident(ctx, tx, incident, now); err != nil {
					return err
				}
				continue
			}
			if err := store.ResolveOperationalIncident(ctx, tx, key, now); err != nil {
				return err
			}
		}
		return nil
	})
}
