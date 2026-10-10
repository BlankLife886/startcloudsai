package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	ImageSlotMemberHealthy = "healthy"
	ImageSlotMemberDown    = "down"

	ImageSlotEventSwitch      = "switch"
	ImageSlotEventAllDown     = "all_down"
	ImageSlotEventManual      = "manual"
	ImageSlotEventMemberDown  = "member_down"
	ImageSlotEventMemberUp    = "member_up"
	ImageSlotEventProbe       = "probe"
	ImageSlotEventMemberReset = "member_reset"
)

// ImageSlotMemberHealth is one model's health at one resolution.
type ImageSlotMemberHealth struct {
	ModelID             string     `json:"modelId"`
	Resolution          string     `json:"resolution"`
	Status              string     `json:"status"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	LastFailureAt       *time.Time `json:"lastFailureAt"`
	LastFailureMessage  string     `json:"lastFailureMessage"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt"`
	DownSince           *time.Time `json:"downSince"`
	LastProbeAt         *time.Time `json:"lastProbeAt"`
	LastProbeOK         *bool      `json:"lastProbeOk"`
	LastProbeMessage    string     `json:"lastProbeMessage"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

// Down reports whether the member is currently judged failed.
func (h *ImageSlotMemberHealth) Down() bool {
	return h != nil && h.Status == ImageSlotMemberDown
}

// ImageSlotState is the model a public model's resolution slot is using.
type ImageSlotState struct {
	ModelID       string     `json:"modelId"`
	Resolution    string     `json:"resolution"`
	ActiveModelID string     `json:"activeModelId"`
	AllDown       bool       `json:"allDown"`
	ManualModelID *string    `json:"manualModelId"`
	SwitchedAt    *time.Time `json:"switchedAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

// ImageSlotEvent is one switch, failure, recovery or probe record.
type ImageSlotEvent struct {
	ID            int64     `json:"id"`
	ModelID       string    `json:"modelId"`
	Resolution    string    `json:"resolution"`
	Kind          string    `json:"kind"`
	MemberModelID string    `json:"memberModelId"`
	FromModelID   string    `json:"fromModelId"`
	ToModelID     string    `json:"toModelId"`
	OK            *bool     `json:"ok"`
	Message       string    `json:"message"`
	CreatedAt     time.Time `json:"createdAt"`
}

// ImageSlotKey addresses a model at a resolution.
type ImageSlotKey struct{ ModelID, Resolution string }

// LockImageSlots serializes slot state changes across API and worker replicas.
func LockImageSlots(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('image_resolution_slots'))`)
	return err
}

const imageSlotHealthCols = `model_id, resolution, status, consecutive_failures, last_failure_at,
	last_failure_message, last_success_at, down_since, last_probe_at, last_probe_ok,
	last_probe_message, updated_at`

func scanImageSlotHealth(row pgx.Row) (ImageSlotMemberHealth, error) {
	var h ImageSlotMemberHealth
	err := row.Scan(&h.ModelID, &h.Resolution, &h.Status, &h.ConsecutiveFailures, &h.LastFailureAt,
		&h.LastFailureMessage, &h.LastSuccessAt, &h.DownSince, &h.LastProbeAt, &h.LastProbeOK,
		&h.LastProbeMessage, &h.UpdatedAt)
	return h, err
}

// ListImageSlotMemberHealth returns every recorded member health row.
func ListImageSlotMemberHealth(ctx context.Context, q Q) (map[ImageSlotKey]ImageSlotMemberHealth, error) {
	rows, err := q.Query(ctx, `SELECT `+imageSlotHealthCols+` FROM image_slot_member_health`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[ImageSlotKey]ImageSlotMemberHealth{}
	for rows.Next() {
		h, err := scanImageSlotHealth(rows)
		if err != nil {
			return nil, err
		}
		out[ImageSlotKey{h.ModelID, h.Resolution}] = h
	}
	return out, rows.Err()
}

// RecordImageSlotMemberFailure counts one failure and marks the member down
// once threshold consecutive failures are reached. It reports a transition.
func RecordImageSlotMemberFailure(ctx context.Context, q Q, key ImageSlotKey, message string, threshold int, at time.Time) (bool, error) {
	if threshold < 1 {
		threshold = 1
	}
	var wentDown bool
	err := q.QueryRow(ctx, `
		WITH prior AS (
			SELECT status FROM image_slot_member_health WHERE model_id = $1 AND resolution = $2 FOR UPDATE
		), upserted AS (
			INSERT INTO image_slot_member_health
				(model_id, resolution, status, consecutive_failures, last_failure_at, last_failure_message, down_since, updated_at)
			VALUES ($1, $2, CASE WHEN $5 <= 1 THEN 'down' ELSE 'healthy' END, 1, $3, $4,
				CASE WHEN $5 <= 1 THEN $3::timestamptz END, $3)
			ON CONFLICT (model_id, resolution) DO UPDATE SET
				consecutive_failures = image_slot_member_health.consecutive_failures + 1,
				last_failure_at = EXCLUDED.last_failure_at,
				last_failure_message = EXCLUDED.last_failure_message,
				status = CASE WHEN image_slot_member_health.consecutive_failures + 1 >= $5 THEN 'down'
					ELSE image_slot_member_health.status END,
				down_since = CASE
					WHEN image_slot_member_health.status = 'down' THEN image_slot_member_health.down_since
					WHEN image_slot_member_health.consecutive_failures + 1 >= $5 THEN EXCLUDED.last_failure_at
					ELSE NULL END,
				updated_at = EXCLUDED.updated_at
			RETURNING status
		)
		SELECT (SELECT status FROM upserted) = 'down' AND COALESCE((SELECT status FROM prior), 'healthy') <> 'down'`,
		key.ModelID, key.Resolution, at, truncateSlotMessage(message), threshold).Scan(&wentDown)
	return wentDown, err
}

// RecordImageSlotMemberSuccess clears the failure streak; it reports whether
// the member came back from down.
func RecordImageSlotMemberSuccess(ctx context.Context, q Q, key ImageSlotKey, at time.Time) (bool, error) {
	var wasDown bool
	err := q.QueryRow(ctx, `
		WITH prior AS (
			SELECT status FROM image_slot_member_health WHERE model_id = $1 AND resolution = $2 FOR UPDATE
		), upserted AS (
			INSERT INTO image_slot_member_health (model_id, resolution, status, consecutive_failures, last_success_at, updated_at)
			VALUES ($1, $2, 'healthy', 0, $3, $3)
			ON CONFLICT (model_id, resolution) DO UPDATE SET
				status = 'healthy', consecutive_failures = 0, down_since = NULL,
				last_success_at = EXCLUDED.last_success_at, updated_at = EXCLUDED.updated_at
			-- Every successful task lands here; skip the write for a member
			-- that is already healthy and was seen succeeding a moment ago.
			WHERE image_slot_member_health.status <> 'healthy'
				OR image_slot_member_health.consecutive_failures <> 0
				OR image_slot_member_health.last_success_at IS NULL
				OR image_slot_member_health.last_success_at < EXCLUDED.last_success_at - interval '1 minute'
			RETURNING 1
		)
		SELECT COALESCE((SELECT status FROM prior), 'healthy') = 'down'`,
		key.ModelID, key.Resolution, at).Scan(&wasDown)
	return wasDown, err
}

// RecordImageSlotMemberProbe stores a probe outcome. A passing probe also
// restores the member; a failing one keeps it down.
func RecordImageSlotMemberProbe(ctx context.Context, q Q, key ImageSlotKey, ok bool, message string, at time.Time) error {
	_, err := q.Exec(ctx, `
		INSERT INTO image_slot_member_health
			(model_id, resolution, status, last_probe_at, last_probe_ok, last_probe_message, updated_at)
		VALUES ($1, $2, 'healthy', $3, $4, $5, $3)
		ON CONFLICT (model_id, resolution) DO UPDATE SET
			last_probe_at = EXCLUDED.last_probe_at,
			last_probe_ok = EXCLUDED.last_probe_ok,
			last_probe_message = EXCLUDED.last_probe_message,
			updated_at = EXCLUDED.updated_at`,
		key.ModelID, key.Resolution, at, ok, truncateSlotMessage(message))
	return err
}

// ListImageSlotStates returns every stored slot state.
func ListImageSlotStates(ctx context.Context, q Q) (map[ImageSlotKey]ImageSlotState, error) {
	rows, err := q.Query(ctx, `
		SELECT model_id, resolution, active_model_id, all_down, manual_model_id, switched_at, updated_at
		FROM image_slot_states`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[ImageSlotKey]ImageSlotState{}
	for rows.Next() {
		var s ImageSlotState
		if err := rows.Scan(&s.ModelID, &s.Resolution, &s.ActiveModelID, &s.AllDown, &s.ManualModelID, &s.SwitchedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out[ImageSlotKey{s.ModelID, s.Resolution}] = s
	}
	return out, rows.Err()
}

// SaveImageSlotState writes a slot's active model. switched_at moves only when
// the active model changes; a new row gets it only when switched says the
// slot starts away from its primary.
func SaveImageSlotState(ctx context.Context, q Q, state ImageSlotState, at time.Time, switched bool) error {
	_, err := q.Exec(ctx, `
		INSERT INTO image_slot_states (model_id, resolution, active_model_id, all_down, manual_model_id, switched_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, CASE WHEN $8 THEN $6::timestamptz END, $7)
		ON CONFLICT (model_id, resolution) DO UPDATE SET
			switched_at = CASE WHEN image_slot_states.active_model_id <> EXCLUDED.active_model_id
				THEN EXCLUDED.switched_at ELSE image_slot_states.switched_at END,
			active_model_id = EXCLUDED.active_model_id,
			all_down = EXCLUDED.all_down,
			manual_model_id = EXCLUDED.manual_model_id,
			updated_at = EXCLUDED.updated_at`,
		state.ModelID, state.Resolution, state.ActiveModelID, state.AllDown, state.ManualModelID, at, at, switched)
	return err
}

// ResetImageSlotMember marks a member healthy by hand (adapters the probe
// cannot exercise, or an admin who fixed the upstream).
func ResetImageSlotMember(ctx context.Context, q Q, key ImageSlotKey, at time.Time) error {
	_, err := q.Exec(ctx, `
		UPDATE image_slot_member_health
		SET status = 'healthy', consecutive_failures = 0, down_since = NULL, updated_at = $3
		WHERE model_id = $1 AND resolution = $2`, key.ModelID, key.Resolution, at)
	return err
}

// InsertImageSlotEvent appends one history record.
func InsertImageSlotEvent(ctx context.Context, q Q, event ImageSlotEvent) error {
	if event.CreatedAt.IsZero() {
		return errors.New("image slot event needs a time")
	}
	_, err := q.Exec(ctx, `
		INSERT INTO image_slot_events
			(model_id, resolution, kind, member_model_id, from_model_id, to_model_id, ok, message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		event.ModelID, event.Resolution, event.Kind, event.MemberModelID, event.FromModelID, event.ToModelID,
		event.OK, truncateSlotMessage(event.Message), event.CreatedAt)
	return err
}

// ListImageSlotEvents returns the newest events; empty modelID lists all.
func ListImageSlotEvents(ctx context.Context, q Q, limit int) ([]ImageSlotEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := q.Query(ctx, `
		SELECT id, model_id, resolution, kind, member_model_id, from_model_id, to_model_id, ok, message, created_at
		FROM image_slot_events ORDER BY created_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ImageSlotEvent{}
	for rows.Next() {
		var e ImageSlotEvent
		if err := rows.Scan(&e.ID, &e.ModelID, &e.Resolution, &e.Kind, &e.MemberModelID, &e.FromModelID, &e.ToModelID, &e.OK, &e.Message, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CountImageSlotProbesSince counts probes for the daily budget.
func CountImageSlotProbesSince(ctx context.Context, q Q, since time.Time) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM image_slot_events WHERE kind = 'probe' AND created_at >= $1`, since).Scan(&count)
	return count, err
}

// PruneImageSlotEvents keeps the history bounded.
func PruneImageSlotEvents(ctx context.Context, q Q, before time.Time) error {
	_, err := q.Exec(ctx, `DELETE FROM image_slot_events WHERE created_at < $1`, before)
	return err
}

func truncateSlotMessage(message string) string {
	runes := []rune(message)
	if len(runes) > 500 {
		return string(runes[:500])
	}
	return message
}
