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

const UIDesignRegionEditKind = "ui-design-region-edit"
const UIDesignAssetHistoryLeaseOwner = "ui-design-asset-history"
const UIDesignAssetHistoryIdemPrefix = "ui-design-asset:"

func UIDesignAssetHistoryIdempotencyKey(runID uuid.UUID) string {
	return UIDesignAssetHistoryIdemPrefix + runID.String()
}

const uiDesignAssetHistoryNotSQL = `COALESCE(params->>'_kind','') <> '` + UIDesignRegionEditKind + `'`

func assistantReferenceFileKeys(params map[string]any) []string {
	if params == nil {
		return nil
	}
	raw, ok := params["referenceImages"]
	if !ok {
		return nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		ref, _ := item.(map[string]any)
		if ref == nil {
			continue
		}
		key := strings.TrimSpace(paramText(ref, "fileKey"))
		if key == "" || (!strings.HasPrefix(key, "tasks/") && !strings.HasPrefix(key, "uploads/")) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func assistantRunImageCount(params map[string]any) int {
	switch value := params["count"].(type) {
	case int:
		if value >= 1 && value <= 4 {
			return value
		}
	case int32:
		if value >= 1 && value <= 4 {
			return int(value)
		}
	case int64:
		if value >= 1 && value <= 4 {
			return int(value)
		}
	case float64:
		if value >= 1 && value <= 4 {
			return int(value)
		}
	}
	return 1
}

func normalizeHistoryOutputKeys(outputKeys []string) []string {
	keys := make([]string, 0, len(outputKeys))
	seen := make(map[string]struct{}, len(outputKeys))
	for _, raw := range outputKeys {
		key := strings.TrimSpace(raw)
		if key == "" || !strings.HasPrefix(key, "tasks/") {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func uiDesignAssetHistoryParams(run *AssistantRun) map[string]any {
	params := map[string]any{
		"_kind":          UIDesignRegionEditKind,
		"_source":        "ui_design",
		"source":         "ui-design-workshop",
		"workspace":      "ui_design",
		"assistantRunId": run.ID.String(),
		"_historyMirror": true,
		"quality":        paramText(run.Params, "quality"),
		"requestSize":    paramText(run.Params, "requestSize"),
		"serviceKey":     "ui_design_asset",
	}
	if run.ConversationID != uuid.Nil {
		params["conversationId"] = run.ConversationID.String()
	}
	if display := paramText(run.Params, "_imageModelDisplayName", "_modelDisplayName"); display != "" {
		params["_modelDisplayName"] = display
	}
	for _, key := range []string{
		"_serviceProvider",
		"_imageProviderConfigId",
		"_imageProviderDisplayName",
		"_imageProviderRouteId",
		"_imageProviderRouteKey",
		"_imageProviderRouteName",
		"_imageProviderEndpoint",
		"_imageModelConfigId",
		"_imageModel",
		"_imageModelDisplayName",
	} {
		if value, exists := run.Params[key]; exists {
			params[key] = value
		}
	}
	if parent := paramText(run.Params, "parentOutputUrl"); parent != "" {
		params["parentOutputUrl"] = parent
	}
	return params
}

// SyncUIDesignAssetHistoryFromRun mirrors a UI 设计稿 region-edit assistant run
// onto the user task list so 历史记录 shows queued/running work, not only the
// finished image. The workshop still deletes the ephemeral conversation.
func SyncUIDesignAssetHistoryFromRun(ctx context.Context, q Q, run *AssistantRun, outputKeys []string) (*Task, bool, error) {
	if run == nil || paramText(run.Params, "serviceKey") != "ui_design_asset" {
		return nil, false, nil
	}
	switch strings.ToLower(strings.TrimSpace(run.Status)) {
	case "succeeded":
		return upsertUIDesignAssetHistoryTask(ctx, q, run, "succeeded", normalizeHistoryOutputKeys(outputKeys))
	case "failed", "canceled":
		return upsertUIDesignAssetHistoryTask(ctx, q, run, run.Status, nil)
	default:
		return upsertUIDesignAssetHistoryTask(ctx, q, run, "running", nil)
	}
}

// EnsureAssistantGalleryTask materializes a completed assistant image run as a
// task only when a user publishes it. Gallery submissions retain their existing
// task ownership, output-locking, review, and duplicate-prevention contracts.
func EnsureAssistantGalleryTask(ctx context.Context, q Q, run *AssistantRun) (*Task, error) {
	if run == nil || run.UserID == uuid.Nil || run.Status != "succeeded" ||
		(run.Mode != "image" && run.ResolvedMode != "image") {
		return nil, nil
	}
	if existing, err := GetTask(ctx, q, run.ID); err != nil || existing != nil {
		return existing, err
	}
	message, err := GetAssistantMessage(ctx, q, run.AssistantMessageID)
	if err != nil || message == nil {
		return nil, err
	}
	images := assistantGalleryImages(message.Metadata["images"])
	outputKeys := make([]string, 0, len(images))
	seen := make(map[string]struct{}, len(images))
	for _, item := range images {
		if key := strings.TrimSpace(paramText(item, "fileKey")); strings.HasPrefix(key, "tasks/"+run.UserID.String()+"/") {
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			outputKeys = append(outputKeys, key)
		}
	}
	if len(outputKeys) == 0 {
		return nil, nil
	}
	params := make(map[string]any, len(run.Params)+3)
	for key, value := range run.Params {
		if strings.HasPrefix(key, "_") || key == "referenceImages" {
			continue
		}
		params[key] = value
	}
	params["_source"] = "assistant"
	params["_historyMirror"] = true
	params["assistantRunId"] = run.ID.String()
	count := len(outputKeys)
	if count > 4 {
		count = 4
		outputKeys = outputKeys[:4]
	}
	createdAt := run.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	task, err := scanTask(q.QueryRow(ctx,
		`INSERT INTO tasks (
			id, user_id, type, model, status, prompt, params, count,
			input_keys, output_keys, thumbnail_keys, cost_cents, work_units,
			idempotency_key, started_at, finished_at, created_at
		) VALUES ($1, $2, 't2i', $3, 'succeeded', $4, $5, $6, $7, $8, $8, $9, $6, $10, $11, $12, $13)
		RETURNING `+taskCols,
		run.ID, run.UserID, paramText(run.Params, "model"), run.Prompt, params, count,
		assistantReferenceFileKeys(run.Params), outputKeys, run.CostCents,
		"assistant-gallery:"+run.ID.String(), run.StartedAt, run.FinishedAt, createdAt))
	if err != nil {
		if existing, lookupErr := GetTask(ctx, q, run.ID); lookupErr == nil && existing != nil {
			return existing, nil
		}
		return nil, err
	}
	return task, nil
}

func assistantGalleryImages(value any) []map[string]any {
	switch images := value.(type) {
	case []map[string]any:
		return images
	case []any:
		items := make([]map[string]any, 0, len(images))
		for _, raw := range images {
			if item, ok := raw.(map[string]any); ok && item != nil {
				items = append(items, item)
			}
		}
		return items
	default:
		return nil
	}
}

func upsertUIDesignAssetHistoryTask(ctx context.Context, q Q, run *AssistantRun, status string, outputKeys []string) (*Task, bool, error) {
	if status == "succeeded" && len(outputKeys) == 0 {
		status = "running"
	}
	idempotencyKey := UIDesignAssetHistoryIdempotencyKey(run.ID)
	existing, err := GetTaskByIdemKey(ctx, q, run.UserID, idempotencyKey)
	if err != nil {
		return nil, false, err
	}
	count := assistantRunImageCount(run.Params)
	if len(outputKeys) > 0 {
		count = len(outputKeys)
		if count > 4 {
			count = 4
		}
	}
	model := paramText(run.Params, "model", "_imageModelConfigId")
	params := uiDesignAssetHistoryParams(run)
	now := time.Now().UTC()
	startedAt := run.StartedAt
	if startedAt == nil {
		startedAt = &now
	}
	createdAt := run.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	inputKeys := assistantReferenceFileKeys(run.Params)
	if inputKeys == nil {
		inputKeys = []string{}
	}
	if outputKeys == nil {
		outputKeys = []string{}
	}
	cost := run.CostCents
	if status == "running" && cost <= 0 {
		cost = run.ReservedCents
	}
	var finishedAt *time.Time
	if status == "succeeded" || status == "failed" || status == "canceled" {
		finishedAt = run.FinishedAt
		if finishedAt == nil {
			finishedAt = &now
		}
	}
	if existing != nil {
		task, err := scanTask(q.QueryRow(ctx,
			`UPDATE tasks SET
				status = $2, model = $3, prompt = $4, params = $5, count = $6, work_units = $6,
				input_keys = $7, output_keys = $8, thumbnail_keys = $8, cost_cents = $9,
				error_code = $10, error_message = $11, started_at = $12, finished_at = $13,
				lease_owner = CASE WHEN $2 IN ('queued','running') THEN $14::text ELSE NULL END,
				heartbeat_at = CASE WHEN $2 IN ('queued','running') THEN $12::timestamptz ELSE NULL END,
				lease_until = CASE WHEN $2 IN ('queued','running') THEN $15::timestamptz ELSE NULL END
			 WHERE id = $1 AND deleted_at IS NULL
			 RETURNING `+taskCols,
			existing.ID, status, model, run.Prompt, params, count,
			inputKeys, outputKeys, cost, run.ErrorCode, run.ErrorMessage,
			startedAt, finishedAt, UIDesignAssetHistoryLeaseOwner, now.Add(30*24*time.Hour)))
		if err != nil {
			return nil, false, err
		}
		return task, false, nil
	}
	leaseUntil := now.Add(30 * 24 * time.Hour)
	leaseOwner := any(nil)
	var leaseUntilArg any
	if status == "running" {
		leaseOwner = UIDesignAssetHistoryLeaseOwner
		leaseUntilArg = leaseUntil
	}
	task, err := scanTask(q.QueryRow(ctx,
		`INSERT INTO tasks (
			id, user_id, type, model, status, prompt, params, count,
			input_keys, output_keys, thumbnail_keys, cost_cents, work_units,
			idempotency_key, error_code, error_message, started_at, finished_at,
			created_at, lease_owner, heartbeat_at, lease_until
		) VALUES (
			$1, $2, 'ui_design', $3, $4, $5, $6, $7,
			$8, $9, $9, $10, $7, $11, $12, $13, $14, $15,
			$16, $17, $14, $18
		) RETURNING `+taskCols,
		uuid.New(), run.UserID, model, status, run.Prompt, params, count,
		inputKeys, outputKeys, cost, idempotencyKey, run.ErrorCode, run.ErrorMessage,
		startedAt, finishedAt, createdAt, leaseOwner, leaseUntilArg))
	if err != nil {
		if existing, lookupErr := GetTaskByIdemKey(ctx, q, run.UserID, idempotencyKey); lookupErr == nil && existing != nil {
			return existing, false, nil
		}
		return nil, false, err
	}
	return task, true, nil
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
	if item, err := nilOnNoRows(t, err); item != nil || err != nil {
		return item, err
	}
	return getUserUIDesignAssetRunAsTask(ctx, q, userID, id)
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
		`SELECT count(*) FROM tasks WHERE user_id = $1 AND status IN ('queued', 'running') AND `+uiDesignAssetHistoryNotSQL, userID).Scan(&n)
	return n, err
}

func CountActiveTaskUnits(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT COALESCE(sum(GREATEST(work_units, 1)), 0) FROM tasks WHERE user_id = $1 AND status IN ('queued', 'running') AND `+uiDesignAssetHistoryNotSQL, userID).Scan(&n)
	return n, err
}

func CountTasksInStatuses(ctx context.Context, q Q, statuses []string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE status = ANY($1) AND `+uiDesignAssetHistoryNotSQL, statuses).Scan(&n)
	return n, err
}

func CountTaskUnitsInStatuses(ctx context.Context, q Q, statuses []string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT COALESCE(sum(GREATEST(work_units, 1)), 0) FROM tasks WHERE status = ANY($1) AND `+uiDesignAssetHistoryNotSQL, statuses).Scan(&n)
	return n, err
}

// The global admission/execution counts below use literal status predicates so
// the planner can use the ix_tasks_active_admission partial index (which also
// carries the _kind filter and work_units) as an index-only scan, instead of
// scanning every active row and re-checking the JSONB filter on the heap.

// CountActiveTasksGlobal counts cluster-wide queued+running admission-visible tasks.
func CountActiveTasksGlobal(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE status IN ('queued','running') AND `+uiDesignAssetHistoryNotSQL).Scan(&n)
	return n, err
}

// CountActiveTaskUnitsGlobal sums cluster-wide queued+running work units.
func CountActiveTaskUnitsGlobal(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT COALESCE(sum(GREATEST(work_units, 1)), 0) FROM tasks WHERE status IN ('queued','running') AND `+uiDesignAssetHistoryNotSQL).Scan(&n)
	return n, err
}

// CountRunningTasksGlobal counts cluster-wide running admission-visible tasks
// (status='running' implies the partial index predicate).
func CountRunningTasksGlobal(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE status = 'running' AND `+uiDesignAssetHistoryNotSQL).Scan(&n)
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
		WHERE status IN ('queued', 'running') AND `+uiDesignAssetHistoryNotSQL).Scan(
		&out.Queued, &out.Running, &out.ActiveUnits, &out.OldestQueuedAt, &out.OldestRunningAt,
	)
	return out, err
}

func CountRunningTasks(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM tasks WHERE user_id = $1 AND status = 'running' AND `+uiDesignAssetHistoryNotSQL, userID).Scan(&n)
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

const userHistoryTaskSourceSQL = `
		SELECT id, user_id, type, model, status, prompt, params, count, input_keys,
			output_keys, thumbnail_keys, cost_cents, work_units, idempotency_key, error_code,
			error_message, attempt, started_at, lease_owner, heartbeat_at, lease_until, finished_at, created_at,
			deleted_at, deletion_actor, deleted_output_count
		FROM tasks
		UNION ALL
		SELECT run.id, run.user_id, 'ui_design'::text AS type,
			COALESCE(run.params->>'model', '') AS model, run.status, run.prompt,
			(run.params - 'referenceImages') || jsonb_build_object(
				'conversationId', run.conversation_id::text,
				'mode', run.mode,
				'resolvedMode', run.resolved_mode,
				'stage', run.stage,
				'workspace', conversation.workspace,
				'_kind', '` + UIDesignRegionEditKind + `',
				'_source', 'ui_design',
				'source', 'ui-design-workshop',
				'assistantRunId', run.id::text
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
			COALESCE(run.cost_cents, 0)::bigint AS cost_cents, 1::integer AS work_units, NULL::text AS idempotency_key,
			run.error_code, run.error_message, 0::integer AS attempt,
			run.started_at, NULL::text AS lease_owner, NULL::timestamptz AS heartbeat_at,
			NULL::timestamptz AS lease_until, run.finished_at, run.created_at,
			NULL::timestamptz AS deleted_at, NULL::text AS deletion_actor,
			0::integer AS deleted_output_count
		FROM assistant_runs run
		JOIN assistant_conversations conversation ON conversation.id = run.conversation_id
		LEFT JOIN assistant_messages message ON message.id = run.assistant_message_id
		WHERE conversation.workspace = 'ui_design'
		  AND run.mode = 'image'
		  AND COALESCE(run.params->>'serviceKey', '') = 'ui_design_asset'
		  AND NOT EXISTS (
			SELECT 1 FROM tasks task
			WHERE task.user_id = run.user_id
			  AND task.deleted_at IS NULL
			  AND task.idempotency_key = '` + UIDesignAssetHistoryIdemPrefix + `' || run.id::text
		  )
	`

func getUserUIDesignAssetRunAsTask(ctx context.Context, q Q, userID, id uuid.UUID) (*Task, error) {
	t, err := scanTask(q.QueryRow(ctx,
		`SELECT `+taskCols+` FROM (`+userHistoryTaskSourceSQL+`) user_history_tasks
		 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, id, userID))
	return nilOnNoRows(t, err)
}

// ListTasks 任务分页（limit+1 行）。userID 为 nil 时查全站（后台）。
func ListTasks(ctx context.Context, q Q, userID *uuid.UUID, taskType, status string, userIDs []uuid.UUID, limit int, cursor *Cursor, excludeSource, source string) ([]*Task, error) {
	from := "tasks"
	if userID != nil {
		from = "(" + userHistoryTaskSourceSQL + ") user_history_tasks"
	}
	sql := `SELECT ` + taskCols + ` FROM ` + from + ` WHERE true`
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
		WHERE admin_cleared_at IS NULL
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
		WHERE run.admin_cleared_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM tasks task
			WHERE task.deleted_at IS NULL
			  AND task.admin_cleared_at IS NULL
			  AND task.idempotency_key = '` + UIDesignAssetHistoryIdemPrefix + `' || run.id::text
		  )
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

type AdminTaskPurgeResult struct {
	Deleted int64 `json:"deleted"`
	Skipped int64 `json:"skipped"`
}

// PurgeFinishedAdminTasks hides finished admin-visible records from the admin
// monitor using the same filters as ListAdminTasks. User history, outputs,
// wallet ledger, gallery submissions, and ecommerce reviews stay in place.
func PurgeFinishedAdminTasks(ctx context.Context, st *Store, taskType, status, errorCode string, userIDs []uuid.UUID, source string) (*AdminTaskPurgeResult, error) {
	if st == nil || st.Pool == nil {
		return nil, errors.New("store is required")
	}
	if status == "queued" || status == "running" {
		return &AdminTaskPurgeResult{}, nil
	}
	var result *AdminTaskPurgeResult
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var txErr error
		result, txErr = purgeFinishedAdminTasksTx(ctx, tx, taskType, status, errorCode, userIDs, source)
		return txErr
	})
	if result == nil {
		result = &AdminTaskPurgeResult{}
	}
	return result, err
}

func purgeFinishedAdminTasksTx(ctx context.Context, q Q, taskType, status, errorCode string, userIDs []uuid.UUID, source string) (*AdminTaskPurgeResult, error) {
	if taskType == PromptTaskTypeAssistant && source == "" {
		source = PromptTaskTypeAssistant
	}
	sql := `SELECT id, type FROM (` + adminTaskSourceSQL + `) admin_tasks WHERE true`
	args := []any{}
	if taskType != "" {
		args = append(args, taskType)
		sql += fmt.Sprintf(` AND type = $%d`, len(args))
	}
	if status != "" {
		args = append(args, status)
		sql += fmt.Sprintf(` AND status = $%d`, len(args))
	} else {
		sql += ` AND status IN ('succeeded','failed','canceled')`
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
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	taskIDs := make([]uuid.UUID, 0)
	runIDs := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		var rowType string
		if err := rows.Scan(&id, &rowType); err != nil {
			return nil, err
		}
		if rowType == PromptTaskTypeAssistant {
			runIDs = append(runIDs, id)
			continue
		}
		taskIDs = append(taskIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &AdminTaskPurgeResult{}
	if len(taskIDs) == 0 && len(runIDs) == 0 {
		return result, nil
	}
	if len(taskIDs) > 0 {
		tag, err := q.Exec(ctx, `UPDATE tasks
			SET admin_cleared_at = now()
			WHERE id = ANY($1)
			  AND admin_cleared_at IS NULL
			  AND status IN ('succeeded','failed','canceled')`, taskIDs)
		if err != nil {
			return nil, err
		}
		result.Deleted += tag.RowsAffected()
	}
	if len(runIDs) > 0 {
		tag, err := q.Exec(ctx, `UPDATE assistant_runs
			SET admin_cleared_at = now()
			WHERE id = ANY($1)
			  AND admin_cleared_at IS NULL
			  AND status IN ('succeeded','failed','canceled')`, runIDs)
		if err != nil {
			return nil, err
		}
		result.Deleted += tag.RowsAffected()
	}
	return result, nil
}

func enqueueObjectCleanupInChunks(ctx context.Context, q Q, keys []string) error {
	filtered := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, raw := range keys {
		key := strings.TrimSpace(raw)
		if key == "" || !strings.HasPrefix(key, "tasks/") || len(key) > 512 || strings.Contains(key, "..") || strings.Contains(key, `\`) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		filtered = append(filtered, key)
	}
	for start := 0; start < len(filtered); start += maxObjectCleanupKeys {
		end := start + maxObjectCleanupKeys
		if end > len(filtered) {
			end = len(filtered)
		}
		if err := EnqueueObjectCleanup(ctx, q, filtered[start:end]); err != nil {
			return err
		}
	}
	return nil
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
	cleanupKeys := WithDisplayKeys(append(append([]string(nil), outputKeys...), thumbnailKeys...))
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
	return CancelTaskFromStatus(ctx, q, id, "queued", "", "", finishedAt)
}

// CancelTaskFromStatus fences a terminal user cancellation against the exact
// status observed while the task row is locked. Late worker success/failure
// callbacks therefore cannot overwrite the cancellation.
func CancelTaskFromStatus(ctx context.Context, q Q, id uuid.UUID, fromStatus, errorCode, errorMessage string, finishedAt time.Time) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE tasks SET status = 'canceled', error_code = NULLIF($3, ''), error_message = NULLIF($4, ''), finished_at = $5,
			lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
			params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		 WHERE id = $1 AND status = $2`, id, fromStatus, errorCode, errorMessage, finishedAt)
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

// nonIdempotentRetryGraceSQL widens the lease-expiry threshold for providers
// whose upstream submission cannot be replayed idempotently (sub2api has no
// client task key; CRUN is only replay-safe once _crunTaskIds is recorded).
// Requeueing such a task while its original worker is merely partitioned (not
// dead) would double-execute and double-bill upstream, so the reaper waits an
// extra grace period before reclaiming them.
const nonIdempotentRetryGraceSQL = `CASE
	WHEN COALESCE(params->>'_serviceProvider','') = 'sub2api'
	  OR (COALESCE(params->>'_serviceProvider','') = 'crun'
	      AND (jsonb_typeof(params->'_crunTaskIds') IS DISTINCT FROM 'array'
	           OR jsonb_array_length(params->'_crunTaskIds') = 0))
	THEN $1::timestamptz - interval '2 minutes'
	ELSE $1::timestamptz
END`

// RequeueExpiredRunningTasks only recovers rows whose lease has expired. This
// keeps live tasks safe during rolling deploys and multi-worker startup.
func RequeueExpiredRunningTasks(ctx context.Context, q Q, before time.Time) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx,
		`WITH expired AS (
			SELECT id FROM tasks
			WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= `+nonIdempotentRetryGraceSQL+`)
			  AND `+uiDesignAssetHistoryNotSQL+`
			ORDER BY lease_until NULLS FIRST, started_at
			FOR UPDATE SKIP LOCKED
			LIMIT 500
		)
		UPDATE tasks AS task SET status = 'queued', started_at = NULL, lease_owner = NULL, heartbeat_at = NULL, lease_until = NULL,
			params = COALESCE(params, '{}'::jsonb) - '_completionClaimId' - '_completionClaimedAtMs'
		FROM expired
		WHERE task.id = expired.id AND task.status = 'running' AND (task.lease_until IS NULL OR task.lease_until <= $1)
		  AND `+uiDesignAssetHistoryNotSQL+`
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

func RemoveTaskOutputAt(ctx context.Context, q Q, id uuid.UUID, remainingOutputs, remainingThumbs []string) error {
	if remainingOutputs == nil {
		remainingOutputs = []string{}
	}
	if remainingThumbs == nil {
		remainingThumbs = []string{}
	}
	count := len(remainingOutputs)
	if count < 1 {
		count = 1
	}
	_, err := q.Exec(ctx, `UPDATE tasks SET
		output_keys = $2,
		thumbnail_keys = $3,
		count = $4,
		deleted_output_count = deleted_output_count + 1
		WHERE id = $1 AND deleted_at IS NULL`, id, remainingOutputs, remainingThumbs, count)
	return err
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
		`SELECT id FROM tasks WHERE status = 'running' AND (lease_until IS NULL OR lease_until < $1) AND `+uiDesignAssetHistoryNotSQL+` ORDER BY started_at LIMIT 500`, before)
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
