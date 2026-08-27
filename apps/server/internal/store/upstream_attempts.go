package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	UpstreamAttemptSubmitting = "submitting"
	UpstreamAttemptPending    = "pending"
	UpstreamAttemptSucceeded  = "succeeded"
	UpstreamAttemptFailed     = "failed"
	UpstreamAttemptExpired    = "expired"
	UpstreamAttemptSuperseded = "superseded"
)

type UpstreamAttemptInput struct {
	TaskID          uuid.UUID
	TaskAttempt     int
	ProviderID      string
	RouteID         string
	RouteKey        string
	Adapter         string
	UpstreamModel   string
	BaseURL         string
	APIKeyEncrypted string
	TimeoutSecs     int
	MaxConcurrency  int
	UpstreamTaskIDs []string
	Status          string
	SubmittedAt     time.Time
	FailoverAt      time.Time
	ExpiresAt       time.Time
}

type UpstreamAttemptRoute struct {
	ProviderID      string
	RouteID         string
	RouteKey        string
	Adapter         string
	BaseURL         string
	APIKeyEncrypted string
	TimeoutSecs     int
	MaxConcurrency  int
}

type claimedUpstreamAttempt struct {
	ID                  uuid.UUID
	TaskID              uuid.UUID
	ProviderID          string
	RouteID             string
	RouteKey            string
	Adapter             string
	UpstreamModel       string
	BaseURL             string
	APIKeyEncrypted     string
	TimeoutSecs         int
	MaxConcurrency      int
	UpstreamTaskIDs     []string
	SubmittedAt         time.Time
	FailoverAt          time.Time
	ExpiresAt           time.Time
	FailoverScheduledAt *time.Time
}

func UpsertTaskUpstreamAttempt(ctx context.Context, q Q, input UpstreamAttemptInput) (uuid.UUID, error) {
	if input.TaskID == uuid.Nil || strings.TrimSpace(input.RouteKey) == "" {
		return uuid.Nil, errors.New("task upstream attempt requires task id and route key")
	}
	if input.Status == "" {
		input.Status = UpstreamAttemptPending
	}
	if input.TimeoutSecs <= 0 {
		input.TimeoutSecs = 300
	}
	if input.MaxConcurrency <= 0 {
		input.MaxConcurrency = 1
	}
	if input.UpstreamTaskIDs == nil {
		input.UpstreamTaskIDs = []string{}
	}
	if input.SubmittedAt.IsZero() {
		input.SubmittedAt = time.Now().UTC()
	}
	if input.FailoverAt.IsZero() {
		input.FailoverAt = input.SubmittedAt.Add(time.Duration(input.TimeoutSecs) * time.Second)
	}
	if input.ExpiresAt.Before(input.FailoverAt) {
		input.ExpiresAt = input.FailoverAt.Add(30 * time.Minute)
	}
	ids, err := json.Marshal(input.UpstreamTaskIDs)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = q.QueryRow(ctx, `INSERT INTO task_upstream_attempts (
		task_id, task_attempt, provider_id, route_id, route_key, adapter, upstream_model,
		base_url, api_key_encrypted, timeout_secs, max_concurrency, upstream_task_ids,
		status, submitted_at, failover_at, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
		ON CONFLICT ON CONSTRAINT uq_task_upstream_attempt DO UPDATE SET
			provider_id = EXCLUDED.provider_id,
			route_id = EXCLUDED.route_id,
			adapter = EXCLUDED.adapter,
			upstream_model = EXCLUDED.upstream_model,
			base_url = EXCLUDED.base_url,
			api_key_encrypted = EXCLUDED.api_key_encrypted,
			timeout_secs = EXCLUDED.timeout_secs,
			max_concurrency = EXCLUDED.max_concurrency,
			upstream_task_ids = CASE
				WHEN jsonb_array_length(EXCLUDED.upstream_task_ids) > 0 THEN EXCLUDED.upstream_task_ids
				ELSE task_upstream_attempts.upstream_task_ids END,
			status = CASE
				WHEN task_upstream_attempts.status IN ('succeeded','failed','expired','superseded') THEN task_upstream_attempts.status
				ELSE EXCLUDED.status END
		RETURNING id`, input.TaskID, input.TaskAttempt, input.ProviderID, input.RouteID,
		input.RouteKey, input.Adapter, input.UpstreamModel, input.BaseURL, input.APIKeyEncrypted,
		input.TimeoutSecs, input.MaxConcurrency, string(ids), input.Status, input.SubmittedAt,
		input.FailoverAt, input.ExpiresAt).Scan(&id)
	return id, err
}

func SetTaskUpstreamAttemptPending(ctx context.Context, q Q, id uuid.UUID, upstreamTaskIDs []string) error {
	if upstreamTaskIDs == nil {
		upstreamTaskIDs = []string{}
	}
	raw, err := json.Marshal(upstreamTaskIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE task_upstream_attempts
		SET status = 'pending', upstream_task_ids = CASE
			WHEN jsonb_array_length($2::jsonb) > 0 THEN $2::jsonb ELSE upstream_task_ids END
		WHERE id = $1 AND status IN ('submitting','pending')`, id, string(raw))
	return err
}

// ClaimPendingUpstreamTasksByRoute leases attempt rows, not task rows. This is
// what lets an old route keep polling after the task itself has moved to a new
// route or temporarily returned to queued.
func ClaimPendingUpstreamTasksByRoute(ctx context.Context, q Q, routeKey, owner string, now time.Time, lease time.Duration, limit int) ([]*Task, error) {
	if strings.TrimSpace(routeKey) == "" || strings.TrimSpace(owner) == "" {
		return nil, errors.New("attempt polling requires route key and owner")
	}
	if limit < 1 {
		limit = 100
	}
	rows, err := q.Query(ctx, `WITH candidates AS (
		SELECT attempt.id
		FROM task_upstream_attempts attempt
		JOIN tasks task ON task.id = attempt.task_id
		WHERE attempt.route_key = $1
		  AND attempt.status IN ('submitting','pending')
		  AND (attempt.status = 'pending' OR (
			-- The submit HTTP timeout is 10s. Leave a short handoff window for
			-- the submitting worker to publish pending before crash recovery polls
			-- the deterministic OpenAI task ID.
			attempt.submitted_at <= $3::timestamptz - interval '25 seconds'
			AND (attempt.adapter = 'openai'
				OR jsonb_array_length(attempt.upstream_task_ids) > 0
				OR (jsonb_typeof(task.params->'_crunTaskIds') = 'array'
					AND jsonb_array_length(task.params->'_crunTaskIds') > 0))))
		  AND task.status IN ('queued','running')
		  AND (attempt.poll_lease_until IS NULL OR attempt.poll_lease_until < $3 OR attempt.poll_owner = $2)
		ORDER BY attempt.submitted_at, attempt.id
		FOR UPDATE OF attempt SKIP LOCKED
		LIMIT $4
	), claimed AS (
		UPDATE task_upstream_attempts attempt
		SET poll_owner = $2, poll_lease_until = $5, last_polled_at = $3
		FROM candidates
		WHERE attempt.id = candidates.id
		RETURNING attempt.id, attempt.task_id, attempt.provider_id, attempt.route_id,
			attempt.route_key, attempt.adapter, attempt.upstream_model,
			attempt.base_url, attempt.api_key_encrypted, attempt.timeout_secs, attempt.max_concurrency,
			attempt.upstream_task_ids, attempt.submitted_at, attempt.failover_at,
			attempt.expires_at, attempt.failover_scheduled_at
	)
	SELECT * FROM claimed ORDER BY submitted_at, id`, routeKey, owner, now, limit, now.Add(lease))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attempts := make([]claimedUpstreamAttempt, 0, limit)
	taskIDs := make([]uuid.UUID, 0, limit)
	for rows.Next() {
		var attempt claimedUpstreamAttempt
		if err := rows.Scan(&attempt.ID, &attempt.TaskID, &attempt.ProviderID, &attempt.RouteID,
			&attempt.RouteKey, &attempt.Adapter, &attempt.UpstreamModel,
			&attempt.BaseURL, &attempt.APIKeyEncrypted, &attempt.TimeoutSecs, &attempt.MaxConcurrency,
			&attempt.UpstreamTaskIDs, &attempt.SubmittedAt, &attempt.FailoverAt,
			&attempt.ExpiresAt, &attempt.FailoverScheduledAt); err != nil {
			return nil, err
		}
		attempts = append(attempts, attempt)
		taskIDs = append(taskIDs, attempt.TaskID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	tasksByID, err := GetTasksByIDs(ctx, q, taskIDs)
	if err != nil {
		return nil, err
	}
	out := make([]*Task, 0, len(attempts))
	for _, attempt := range attempts {
		original := tasksByID[attempt.TaskID]
		if original == nil {
			continue
		}
		copyTask := *original
		copyTask.Params = make(map[string]any, len(original.Params)+14)
		for key, value := range original.Params {
			copyTask.Params[key] = value
		}
		copyTask.Params["_upstreamAttemptId"] = attempt.ID.String()
		copyTask.Params["_upstreamAttemptPollOwner"] = owner
		copyTask.Params["_upstreamAttemptSubmittedAtMs"] = attempt.SubmittedAt.UnixMilli()
		copyTask.Params["_upstreamAttemptFailoverAtMs"] = attempt.FailoverAt.UnixMilli()
		copyTask.Params["_upstreamAttemptExpiresAtMs"] = attempt.ExpiresAt.UnixMilli()
		copyTask.Params["_upstreamAttemptFailoverScheduled"] = attempt.FailoverScheduledAt != nil
		copyTask.Params["_providerConfigId"] = attempt.ProviderID
		copyTask.Params["_providerRouteId"] = attempt.RouteID
		copyTask.Params["_providerRouteKey"] = attempt.RouteKey
		copyTask.Params["_serviceProvider"] = attempt.Adapter
		copyTask.Params["_upstreamBaseURL"] = attempt.BaseURL
		copyTask.Params["_upstreamAPIKeyEncrypted"] = attempt.APIKeyEncrypted
		copyTask.Params["_upstreamTimeoutSecs"] = attempt.TimeoutSecs
		copyTask.Params["_upstreamMaxConcurrency"] = attempt.MaxConcurrency
		copyTask.Params["_upstreamStage"] = "async_pending"
		upstreamIDs := attempt.UpstreamTaskIDs
		if len(upstreamIDs) == 0 {
			if stored, ok := original.Params["_crunTaskIds"].([]string); ok {
				upstreamIDs = stored
			} else if stored, ok := original.Params["_crunTaskIds"].([]any); ok {
				for _, value := range stored {
					if id, ok := value.(string); ok && strings.TrimSpace(id) != "" {
						upstreamIDs = append(upstreamIDs, strings.TrimSpace(id))
					}
				}
			}
		}
		copyTask.Params["_crunTaskIds"] = append([]string(nil), upstreamIDs...)
		if attempt.UpstreamModel != "" {
			copyTask.Model = attempt.UpstreamModel
		}
		out = append(out, &copyTask)
	}
	return out, nil
}

func ReleaseTaskUpstreamAttemptPoll(ctx context.Context, q Q, id uuid.UUID, owner string) error {
	_, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET poll_owner = NULL, poll_lease_until = NULL
		WHERE id = $1 AND poll_owner = $2`, id, owner)
	return err
}

func RenewTaskUpstreamAttemptPoll(ctx context.Context, q Q, id uuid.UUID, owner string, now time.Time, lease time.Duration) error {
	if strings.TrimSpace(owner) == "" || lease <= 0 {
		return nil
	}
	_, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET poll_lease_until = $3, last_polled_at = $4
		WHERE id = $1 AND poll_owner = $2 AND status IN ('submitting','pending')`,
		id, owner, now.Add(lease), now)
	return err
}

func RenewTaskUpstreamAttemptPolls(ctx context.Context, q Q, ids []uuid.UUID, owners []string, now time.Time, lease time.Duration) error {
	if len(ids) == 0 {
		return nil
	}
	if len(ids) != len(owners) || lease <= 0 {
		return errors.New("batch attempt poll renewal requires matching ids and owners")
	}
	_, err := q.Exec(ctx, `UPDATE task_upstream_attempts AS attempt
		SET poll_lease_until = $3, last_polled_at = $2
		FROM unnest($1::uuid[], $4::text[]) AS renewal(id, owner)
		WHERE attempt.id = renewal.id
		  AND attempt.poll_owner = renewal.owner
		  AND attempt.status IN ('submitting','pending')`,
		ids, now, now.Add(lease), owners)
	return err
}

func MarkTaskUpstreamAttemptFailoverScheduled(ctx context.Context, q Q, id uuid.UUID, now time.Time) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET failover_scheduled_at = $2
		WHERE id = $1 AND status IN ('submitting','pending') AND failover_scheduled_at IS NULL`, id, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func RecordTaskUpstreamAttemptPollError(ctx context.Context, q Q, id uuid.UUID, message string) error {
	_, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET last_error = $2
		WHERE id = $1 AND status IN ('submitting','pending')`, id, message)
	return err
}

func FinishTaskUpstreamAttempt(ctx context.Context, q Q, id uuid.UUID, status, lastError string, now time.Time) (bool, error) {
	if status != UpstreamAttemptSucceeded && status != UpstreamAttemptFailed && status != UpstreamAttemptExpired && status != UpstreamAttemptSuperseded {
		return false, errors.New("invalid terminal upstream attempt status")
	}
	tag, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET status = $2, last_error = $3, finished_at = $4,
			poll_owner = NULL, poll_lease_until = NULL
		WHERE id = $1 AND status IN ('submitting','pending')`, id, status, lastError, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func SupersedeOtherTaskUpstreamAttempts(ctx context.Context, q Q, taskID, winnerID uuid.UUID, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET status = 'superseded', finished_at = $3, poll_owner = NULL, poll_lease_until = NULL
		WHERE task_id = $1 AND id <> $2 AND status IN ('submitting','pending')`, taskID, winnerID, now)
	return err
}

func SupersedePendingTaskUpstreamAttempts(ctx context.Context, q Q, taskID uuid.UUID, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE task_upstream_attempts
		SET status = 'superseded', finished_at = $2, poll_owner = NULL, poll_lease_until = NULL
		WHERE task_id = $1 AND status IN ('submitting','pending')`, taskID, now)
	return err
}

func CountPendingTaskUpstreamAttempts(ctx context.Context, q Q, taskID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM task_upstream_attempts
		WHERE task_id = $1 AND status IN ('submitting','pending')`, taskID).Scan(&count)
	return count, err
}

func PendingTaskUpstreamAttemptRouteKeys(ctx context.Context, q Q, taskID uuid.UUID) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT route_key FROM task_upstream_attempts
		WHERE task_id = $1 AND status IN ('submitting','pending') ORDER BY route_key`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func GetPendingUpstreamAttemptRoute(ctx context.Context, q Q, routeKey string) (*UpstreamAttemptRoute, error) {
	var route UpstreamAttemptRoute
	err := q.QueryRow(ctx, `SELECT provider_id, route_id, route_key, adapter, base_url,
		api_key_encrypted, timeout_secs, max_concurrency
		FROM task_upstream_attempts
		WHERE route_key = $1 AND status IN ('submitting','pending')
		ORDER BY submitted_at DESC LIMIT 1`, routeKey).Scan(&route.ProviderID, &route.RouteID,
		&route.RouteKey, &route.Adapter, &route.BaseURL, &route.APIKeyEncrypted,
		&route.TimeoutSecs, &route.MaxConcurrency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &route, err
}
