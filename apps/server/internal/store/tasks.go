package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
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

func GetTasksByIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*Task, error) {
	out := make(map[uuid.UUID]*Task, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out[task.ID] = task
	}
	return out, rows.Err()
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

type TaskPressure struct {
	Queued          int64
	Running         int64
	OldestQueuedAt  *time.Time
	OldestRunningAt *time.Time
}

func GetTaskPressure(ctx context.Context, q Q) (TaskPressure, error) {
	var out TaskPressure
	err := q.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status = 'queued'),
			count(*) FILTER (WHERE status = 'running'),
			min(created_at) FILTER (WHERE status = 'queued'),
			min(started_at) FILTER (WHERE status = 'running')
		FROM tasks
		WHERE status IN ('queued', 'running')`).Scan(
		&out.Queued, &out.Running, &out.OldestQueuedAt, &out.OldestRunningAt,
	)
	return out, err
}

func CountRunningTasks(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM tasks WHERE user_id = $1 AND status = 'running'`, userID).Scan(&n)
	return n, err
}

func RunningTasksByProvider(ctx context.Context, q Q, providerIDs []string) (map[string]int64, error) {
	out := make(map[string]int64, len(providerIDs))
	if len(providerIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
		SELECT COALESCE(params ->> '_providerRouteKey', params ->> '_providerConfigId'), count(*)
		FROM tasks
		WHERE status = 'running' AND COALESCE(params ->> '_providerRouteKey', params ->> '_providerConfigId') = ANY($1)
		GROUP BY 1`, providerIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var providerID string
		var count int64
		if err := rows.Scan(&providerID, &count); err != nil {
			return nil, err
		}
		out[providerID] = count
	}
	return out, rows.Err()
}

func SetQueuedTaskExecutionRoute(ctx context.Context, q Q, id uuid.UUID, model string, params map[string]any) (bool, error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return false, err
	}
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET model = $2, params = params || $3::jsonb WHERE id = $1 AND status = 'queued'`,
		id, model, raw)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func MarkTaskUpstreamPending(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE tasks
		SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_upstreamStage}', '"async_pending"'::jsonb, true)
		WHERE id = $1 AND status = 'running'`, id)
	return err
}

func SetTaskFailedProviderIDs(ctx context.Context, q Q, id uuid.UUID, providerIDs []string) error {
	raw, err := json.Marshal(providerIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE tasks
		SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_failedProviderConfigIds}', $2::jsonb, true)
		WHERE id = $1 AND status IN ('queued', 'running')`, id, raw)
	return err
}

func ListAsyncPendingTasksByProvider(ctx context.Context, q Q, providerID string, limit int) ([]*Task, error) {
	if limit < 1 {
		limit = 100
	}
	rows, err := q.Query(ctx, `SELECT `+taskCols+` FROM tasks
		WHERE status = 'running'
		  AND params ->> '_upstreamStage' = 'async_pending'
		  AND COALESCE(params ->> '_providerRouteKey', params ->> '_providerConfigId') = $1
		ORDER BY started_at, id
		LIMIT $2`, providerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*Task, 0, limit)
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, task)
	}
	return out, rows.Err()
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

const adminTaskSourceSQL = `
		SELECT id, user_id, type, model, status, prompt, params, count, input_keys,
			output_keys, thumbnail_keys, cost_cents, idempotency_key, error_code,
			error_message, attempt, started_at, finished_at, created_at
		FROM tasks
		UNION ALL
		SELECT run.id, run.user_id, 'assistant'::text AS type,
			COALESCE(run.params->>'model', '') AS model, run.status, run.prompt,
			(run.params - 'referenceImages') || jsonb_build_object(
				'conversationId', run.conversation_id::text,
				'mode', run.mode,
				'resolvedMode', run.resolved_mode,
				'stage', run.stage
			) AS params,
			CASE WHEN COALESCE(run.params->>'count', '') ~ '^[1-4]$'
				THEN (run.params->>'count')::integer ELSE 1 END AS count,
			COALESCE((
				SELECT jsonb_agg(ref->>'fileKey')
				FROM jsonb_array_elements(COALESCE(run.params->'referenceImages', '[]'::jsonb)) ref
				WHERE COALESCE(ref->>'fileKey', '') <> ''
			), '[]'::jsonb) AS input_keys,
			COALESCE((
				SELECT jsonb_agg(image->>'fileKey')
				FROM jsonb_array_elements(COALESCE(message.metadata->'images', '[]'::jsonb)) image
				WHERE COALESCE(image->>'fileKey', '') <> ''
			), '[]'::jsonb) AS output_keys,
			COALESCE((
				SELECT jsonb_agg(image->>'fileKey')
				FROM jsonb_array_elements(COALESCE(message.metadata->'images', '[]'::jsonb)) image
				WHERE COALESCE(image->>'fileKey', '') <> ''
			), '[]'::jsonb) AS thumbnail_keys,
			0::bigint AS cost_cents, NULL::text AS idempotency_key,
			run.error_code, run.error_message, 0::integer AS attempt,
			run.started_at, run.finished_at, run.created_at
		FROM assistant_runs run
		LEFT JOIN assistant_messages message ON message.id = run.assistant_message_id
	`

// ListAdminTasks merges regular generation tasks with AI assistant runs while
// keeping assistant_runs as the single source of truth for assistant state.
func ListAdminTasks(ctx context.Context, q Q, taskType, status, errorCode string, userIDs []uuid.UUID, limit int, cursor *Cursor) ([]*Task, error) {
	sql := `SELECT ` + taskCols + ` FROM (` + adminTaskSourceSQL + `) admin_tasks WHERE true`
	args := []any{}
	if taskType != "" {
		args = append(args, taskType)
		sql += fmt.Sprintf(` AND type = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	if errorCode != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(errorCode))+"%")
		sql += fmt.Sprintf(` AND lower(COALESCE(error_code, '')) LIKE $%d`, len(args))
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
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, task)
	}
	return out, rows.Err()
}

type AdminTaskOverview struct {
	Total     int64 `json:"total"`
	Queued    int64 `json:"queued"`
	Running   int64 `json:"running"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Canceled  int64 `json:"canceled"`
	Today     int64 `json:"today"`
}

// GetAdminTaskOverview returns status totals for the current type/user/error
// scope. Status itself is intentionally excluded so the UI can switch between
// status tabs without losing the surrounding overview.
func GetAdminTaskOverview(ctx context.Context, q Q, taskType, errorCode string, userIDs []uuid.UUID) (*AdminTaskOverview, error) {
	sql := `SELECT
		count(*) AS total,
		count(*) FILTER (WHERE status = 'queued') AS queued,
		count(*) FILTER (WHERE status = 'running') AS running,
		count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
		count(*) FILTER (WHERE status = 'failed') AS failed,
		count(*) FILTER (WHERE status = 'canceled') AS canceled,
		count(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today
		FROM (` + adminTaskSourceSQL + `) admin_tasks WHERE true`
	args := []any{}
	if taskType != "" {
		args = append(args, taskType)
		sql += fmt.Sprintf(` AND type = $%d`, len(args))
	}
	if errorCode != "" {
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(errorCode))+"%")
		sql += fmt.Sprintf(` AND lower(COALESCE(error_code, '')) LIKE $%d`, len(args))
	}
	if userIDs != nil {
		args = append(args, userIDs)
		sql += fmt.Sprintf(` AND user_id = ANY($%d)`, len(args))
	}
	var overview AdminTaskOverview
	err := q.QueryRow(ctx, sql, args...).Scan(
		&overview.Total, &overview.Queued, &overview.Running, &overview.Succeeded,
		&overview.Failed, &overview.Canceled, &overview.Today,
	)
	return &overview, err
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
	Failed    int64
}

func TaskDailySince(ctx context.Context, q Q, since time.Time) (map[string]TaskDailyRow, error) {
	rows, err := q.Query(ctx,
		`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
		        count(*),
		        count(*) FILTER (WHERE status = 'succeeded'),
		        count(*) FILTER (WHERE status = 'failed')
		 FROM tasks WHERE created_at >= $1 GROUP BY day`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]TaskDailyRow{}
	for rows.Next() {
		var r TaskDailyRow
		if err := rows.Scan(&r.Date, &r.Total, &r.Succeeded, &r.Failed); err != nil {
			return nil, err
		}
		out[r.Date] = r
	}
	return out, rows.Err()
}

type TaskPerformanceSummary struct {
	QueuedNow     int64 `json:"queuedNow"`
	RunningNow    int64 `json:"runningNow"`
	Created       int64 `json:"created"`
	Succeeded     int64 `json:"succeeded"`
	Failed        int64 `json:"failed"`
	AvgQueueMs    int64 `json:"avgQueueMs"`
	P95QueueMs    int64 `json:"p95QueueMs"`
	AvgRunMs      int64 `json:"avgRunMs"`
	P95RunMs      int64 `json:"p95RunMs"`
	AvgEndToEndMs int64 `json:"avgEndToEndMs"`
	P95EndToEndMs int64 `json:"p95EndToEndMs"`
}

// GetTaskPerformanceSummary returns operational metrics without loading task rows.
func GetTaskPerformanceSummary(ctx context.Context, q Q, since time.Time) (*TaskPerformanceSummary, error) {
	var summary TaskPerformanceSummary
	err := q.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status = 'queued'),
			count(*) FILTER (WHERE status = 'running'),
			count(*) FILTER (WHERE created_at >= $1),
			count(*) FILTER (WHERE created_at >= $1 AND status = 'succeeded'),
			count(*) FILTER (WHERE created_at >= $1 AND status = 'failed'),
			COALESCE(avg(extract(epoch FROM (started_at - created_at)) * 1000)
				FILTER (WHERE created_at >= $1 AND started_at IS NOT NULL), 0)::bigint,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (
				ORDER BY extract(epoch FROM (started_at - created_at)) * 1000)
				FILTER (WHERE created_at >= $1 AND started_at IS NOT NULL), 0)::bigint,
			COALESCE(avg(extract(epoch FROM (finished_at - started_at)) * 1000)
				FILTER (WHERE created_at >= $1 AND started_at IS NOT NULL AND finished_at IS NOT NULL
					AND status IN ('succeeded', 'failed')), 0)::bigint,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (
				ORDER BY extract(epoch FROM (finished_at - started_at)) * 1000)
				FILTER (WHERE created_at >= $1 AND started_at IS NOT NULL AND finished_at IS NOT NULL
					AND status IN ('succeeded', 'failed')), 0)::bigint,
			COALESCE(avg(extract(epoch FROM (finished_at - created_at)) * 1000)
				FILTER (WHERE created_at >= $1 AND finished_at IS NOT NULL
					AND status IN ('succeeded', 'failed')), 0)::bigint,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (
				ORDER BY extract(epoch FROM (finished_at - created_at)) * 1000)
				FILTER (WHERE created_at >= $1 AND finished_at IS NOT NULL
					AND status IN ('succeeded', 'failed')), 0)::bigint
		FROM tasks`, since).Scan(
		&summary.QueuedNow, &summary.RunningNow,
		&summary.Created, &summary.Succeeded, &summary.Failed,
		&summary.AvgQueueMs, &summary.P95QueueMs,
		&summary.AvgRunMs, &summary.P95RunMs,
		&summary.AvgEndToEndMs, &summary.P95EndToEndMs,
	)
	return &summary, err
}

type ProviderPerformanceRow struct {
	Provider      string `json:"provider"`
	Total         int64  `json:"total"`
	Succeeded     int64  `json:"succeeded"`
	Failed        int64  `json:"failed"`
	AvgDurationMs int64  `json:"avgDurationMs"`
	P95DurationMs int64  `json:"p95DurationMs"`
}

func TaskProviderPerformanceSince(ctx context.Context, q Q, since time.Time) ([]ProviderPerformanceRow, error) {
	rows, err := q.Query(ctx, `
		SELECT
			COALESCE(NULLIF(params ->> '_providerDisplayName', ''),
				NULLIF(params ->> '_serviceProvider', ''), '未标记') AS provider,
			count(*),
			count(*) FILTER (WHERE status = 'succeeded'),
			count(*) FILTER (WHERE status = 'failed'),
			COALESCE(avg(extract(epoch FROM (finished_at - created_at)) * 1000)
				FILTER (WHERE finished_at IS NOT NULL AND status IN ('succeeded', 'failed')), 0)::bigint,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (
				ORDER BY extract(epoch FROM (finished_at - created_at)) * 1000)
				FILTER (WHERE finished_at IS NOT NULL AND status IN ('succeeded', 'failed')), 0)::bigint
		FROM tasks
		WHERE created_at >= $1
		GROUP BY 1
		ORDER BY count(*) DESC, provider
		LIMIT 12`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]ProviderPerformanceRow, 0, 12)
	for rows.Next() {
		var row ProviderPerformanceRow
		if err := rows.Scan(&row.Provider, &row.Total, &row.Succeeded, &row.Failed,
			&row.AvgDurationMs, &row.P95DurationMs); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
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

// SetTaskPartialOutputs persists images while generation is still running so
// reconnecting clients can recover already completed results.
func SetTaskPartialOutputs(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string) error {
	if outputKeys == nil {
		outputKeys = []string{}
	}
	if thumbnailKeys == nil {
		thumbnailKeys = []string{}
	}
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET output_keys = $2, thumbnail_keys = $3 WHERE id = $1 AND status = 'running'`,
		id, outputKeys, thumbnailKeys)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("task %s is no longer running", id)
	}
	return nil
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

// LockGlobalTaskCreation serializes the short global count-and-insert section.
// It prevents multiple API instances from accepting work past the configured cap.
func LockGlobalTaskCreation(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('global-task-admission', 0))`)
	return err
}

// LockGlobalTaskExecution serializes cluster-wide running-slot claims.
func LockGlobalTaskExecution(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('global-task-execution', 1))`)
	return err
}

// LockUserTaskExecution serializes running-slot claims for one user across all workers.
func LockUserTaskExecution(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 1))`, userID.String())
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
		`UPDATE tasks SET status = 'queued', error_code = NULL, error_message = NULL, started_at = NULL, finished_at = NULL,
			output_keys = '[]'::jsonb, thumbnail_keys = '[]'::jsonb,
			params = COALESCE(params, '{}'::jsonb) - '_crunTaskIds'
		 WHERE id = $1 AND status = 'failed'`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func SetTaskCRUNTaskIDs(ctx context.Context, q Q, id uuid.UUID, taskIDs []string) error {
	payload, err := json.Marshal(taskIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE tasks SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_crunTaskIds}', $2::jsonb, true)
		WHERE id = $1`, id, string(payload))
	return err
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
		`SELECT id FROM tasks WHERE status = 'running' AND started_at < $1 ORDER BY started_at LIMIT 500`, before)
}

// ListStaleQueuedTaskIDs 找出 queued 且 created_at 早于阈值的任务（入队丢失回收）。
func ListStaleQueuedTaskIDs(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	return listTaskIDs(ctx, q,
		`SELECT id FROM tasks WHERE status = 'queued' AND created_at < $1 ORDER BY created_at LIMIT 500`, before)
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
