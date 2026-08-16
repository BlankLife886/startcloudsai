package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const taskCols = `id, user_id, type, model, status, prompt, params, count, input_keys, output_keys, thumbnail_keys, cost_cents,
	work_units, idempotency_key, error_code, error_message, attempt, started_at, lease_owner, heartbeat_at, lease_until, finished_at, created_at,
	deleted_at, deletion_actor, deleted_output_count`

func scanTask(row pgx.Row) (*Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.UserID, &t.Type, &t.Model, &t.Status, &t.Prompt, &t.Params, &t.Count, &t.InputKeys, &t.OutputKeys, &t.ThumbnailKeys,
		&t.CostCents, &t.WorkUnits, &t.IdempotencyKey, &t.ErrorCode, &t.ErrorMessage, &t.Attempt, &t.StartedAt,
		&t.LeaseOwner, &t.HeartbeatAt, &t.LeaseUntil, &t.FinishedAt, &t.CreatedAt,
		&t.DeletedAt, &t.DeletionActor, &t.DeletedOutputCount)
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
	WorkUnits      int
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
		`INSERT INTO tasks (id, user_id, type, model, prompt, params, count, input_keys, output_keys, cost_cents, work_units, idempotency_key)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9, $10, $11) RETURNING `+taskCols,
		n.ID, n.UserID, n.Type, n.Model, n.Prompt, n.Params, n.Count, n.InputKeys, n.CostCents, max(n.WorkUnits, 1), n.IdempotencyKey))
}

func GetTask(ctx context.Context, q Q, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = $1`, id))
	return nilOnNoRows(t, err)
}

// GetTaskForUpdate serializes terminal task transitions with output writers.
// Workers that are already uploading may finish the storage operation, but
// their conditional reference update will be fenced after this lock commits.
func GetTaskForUpdate(ctx context.Context, q Q, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = $1 FOR UPDATE`, id))
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

// ListUserTasksFinishedBetween 用于把任务通知对回对应任务（画布/文生图等）。
func ListUserTasksFinishedBetween(ctx context.Context, q Q, userID uuid.UUID, from, to time.Time) ([]*Task, error) {
	if to.Before(from) {
		from, to = to, from
	}
	rows, err := q.Query(ctx,
		`SELECT `+taskCols+` FROM tasks
		 WHERE user_id = $1 AND deleted_at IS NULL AND finished_at IS NOT NULL
		   AND finished_at >= $2 AND finished_at <= $3
		 ORDER BY finished_at ASC`,
		userID, from, to)
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

func GetUserTask(ctx context.Context, q Q, userID, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, id, userID))
	return nilOnNoRows(t, err)
}

// GetUserTaskForUpdate serializes terminal-task deletion with new references.
func GetUserTaskForUpdate(ctx context.Context, q Q, userID, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx, `SELECT `+taskCols+` FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`, id, userID))
	return nilOnNoRows(t, err)
}

// LockTasksReferencingOutputKeys keeps parent rows alive while a new task
// records one of their outputs as an input. Task deletion takes the matching
// FOR UPDATE lock, so one side either observes the reference or observes that
// the parent has already gone away.
func LockTasksReferencingOutputKeys(ctx context.Context, q Q, userID uuid.UUID, keys []string) (map[string]struct{}, error) {
	referenced := make(map[string]struct{}, len(keys))
	if len(keys) == 0 {
		return referenced, nil
	}
	rows, err := q.Query(ctx, `
		SELECT id, output_keys, thumbnail_keys
		FROM tasks
		WHERE user_id = $1
		  AND (
			EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(COALESCE(output_keys, '[]'::jsonb)) AS output_key(value)
				WHERE output_key.value = ANY($2::text[])
			)
			OR EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(COALESCE(thumbnail_keys, '[]'::jsonb)) AS thumbnail_key(value)
				WHERE thumbnail_key.value = ANY($2::text[])
			)
		  )
		ORDER BY id
		FOR SHARE`, userID, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var outputKeys []string
		var thumbnailKeys []string
		if err := rows.Scan(&id, &outputKeys, &thumbnailKeys); err != nil {
			return nil, err
		}
		for _, key := range outputKeys {
			for _, want := range keys {
				if key == want {
					referenced[key] = struct{}{}
				}
			}
		}
		for _, key := range thumbnailKeys {
			for _, want := range keys {
				if key == want {
					referenced[key] = struct{}{}
				}
			}
		}
	}
	return referenced, rows.Err()
}

// CountTasksReferencingInputKeys prevents deleting an output that a later
// task still uses as a reference image (for example, a revision in a version
// chain).
func CountTasksReferencingInputKeys(ctx context.Context, q Q, userID, excludeID uuid.UUID, keys []string) (int64, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	var count int64
	err := q.QueryRow(ctx, `
		SELECT
			(
				SELECT count(*)
				FROM tasks task
				WHERE task.user_id = $1 AND task.id <> $2
				  AND task.deleted_at IS NULL
				  AND (
					EXISTS (
						SELECT 1
						FROM jsonb_array_elements_text(
							CASE WHEN jsonb_typeof(task.input_keys) = 'array'
								THEN task.input_keys ELSE '[]'::jsonb END
						) AS input_key(value)
						WHERE input_key.value = ANY($3::text[])
					)
					OR task.params->>'maskKey' = ANY($3::text[])
					OR task.params->>'maskBaseKey' = ANY($3::text[])
				  )
			)
			+ (
				SELECT count(*)
				FROM assistant_messages message
				JOIN assistant_conversations conversation ON conversation.id = message.conversation_id
				WHERE conversation.user_id = $1
				  AND (
					EXISTS (
						SELECT 1
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(message.metadata->'referenceImages') = 'array'
								THEN message.metadata->'referenceImages' ELSE '[]'::jsonb END
						) AS reference(value)
						WHERE reference.value->>'fileKey' = ANY($3::text[])
					)
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(message.metadata->'proposal'->'referenceImages') = 'array'
								THEN message.metadata->'proposal'->'referenceImages' ELSE '[]'::jsonb END
						) AS proposal_reference(value)
						WHERE proposal_reference.value->>'fileKey' = ANY($3::text[])
					)
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
								THEN message.metadata->'images' ELSE '[]'::jsonb END
						) AS image(value)
						WHERE image.value->>'fileKey' = ANY($3::text[])
					)
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
								THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END
						) AS proposal_image(value)
						WHERE proposal_image.value->>'fileKey' = ANY($3::text[])
					)
				  )
			)
			+ (
				SELECT count(*)
				FROM assistant_runs run
				WHERE run.user_id = $1
				  AND EXISTS (
					SELECT 1
					FROM jsonb_array_elements(
						CASE WHEN jsonb_typeof(run.params->'referenceImages') = 'array'
							THEN run.params->'referenceImages' ELSE '[]'::jsonb END
					) AS reference(value)
					WHERE reference.value->>'fileKey' = ANY($3::text[])
				  )
			)`, userID, excludeID, keys).Scan(&count)
	return count, err
}

// ListUserTasksReferencingInputKeysForUpdate returns direct task descendants and
// locks them so cascade deletion cannot race with a new reference being recorded.
func ListUserTasksReferencingInputKeysForUpdate(ctx context.Context, q Q, userID uuid.UUID, excludeIDs []uuid.UUID, keys []string) ([]*Task, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT `+taskCols+`
		FROM tasks task
		WHERE task.user_id = $1
		  AND task.deleted_at IS NULL
		  AND NOT (task.id = ANY($2::uuid[]))
		  AND (
			EXISTS (
				SELECT 1
				FROM jsonb_array_elements_text(
					CASE WHEN jsonb_typeof(task.input_keys) = 'array'
						THEN task.input_keys ELSE '[]'::jsonb END
				) AS input_key(value)
				WHERE input_key.value = ANY($3::text[])
			)
			OR task.params->>'maskKey' = ANY($3::text[])
			OR task.params->>'maskBaseKey' = ANY($3::text[])
		  )
		ORDER BY task.created_at
		FOR UPDATE`, userID, excludeIDs, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []*Task
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func GetTaskByIdemKey(ctx context.Context, q Q, userID uuid.UUID, key string) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx,
		`SELECT `+taskCols+` FROM tasks WHERE user_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL`, userID, key))
	return nilOnNoRows(t, err)
}

func CountActiveTasks(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM tasks WHERE user_id = $1 AND status IN ('queued', 'running')`, userID).Scan(&n)
	return n, err
}

func CountActiveTaskUnits(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT COALESCE(sum(GREATEST(work_units, 1)), 0) FROM tasks WHERE user_id = $1 AND status IN ('queued', 'running')`, userID).Scan(&n)
	return n, err
}

func CountTasksInStatuses(ctx context.Context, q Q, statuses []string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE status = ANY($1)`, statuses).Scan(&n)
	return n, err
}

func CountTaskUnitsInStatuses(ctx context.Context, q Q, statuses []string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT COALESCE(sum(GREATEST(work_units, 1)), 0) FROM tasks WHERE status = ANY($1)`, statuses).Scan(&n)
	return n, err
}

type TaskPressure struct {
	Queued          int64
	Running         int64
	ActiveUnits     int64
	OldestQueuedAt  *time.Time
	OldestRunningAt *time.Time
}

func GetTaskPressure(ctx context.Context, q Q) (TaskPressure, error) {
	var out TaskPressure
	err := q.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status = 'queued'),
			count(*) FILTER (WHERE status = 'running'),
			COALESCE(sum(GREATEST(work_units, 1)), 0),
			min(created_at) FILTER (WHERE status = 'queued'),
			min(started_at) FILTER (WHERE status = 'running')
		FROM tasks
		WHERE status IN ('queued', 'running')`).Scan(
		&out.Queued, &out.Running, &out.ActiveUnits, &out.OldestQueuedAt, &out.OldestRunningAt,
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
	return markTaskUpstreamPending(ctx, q, id, "")
}

func MarkTaskUpstreamPendingOwned(ctx context.Context, q Q, id uuid.UUID, owner string) error {
	return markTaskUpstreamPending(ctx, q, id, owner)
}

func markTaskUpstreamPending(ctx context.Context, q Q, id uuid.UUID, owner string) error {
	_, err := q.Exec(ctx, `UPDATE tasks
		SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_upstreamStage}', '"async_pending"'::jsonb, true)
		WHERE id = $1 AND status = 'running' AND ($2 = '' OR lease_owner = $2)`, id, owner)
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

type AsyncPendingRoute struct {
	ProviderID string
	RouteID    string
	RouteKey   string
}

func ListAsyncPendingRoutes(ctx context.Context, q Q, limit int) ([]AsyncPendingRoute, error) {
	if limit < 1 {
		limit = 1000
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT
		attempt.provider_id, attempt.route_id, attempt.route_key
		FROM task_upstream_attempts attempt
		JOIN tasks task ON task.id = attempt.task_id
		WHERE attempt.status IN ('submitting','pending')
		  AND task.status IN ('queued','running')
		ORDER BY attempt.route_key
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	routes := make([]AsyncPendingRoute, 0, limit)
	for rows.Next() {
		var route AsyncPendingRoute
		if err := rows.Scan(&route.ProviderID, &route.RouteID, &route.RouteKey); err != nil {
			return nil, err
		}
		if route.RouteKey != "" {
			routes = append(routes, route)
		}
	}
	return routes, rows.Err()
}

func appendTaskOriginFilter(sql string, args []any, source, excludeSource string) (string, []any) {
	if excludeSource != "" {
		args = append(args, excludeSource)
		sql += fmt.Sprintf(` AND COALESCE(params->>'_source','') <> $%d AND COALESCE(params->>'source','') <> $%d`, len(args), len(args))
		if excludeSource == CanvasTaskSource {
			sql += ` AND COALESCE(params->>'_kind','') NOT LIKE 'canvas-%'`
			sql += ` AND type <> '` + PromptTaskTypeCanvas + `'`
		}
	}
	if source != "" {
		args = append(args, source)
		sql += fmt.Sprintf(` AND (COALESCE(params->>'_source','') = $%d OR COALESCE(params->>'source','') = $%d`, len(args), len(args))
		if source == CanvasTaskSource {
			sql += ` OR COALESCE(params->>'_kind','') LIKE 'canvas-%'`
			sql += ` OR type = '` + PromptTaskTypeCanvas + `'`
		}
		sql += `)`
	}
	return sql, args
}

// ListTasks 任务分页（limit+1 行）。userID 为 nil 时查全站（后台）。
func ListTasks(ctx context.Context, q Q, userID *uuid.UUID, taskType, status string, userIDs []uuid.UUID, limit int, cursor *Cursor, excludeSource, source string) ([]*Task, error) {
	sql := `SELECT ` + taskCols + ` FROM tasks WHERE true`
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(` AND user_id = $%d`, len(args))
		sql += ` AND deleted_at IS NULL`
	}
	if taskType != "" {
		args = append(args, taskType)
		sql += fmt.Sprintf(` AND type = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	}
	sql, args = appendTaskOriginFilter(sql, args, source, excludeSource)
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
			output_keys, thumbnail_keys, cost_cents, work_units, idempotency_key, error_code,
			error_message, attempt, started_at, lease_owner, heartbeat_at, lease_until, finished_at, created_at,
			deleted_at, deletion_actor, deleted_output_count
		FROM tasks
		UNION ALL
		SELECT run.id, run.user_id, 'assistant'::text AS type,
			COALESCE(run.params->>'model', '') AS model, run.status, run.prompt,
			(run.params - 'referenceImages') || jsonb_build_object(
				'conversationId', run.conversation_id::text,
				'mode', run.mode,
				'resolvedMode', run.resolved_mode,
				'stage', run.stage,
				'workspace', conversation.workspace,
				'_source', CASE WHEN conversation.workspace = 'infinite_canvas'
					THEN 'react_canvas' ELSE conversation.workspace END
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
				FROM jsonb_array_elements(
					(CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
						THEN message.metadata->'images' ELSE '[]'::jsonb END)
					|| (CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
						THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
				) image
				WHERE COALESCE(image->>'fileKey', '') <> ''
			), '[]'::jsonb) AS output_keys,
			COALESCE((
				SELECT jsonb_agg(image->>'fileKey')
				FROM jsonb_array_elements(
					(CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
						THEN message.metadata->'images' ELSE '[]'::jsonb END)
					|| (CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
						THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
				) image
				WHERE COALESCE(image->>'fileKey', '') <> ''
			), '[]'::jsonb) AS thumbnail_keys,
			0::bigint AS cost_cents, 1::integer AS work_units, NULL::text AS idempotency_key,
			run.error_code, run.error_message, 0::integer AS attempt,
			run.started_at, NULL::text AS lease_owner, NULL::timestamptz AS heartbeat_at,
			NULL::timestamptz AS lease_until, run.finished_at, run.created_at,
			NULL::timestamptz AS deleted_at, NULL::text AS deletion_actor,
			0::integer AS deleted_output_count
		FROM assistant_runs run
		JOIN assistant_conversations conversation ON conversation.id = run.conversation_id
		LEFT JOIN assistant_messages message ON message.id = run.assistant_message_id
	`

// ListAdminTasks merges regular generation tasks with workspace-scoped model
// runs while keeping assistant_runs as their single execution source of truth.
func ListAdminTasks(ctx context.Context, q Q, taskType, status, errorCode string, userIDs []uuid.UUID, limit int, cursor *Cursor, source string) ([]*Task, error) {
	if taskType == PromptTaskTypeAssistant && source == "" {
		source = PromptTaskTypeAssistant
	}
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
	sql, args = appendTaskOriginFilter(sql, args, source, "")
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
func GetAdminTaskOverview(ctx context.Context, q Q, taskType, errorCode string, userIDs []uuid.UUID, source string) (*AdminTaskOverview, error) {
	if taskType == PromptTaskTypeAssistant && source == "" {
		source = PromptTaskTypeAssistant
	}
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
	sql, args = appendTaskOriginFilter(sql, args, source, "")
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
		`SELECT `+taskCols+` FROM tasks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $2`, userID, n)
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
		`SELECT `+column+`, count(*) FROM tasks WHERE user_id = $1 AND deleted_at IS NULL GROUP BY `+column, userID)
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

func ClaimTask(ctx context.Context, q Q, id uuid.UUID, startedAt time.Time, owner string, lease time.Duration) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'running', started_at = $2, lease_owner = $3, heartbeat_at = $2, lease_until = $4
		 WHERE id = $1 AND status = 'queued'
		   AND (COALESCE(params->>'_completionClaimId', '') = ''
			OR COALESCE((params->>'_completionClaimedAtMs')::bigint, 0) < $5)`,
		id, startedAt, owner, startedAt.Add(lease), startedAt.Add(-5*time.Minute).UnixMilli())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func RenewTaskLease(ctx context.Context, q Q, id uuid.UUID, owner string, now time.Time, lease time.Duration) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE tasks
		SET lease_owner = $2, heartbeat_at = $3, lease_until = $4
		WHERE id = $1 AND status = 'running' AND lease_owner = $2`, id, owner, now, now.Add(lease))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func TransferTaskLease(ctx context.Context, q Q, id uuid.UUID, fromOwner, toOwner string, now time.Time, lease time.Duration) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE tasks
		SET lease_owner = $3, heartbeat_at = $4, lease_until = $5
		WHERE id = $1 AND status = 'running' AND lease_owner = $2`, id, fromOwner, toOwner, now, now.Add(lease))
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

func SetTaskModelOwned(ctx context.Context, q Q, id uuid.UUID, model, owner string) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET model = $2 WHERE id = $1 AND status = 'running' AND model = '' AND lease_owner = $3`, id, model, owner)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetTaskPartialOutputs persists images while generation is still running so
// reconnecting clients can recover already completed results.
func SetTaskPartialOutputs(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string) error {
	return setTaskPartialOutputs(ctx, q, id, outputKeys, thumbnailKeys, "", "")
}

func SetTaskPartialOutputsClaimed(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, claimID string) error {
	return setTaskPartialOutputs(ctx, q, id, outputKeys, thumbnailKeys, claimID, "")
}

func SetTaskPartialOutputsOwned(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, owner string) error {
	if strings.TrimSpace(owner) == "" {
		return errors.New("task lease owner is required")
	}
	return setTaskPartialOutputs(ctx, q, id, outputKeys, thumbnailKeys, "", owner)
}

// ClearTaskOutputsAndEnqueueCleanup detaches all output references from a
// task that has already won a terminal state transition, and records the
// objects for deletion in the same transaction. Callers should hold the task
// row lock while deciding whether the transition won.
func ClearTaskOutputsAndEnqueueCleanup(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string) error {
	cleanupKeys := append(append([]string(nil), outputKeys...), thumbnailKeys...)
	if err := LockObjectReferenceKeys(ctx, q, cleanupKeys); err != nil {
		return err
	}
	if err := EnqueueObjectCleanup(ctx, q, cleanupKeys); err != nil {
		return err
	}
	_, err := q.Exec(ctx,
		`UPDATE tasks SET output_keys = '[]'::jsonb, thumbnail_keys = '[]'::jsonb WHERE id = $1`, id)
	return err
}

// ClearTaskPartialOutputsAndEnqueueCleanup atomically removes the references
// owned by one output attempt and records those objects for deletion. The
// object advisory locks match both reference writers and the cleanup worker,
// so a new version cannot observe the old task reference after the cleanup
// job becomes visible.
func ClearTaskPartialOutputsAndEnqueueCleanup(ctx context.Context, st *Store, id uuid.UUID, outputKeys, thumbnailKeys, cleanupKeys []string, claimID, owner string) error {
	if st == nil || st.Pool == nil {
		return errors.New("store is required")
	}
	return st.Tx(ctx, func(tx pgx.Tx) error {
		if err := LockObjectReferenceKeys(ctx, tx, cleanupKeys); err != nil {
			return err
		}
		if _, err := setTaskPartialOutputsIfWritable(ctx, tx, id, outputKeys, thumbnailKeys, claimID, owner); err != nil {
			return err
		}
		return EnqueueObjectCleanup(ctx, tx, cleanupKeys)
	})
}

func setTaskPartialOutputs(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, claimID, owner string) error {
	updated, err := setTaskPartialOutputsIfWritable(ctx, q, id, outputKeys, thumbnailKeys, claimID, owner)
	if err != nil {
		return err
	}
	if !updated {
		return fmt.Errorf("task %s is no longer running", id)
	}
	return nil
}

func setTaskPartialOutputsIfWritable(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, claimID, owner string) (bool, error) {
	if outputKeys == nil {
		outputKeys = []string{}
	}
	if thumbnailKeys == nil {
		thumbnailKeys = []string{}
	}
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET output_keys = $2, thumbnail_keys = $3
		 WHERE id = $1 AND (($4 <> '' AND status IN ('queued','running')) OR ($4 = '' AND status = 'running'))
			   AND ($4 = '' OR params->>'_completionClaimId' = $4)
		   AND ($5 = '' OR lease_owner = $5)`,
		id, outputKeys, thumbnailKeys, claimID, owner)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// TryClaimTaskCompletion fences provider-level pollers before they download and
// persist a completed result. Expired claims can be recovered after a crash.
func TryClaimTaskCompletion(ctx context.Context, q Q, id uuid.UUID, claimID string, claimedAt time.Time, lease time.Duration) (bool, error) {
	return tryClaimTaskCompletion(ctx, q, id, claimID, claimedAt, lease, "")
}

func TryClaimTaskCompletionOwned(ctx context.Context, q Q, id uuid.UUID, claimID string, claimedAt time.Time, lease time.Duration, owner string) (bool, error) {
	if strings.TrimSpace(owner) == "" {
		return false, errors.New("task lease owner is required")
	}
	return tryClaimTaskCompletion(ctx, q, id, claimID, claimedAt, lease, owner)
}

func tryClaimTaskCompletion(ctx context.Context, q Q, id uuid.UUID, claimID string, claimedAt time.Time, lease time.Duration, owner string) (bool, error) {
	if strings.TrimSpace(claimID) == "" {
		return false, errors.New("completion claim id is required")
	}
	claimedAtMs := claimedAt.UTC().UnixMilli()
	cutoffMs := claimedAt.Add(-lease).UTC().UnixMilli()
	statusFence := `status IN ('queued','running') AND $5 = ''`
	if owner != "" {
		statusFence = `status = 'running' AND lease_owner = $5`
	}
	tag, err := q.Exec(ctx, `UPDATE tasks
		SET params = jsonb_set(
			jsonb_set(COALESCE(params, '{}'::jsonb), '{_completionClaimId}', to_jsonb($2::text), true),
			'{_completionClaimedAtMs}', to_jsonb($3::bigint), true)
		WHERE id = $1 AND `+statusFence+`
		  AND (COALESCE(params->>'_completionClaimId', '') = ''
			OR COALESCE((params->>'_completionClaimedAtMs')::bigint, 0) < $4)`,
		id, claimID, claimedAtMs, cutoffMs, owner)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func ReleaseTaskCompletionClaim(ctx context.Context, q Q, id uuid.UUID, claimID string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE tasks
		SET params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		WHERE id = $1 AND status IN ('queued','running') AND params->>'_completionClaimId' = $2`, id, claimID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func RenewTaskCompletionClaim(ctx context.Context, q Q, id uuid.UUID, claimID string, now time.Time, lease time.Duration) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE tasks
		SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_completionClaimedAtMs}', to_jsonb($3::bigint), true)
		WHERE id = $1 AND status IN ('queued','running') AND params->>'_completionClaimId' = $2`,
		id, claimID, now.UTC().UnixMilli())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
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
	return markTaskSucceeded(ctx, q, id, outputKeys, thumbnailKeys, finishedAt, "", "")
}

func MarkTaskSucceededClaimed(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, finishedAt time.Time, claimID string) (bool, error) {
	return markTaskSucceeded(ctx, q, id, outputKeys, thumbnailKeys, finishedAt, claimID, "")
}

func MarkTaskSucceededOwned(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, finishedAt time.Time, owner string) (bool, error) {
	if strings.TrimSpace(owner) == "" {
		return false, errors.New("task lease owner is required")
	}
	return markTaskSucceeded(ctx, q, id, outputKeys, thumbnailKeys, finishedAt, "", owner)
}

func markTaskSucceeded(ctx context.Context, q Q, id uuid.UUID, outputKeys, thumbnailKeys []string, finishedAt time.Time, claimID, owner string) (bool, error) {
	if outputKeys == nil {
		outputKeys = []string{}
	}
	if thumbnailKeys == nil {
		thumbnailKeys = []string{}
	}
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'succeeded', output_keys = $2, thumbnail_keys = $3, finished_at = $4,
			error_code = NULL, error_message = NULL,
			lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
			params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		 WHERE id = $1 AND (($5 <> '' AND status IN ('queued','running')) OR ($5 = '' AND status = 'running'))
		   AND ($5 = '' OR params->>'_completionClaimId' = $5)
		   AND ($6 = '' OR lease_owner = $6)`, id, outputKeys, thumbnailKeys, finishedAt, claimID, owner)
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
	return markTaskFailed(ctx, q, id, fromStatus, errorCode, errorMessage, finishedAt, "", "")
}

func MarkTaskFailedClaimed(ctx context.Context, q Q, id uuid.UUID, fromStatus, errorCode, errorMessage string, finishedAt time.Time, claimID string) (bool, error) {
	return markTaskFailed(ctx, q, id, fromStatus, errorCode, errorMessage, finishedAt, claimID, "")
}

func MarkTaskFailedOwned(ctx context.Context, q Q, id uuid.UUID, fromStatus, errorCode, errorMessage string, finishedAt time.Time, owner string) (bool, error) {
	if strings.TrimSpace(owner) == "" {
		return false, errors.New("task lease owner is required")
	}
	return markTaskFailed(ctx, q, id, fromStatus, errorCode, errorMessage, finishedAt, "", owner)
}

func markTaskFailed(ctx context.Context, q Q, id uuid.UUID, fromStatus, errorCode, errorMessage string, finishedAt time.Time, claimID, owner string) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'failed', error_code = $3, error_message = $4, finished_at = $5,
			lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
			params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		 WHERE id = $1 AND (($6 <> '' AND status IN ('queued','running')) OR ($6 = '' AND status = $2))
		   AND ($6 = '' OR params->>'_completionClaimId' = $6)
		   AND ($7 = '' OR lease_owner = $7)`, id, fromStatus, errorCode, errorMessage, finishedAt, claimID, owner)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func RequeueTask(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'queued', attempt = attempt + 1,
			error_code = NULL, error_message = NULL, started_at = NULL,
			lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL, finished_at = NULL,
			output_keys = '[]'::jsonb, thumbnail_keys = '[]'::jsonb,
			params = COALESCE(params, '{}'::jsonb)
				- '_crunTaskIds' - '_upstreamStage' - '_failedProviderConfigIds'
				- '_completionClaimId' - '_completionClaimedAtMs'
		 WHERE id = $1 AND status = 'failed'`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func SetTaskCRUNTaskIDs(ctx context.Context, q Q, id uuid.UUID, taskIDs []string) error {
	return setTaskCRUNTaskIDs(ctx, q, id, taskIDs, "")
}

func SetTaskCRUNTaskIDsOwned(ctx context.Context, q Q, id uuid.UUID, taskIDs []string, owner string) error {
	return setTaskCRUNTaskIDs(ctx, q, id, taskIDs, owner)
}

func setTaskCRUNTaskIDs(ctx context.Context, q Q, id uuid.UUID, taskIDs []string, owner string) error {
	payload, err := json.Marshal(taskIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE tasks SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_crunTaskIds}', $2::jsonb, true)
		WHERE id = $1 AND ($3 = '' OR (status = 'running' AND lease_owner = $3))`, id, string(payload), owner)
	return err
}

// RequeueRunningTask 将失去 Worker 的 running 任务恢复到 queued。任务原有冻结金额
// 保持不变，后续仍以同一个 task ID 查询幂等的上游图片任务。
func RequeueRunningTask(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	return requeueRunningTask(ctx, q, id, "")
}

func RequeueRunningTaskOwned(ctx context.Context, q Q, id uuid.UUID, owner string) (bool, error) {
	if strings.TrimSpace(owner) == "" {
		return false, errors.New("task lease owner is required")
	}
	return requeueRunningTask(ctx, q, id, owner)
}

func requeueRunningTask(ctx context.Context, q Q, id uuid.UUID, owner string) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'queued', started_at = NULL, lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
			params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		 WHERE id = $1 AND status = 'running' AND ($2 = '' OR lease_owner = $2)`, id, owner)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// RequeueExpiredRunningTasks only recovers rows whose lease has expired. This
// keeps live tasks safe during rolling deploys and multi-worker startup.
func RequeueExpiredRunningTasks(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx,
		`WITH expired AS (
			SELECT id FROM tasks
			WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= $1)
			ORDER BY lease_until NULLS FIRST, started_at
			FOR UPDATE SKIP LOCKED
			LIMIT 500
		)
		UPDATE tasks AS task SET status = 'queued', started_at = NULL, lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
			params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		FROM expired
		WHERE task.id = expired.id AND task.status = 'running' AND (task.lease_until IS NULL OR task.lease_until <= $1)
		RETURNING task.id`, before)
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

// RequeueAllRunningTasks is retained for test and maintenance callers. New
// workers must use RequeueExpiredRunningTasks so live leases are preserved.
func RequeueAllRunningTasks(ctx context.Context, q Q) ([]uuid.UUID, error) {
	return RequeueExpiredRunningTasks(ctx, q, time.Now().UTC())
}

func ClearTaskLease(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE tasks SET lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL WHERE id = $1`, id)
	return err
}

func BumpTaskAttempt(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE tasks SET attempt = attempt + 1 WHERE id = $1`, id)
	return err
}

// RetryRunningTaskOwned atomically records provider failover history, bumps the
// attempt, and returns a lease-owned running task to queued. A stale worker can
// never split these state changes or retry work after losing its lease.
func RetryRunningTaskOwned(ctx context.Context, q Q, id uuid.UUID, owner string, expectedAttempt int, failedProviderIDs []string) (int, bool, error) {
	if strings.TrimSpace(owner) == "" {
		return expectedAttempt, false, errors.New("task lease owner is required")
	}
	payload, err := json.Marshal(failedProviderIDs)
	if err != nil {
		return expectedAttempt, false, err
	}
	var attempt int
	err = q.QueryRow(ctx, `UPDATE tasks SET
		status = 'queued', attempt = attempt + 1, started_at = NULL, finished_at = NULL,
		lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
		error_code = NULL, error_message = NULL,
		params = jsonb_set(
			COALESCE(params, '{}'::jsonb) - '_upstreamStage' - '_crunTaskIds',
			'{_failedProviderConfigIds}', $4::jsonb, true)
		WHERE id = $1 AND status = 'running' AND lease_owner = $2 AND attempt = $3
		  AND COALESCE(params->>'_completionClaimId', '') = ''
		RETURNING attempt`, id, owner, expectedAttempt, string(payload)).Scan(&attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return expectedAttempt, false, nil
	}
	return attempt, err == nil, err
}

func MarkTaskDeletedByUser(ctx context.Context, q Q, id uuid.UUID, deletedAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE tasks SET
		deleted_at = $2,
		deletion_actor = 'user',
		deleted_output_count = jsonb_array_length(
			CASE WHEN jsonb_typeof(output_keys) = 'array' THEN output_keys ELSE '[]'::jsonb END
		),
		input_keys = '[]'::jsonb,
		output_keys = '[]'::jsonb,
		thumbnail_keys = '[]'::jsonb,
		idempotency_key = NULL,
		params = COALESCE(params, '{}'::jsonb) - 'maskKey' - 'maskBaseKey'
		WHERE id = $1 AND deleted_at IS NULL`, id, deletedAt)
	return err
}

// DeleteTask permanently removes a task. User-facing deletion must use
// MarkTaskDeletedByUser so administrators retain the deletion audit marker.
func DeleteTask(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, id)
	return err
}

// ListZombieTaskIDs 找出 running 且 started_at 早于阈值的任务。
func ListZombieTaskIDs(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	return listTaskIDs(ctx, q,
		`SELECT id FROM tasks WHERE status = 'running' AND (lease_until IS NULL OR lease_until < $1) ORDER BY started_at LIMIT 500`, before)
}

// ListStaleQueuedTaskIDs 找出 queued 且 created_at 早于阈值的任务（入队丢失回收）。
func ListStaleQueuedTaskIDs(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	return listTaskIDs(ctx, q,
		`SELECT id FROM tasks WHERE status = 'queued' AND created_at < $1 ORDER BY created_at LIMIT 15000`, before)
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
