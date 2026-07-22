package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const taskCols = `id, user_id, type, model, status, prompt, params, count, input_keys, output_keys, thumbnail_keys, cost_cents,
	idempotency_key, error_code, error_message, attempt, started_at, finished_at, created_at`

func scanTask(row pgx.Row) (*Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.UserID, &t.Type, &t.Model, &t.Status, &t.Prompt, &t.Params, &t.Count, &t.InputKeys, &t.OutputKeys, &t.ThumbnailKeys,
		&t.CostCents, &t.IdempotencyKey, &t.ErrorCode, &t.ErrorMessage, &t.Attempt, &t.StartedAt, &t.FinishedAt, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

type NewTask struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Type           string
	Model          string
	Prompt         string
	Params         map[string]any
	Count          int
	InputKeys      []string
	CostCents      int64
	IdempotencyKey *string
}

func InsertTask(ctx context.Context, q Q, n NewTask) (*Task, error) {
	if n.Params == nil {
		n.Params = map[string]any{}
	}
	if n.InputKeys == nil {
		n.InputKeys = []string{}
	}
	return scanTask(q.QueryRow(ctx,
		`INSERT INTO tasks (id, user_id, type, model, prompt, params, count, input_keys, output_keys, cost_cents, idempotency_key)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9, $10) RETURNING `+taskCols,
		n.ID, n.UserID, n.Type, n.Model, n.Prompt, n.Params, n.Count, n.InputKeys, n.CostCents, n.IdempotencyKey))
}

func GetTask(ctx context.Context, q Q, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = $1`, id))
	return nilOnNoRows(t, err)
}

func GetUserTask(ctx context.Context, q Q, userID, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(t, err)
}

func GetTaskByIdemKey(ctx context.Context, q Q, userID uuid.UUID, key string) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx,
		`SELECT `+taskCols+` FROM tasks WHERE user_id = $1 AND idempotency_key = $2`, userID, key))
	return nilOnNoRows(t, err)
}

func CountActiveTasks(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM tasks WHERE user_id = $1 AND status IN ('queued', 'running')`, userID).Scan(&n)
	return n, err
}

func CountTasksInStatuses(ctx context.Context, q Q, statuses []string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE status = ANY($1)`, statuses).Scan(&n)
	return n, err
}

// ListTasks 任务分页（limit+1 行）。userID 为 nil 时查全站（后台）。
func ListTasks(ctx context.Context, q Q, userID *uuid.UUID, taskType, status string, userIDs []uuid.UUID, limit int, cursor *Cursor) ([]*Task, error) {
	sql := `SELECT ` + taskCols + ` FROM tasks WHERE true`
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
	}
	if taskType != "" {
		args = append(args, taskType)
		sql += fmt.Sprintf(` AND type = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	if userIDs != nil {
		args = append(args, userIDs)
		sql += fmt.Sprintf(` AND user_id = ANY($%d)`, len(args))
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListRecentTasks 用户最近 n 条任务。
func ListRecentTasks(ctx context.Context, q Q, userID uuid.UUID, n int) ([]*Task, error) {
	rows, err := q.Query(ctx,
		`SELECT `+taskCols+` FROM tasks WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, userID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TaskCountsBy 按 status / type 聚合当前用户任务数。
func TaskCountsBy(ctx context.Context, q Q, userID uuid.UUID, column string) (map[string]int64, error) {
	if column != "status" && column != "type" {
		return nil, fmt.Errorf("unsupported group column %q", column)
	}
	rows, err := q.Query(ctx,
		`SELECT `+column+`, count(*) FROM tasks WHERE user_id = $1 GROUP BY `+column, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var n int64
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}

// TaskDailyRow 每日任务量（UTC 日期）。
type TaskDailyRow struct {
	Date      string
	Total     int64
	Succeeded int64
}

func TaskDailySince(ctx context.Context, q Q, since time.Time) (map[string]TaskDailyRow, error) {
	rows, err := q.Query(ctx,
		`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
		        count(*),
		        count(*) FILTER (WHERE status = 'succeeded')
		 FROM tasks WHERE created_at >= $1 GROUP BY day`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]TaskDailyRow{}
	for rows.Next() {
		var r TaskDailyRow
		if err := rows.Scan(&r.Date, &r.Total, &r.Succeeded); err != nil {
			return nil, err
		}
		out[r.Date] = r
	}
	return out, rows.Err()
}

// TaskTypeCountsSince 近 N 日全站任务量按类型聚合。
func TaskTypeCountsSince(ctx context.Context, q Q, since time.Time) (map[string]int64, error) {
	rows, err := q.Query(ctx,
		`SELECT type, count(*) FROM tasks WHERE created_at >= $1 GROUP BY type`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var n int64
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}

// --- 状态机条件更新（返回是否抢到迁移） ---

func ClaimTask(ctx context.Context, q Q, id uuid.UUID, startedAt time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'running', started_at = $2 WHERE id = $1 AND status = 'queued'`, id, startedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetTaskModel records the model actually selected for an already claimed legacy task.
func SetTaskModel(ctx context.Context, q Q, id uuid.UUID, model string) error {
	_, err := q.Exec(ctx,
		`UPDATE tasks SET model = $2 WHERE id = $1 AND status = 'running' AND model = ''`, id, model)
	return err
}

func CancelTask(ctx context.Context, q Q, id uuid.UUID, finishedAt time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'canceled', finished_at = $2 WHERE id = $1 AND status = 'queued'`, id, finishedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func MarkTaskSucceeded(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, finishedAt time.Time) (bool, error) {
	if outputKeys == nil {
		outputKeys = []string{}
	}
	if thumbnailKeys == nil {
		thumbnailKeys = []string{}
	}
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'succeeded', output_keys = $2, thumbnail_keys = $3, finished_at = $4, error_code = NULL, error_message = NULL
		 WHERE id = $1 AND status = 'running'`, id, outputKeys, thumbnailKeys, finishedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// LockUserTaskCreation serializes the count-and-insert critical section per user.
func LockUserTaskCreation(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, userID.String())
	return err
}

func MarkTaskFailed(ctx context.Context, q Q, id uuid.UUID, fromStatus, errorCode, errorMessage string, finishedAt time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'failed', error_code = $3, error_message = $4, finished_at = $5
		 WHERE id = $1 AND status = $2`, id, fromStatus, errorCode, errorMessage, finishedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func RequeueTask(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'queued', error_code = NULL, error_message = NULL, started_at = NULL, finished_at = NULL
		 WHERE id = $1 AND status = 'failed'`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// RequeueRunningTask 将失去 Worker 的 running 任务恢复到 queued。任务原有冻结金额
// 保持不变，后续仍以同一个 task ID 查询幂等的上游图片任务。
func RequeueRunningTask(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'queued', started_at = NULL
		 WHERE id = $1 AND status = 'running'`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// RequeueAllRunningTasks is used once when a Worker process starts. A running
// row cannot have a live handler in the newly started process, so it is safe to
// make it claimable again. Upstream submission is idempotent on the task ID.
func RequeueAllRunningTasks(ctx context.Context, q Q) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx,
		`UPDATE tasks SET status = 'queued', started_at = NULL
		 WHERE status = 'running'
		 RETURNING id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func BumpTaskAttempt(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE tasks SET attempt = attempt + 1 WHERE id = $1`, id)
	return err
}

func DeleteTask(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, id)
	return err
}

// ListZombieTaskIDs 找出 running 且 started_at 早于阈值的任务。
func ListZombieTaskIDs(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	return listTaskIDs(ctx, q,
		`SELECT id FROM tasks WHERE status = 'running' AND started_at < $1`, before)
}

// ListStaleQueuedTaskIDs 找出 queued 且 created_at 早于阈值的任务（入队丢失回收）。
func ListStaleQueuedTaskIDs(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	return listTaskIDs(ctx, q,
		`SELECT id FROM tasks WHERE status = 'queued' AND created_at < $1`, before)
}

func listTaskIDs(ctx context.Context, q Q, sql string, args ...any) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
