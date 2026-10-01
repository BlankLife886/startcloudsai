package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// TaskTimelineEvent 任务执行时间线上的一条事件（后台耗时详情用）。
type TaskTimelineEvent struct {
	ID         int64          `json:"id"`
	TaskID     uuid.UUID      `json:"taskId"`
	Stage      string         `json:"stage"`
	Status     string         `json:"status"`
	Message    string         `json:"message"`
	DurationMs *int64         `json:"durationMs"`
	Meta       map[string]any `json:"meta"`
	CreatedAt  time.Time      `json:"createdAt"`
}

// AppendTaskTimelineEvent 追加一条时间线事件。durationMs < 0 表示该事件没有时长。
func AppendTaskTimelineEvent(ctx context.Context, q Q, taskID uuid.UUID, stage, status, message string, durationMs int64, meta map[string]any) error {
	var duration *int64
	if durationMs >= 0 {
		duration = &durationMs
	}
	if meta == nil {
		meta = map[string]any{}
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		metaJSON = []byte(`{}`)
	}
	_, err = q.Exec(ctx,
		`INSERT INTO task_timeline_events (task_id, stage, status, message, duration_ms, meta)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		taskID, stage, status, message, duration, metaJSON)
	return err
}

// ListTaskTimeline 按发生顺序返回任务的全部时间线事件。
func ListTaskTimeline(ctx context.Context, q Q, taskID uuid.UUID) ([]*TaskTimelineEvent, error) {
	rows, err := q.Query(ctx,
		`SELECT id, task_id, stage, status, message, duration_ms, meta, created_at
		   FROM task_timeline_events
		  WHERE task_id = $1
		  ORDER BY id`,
		taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []*TaskTimelineEvent{}
	for rows.Next() {
		event := &TaskTimelineEvent{}
		var metaJSON []byte
		if err := rows.Scan(&event.ID, &event.TaskID, &event.Stage, &event.Status,
			&event.Message, &event.DurationMs, &metaJSON, &event.CreatedAt); err != nil {
			return nil, err
		}
		event.Meta = map[string]any{}
		if len(metaJSON) > 0 {
			_ = json.Unmarshal(metaJSON, &event.Meta)
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// DeleteTaskTimelineEventsBefore 删除保留期之前的时间线事件（cron 清理用）。
func DeleteTaskTimelineEventsBefore(ctx context.Context, q Q, cutoff time.Time) (int64, error) {
	tag, err := q.Exec(ctx,
		`DELETE FROM task_timeline_events WHERE created_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
