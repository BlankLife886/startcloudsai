package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type UserBehaviorEventInput struct {
	ClientEventID uuid.UUID
	EventName     string
	Feature       string
	Metadata      map[string]any
}

type UserBehaviorFunnelStep struct {
	Feature     string `json:"feature"`
	Opens       int64  `json:"opens"`
	Submissions int64  `json:"submissions"`
	Succeeded   int64  `json:"succeeded"`
	Failed      int64  `json:"failed"`
	Canceled    int64  `json:"canceled"`
}

type UserBehaviorFunnel struct {
	Days                     int                      `json:"days"`
	TrackingSince            *time.Time               `json:"trackingSince"`
	Opens                    int64                    `json:"opens"`
	Submissions              int64                    `json:"submissions"`
	Succeeded                int64                    `json:"succeeded"`
	Failed                   int64                    `json:"failed"`
	Canceled                 int64                    `json:"canceled"`
	ReferenceUploadsStarted  int64                    `json:"referenceUploadsStarted"`
	ReferenceUploadsComplete int64                    `json:"referenceUploadsCompleted"`
	ReferenceUploadsFailed   int64                    `json:"referenceUploadsFailed"`
	FormStarts               int64                    `json:"formStarts"`
	FormAbandons             int64                    `json:"formAbandons"`
	PromptTemplatesUsed      int64                    `json:"promptTemplatesUsed"`
	SubmitRateBPS            int                      `json:"submitRateBps"`
	SuccessRateBPS           int                      `json:"successRateBps"`
	Features                 []UserBehaviorFunnelStep `json:"features"`
}

func InsertUserBehaviorEvents(ctx context.Context, q Q, userID uuid.UUID, events []UserBehaviorEventInput) (int64, error) {
	if userID == uuid.Nil || len(events) == 0 {
		return 0, nil
	}
	values := make([]string, 0, len(events))
	args := make([]any, 0, len(events)*5)
	for i, event := range events {
		if event.Metadata == nil {
			event.Metadata = map[string]any{}
		}
		metadata, err := json.Marshal(event.Metadata)
		if err != nil {
			return 0, err
		}
		base := i*5 + 1
		values = append(values, fmt.Sprintf("($%d,$%d,$%d,$%d,$%d)", base, base+1, base+2, base+3, base+4))
		args = append(args, userID, event.ClientEventID, event.EventName, event.Feature, metadata)
	}
	tag, err := q.Exec(ctx, `INSERT INTO user_behavior_events
		(user_id, client_event_id, event_name, feature, metadata) VALUES `+strings.Join(values, ",")+`
		ON CONFLICT (user_id, client_event_id) DO NOTHING`, args...)
	if err != nil {
		return 0, err
	}
	inserted := tag.RowsAffected()
	if inserted > 0 {
		_, err = q.Exec(ctx, `INSERT INTO user_profile_refresh_queue (user_id, requested_at)
			VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET requested_at=EXCLUDED.requested_at`, userID)
	}
	return inserted, err
}

func DeleteUserBehaviorEventsBefore(ctx context.Context, q Q, cutoff time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM user_behavior_events WHERE created_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func UserBehaviorFunnel30(ctx context.Context, q Q, userID uuid.UUID) (*UserBehaviorFunnel, error) {
	var trackingSince *time.Time
	if err := q.QueryRow(ctx, `SELECT min(created_at) FROM user_behavior_events
		WHERE user_id=$1 AND created_at>=now()-interval '30 days'`, userID).Scan(&trackingSince); err != nil {
		return nil, err
	}
	cutoff := time.Now().UTC()
	if trackingSince != nil {
		cutoff = *trackingSince
	}
	rows, err := q.Query(ctx, `WITH behavior AS (
		SELECT feature, count(*) FILTER (WHERE event_name='feature_open') AS opens
		FROM user_behavior_events
		WHERE user_id=$1 AND created_at>=$2
		GROUP BY feature
	), runs AS (
		SELECT CASE
			WHEN task.params->>'_source'='react_canvas' OR task.params->>'source'='react_canvas'
				OR task.params->>'workspace'='infinite_canvas' OR task.params->>'_kind' LIKE 'canvas-%' THEN 'canvas'
			WHEN task.type='ecommerce_design' OR task.params->>'workspace' LIKE 'ecommerce%'
				OR task.params->>'_kind' LIKE '%ecommerce%' THEN 'ecommerce'
			WHEN task.type='t2i' THEN 'text_to_image'
			WHEN task.type='coloring' THEN 'coloring'
			WHEN task.type='ui_design' THEN 'design_workshop'
			WHEN task.type='model_sheet' THEN 'model_sheet'
			WHEN task.type='game_art' THEN 'game_art'
			WHEN task.type='background_remove' THEN 'background_remove'
			WHEN task.type IN ('media_tool','puzzle') THEN 'media_tools'
			ELSE 'other' END AS feature, task.status
		FROM tasks task WHERE task.user_id=$1 AND task.created_at>=$2
		UNION ALL
		SELECT CASE WHEN run.params->>'_source'='react_canvas' OR run.params->>'source'='react_canvas'
			OR run.params->>'workspace'='infinite_canvas' OR run.params->>'_kind' LIKE 'canvas-%'
			THEN 'canvas' ELSE 'assistant' END, run.status
		FROM assistant_runs run WHERE run.user_id=$1 AND run.created_at>=$2
	), run_rollup AS (
		SELECT feature, count(*) AS submissions,
			count(*) FILTER (WHERE status='succeeded') AS succeeded,
			count(*) FILTER (WHERE status='failed') AS failed,
			count(*) FILTER (WHERE status='canceled') AS canceled
		FROM runs GROUP BY feature
	), features AS (
		SELECT feature FROM behavior UNION SELECT feature FROM run_rollup
	)
	SELECT features.feature, COALESCE(behavior.opens,0), COALESCE(run_rollup.submissions,0),
		COALESCE(run_rollup.succeeded,0), COALESCE(run_rollup.failed,0), COALESCE(run_rollup.canceled,0)
	FROM features LEFT JOIN behavior USING(feature) LEFT JOIN run_rollup USING(feature)
	ORDER BY COALESCE(run_rollup.submissions,0) DESC, COALESCE(behavior.opens,0) DESC, features.feature`, userID, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := &UserBehaviorFunnel{Days: 30, TrackingSince: trackingSince, Features: []UserBehaviorFunnelStep{}}
	for rows.Next() {
		var item UserBehaviorFunnelStep
		if err := rows.Scan(&item.Feature, &item.Opens, &item.Submissions, &item.Succeeded, &item.Failed, &item.Canceled); err != nil {
			return nil, err
		}
		result.Features = append(result.Features, item)
		result.Opens += item.Opens
		result.Submissions += item.Submissions
		result.Succeeded += item.Succeeded
		result.Failed += item.Failed
		result.Canceled += item.Canceled
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE event_name='reference_upload_started'),
		count(*) FILTER (WHERE event_name='reference_upload_completed'),
		count(*) FILTER (WHERE event_name='reference_upload_failed'),
		count(*) FILTER (WHERE event_name='form_started'),
		count(*) FILTER (WHERE event_name='form_abandoned')
		FROM user_behavior_events WHERE user_id=$1 AND created_at>=$2`, userID, cutoff).Scan(
		&result.ReferenceUploadsStarted, &result.ReferenceUploadsComplete, &result.ReferenceUploadsFailed,
		&result.FormStarts, &result.FormAbandons,
	); err != nil {
		return nil, err
	}
	if err := q.QueryRow(ctx, `SELECT count(*) FROM prompt_user_engagement
		WHERE user_id=$1 AND last_used_at>=now()-interval '30 days'`, userID).Scan(&result.PromptTemplatesUsed); err != nil {
		return nil, err
	}
	if result.Opens > 0 {
		result.SubmitRateBPS = int(result.Submissions * 10000 / result.Opens)
	}
	if result.Submissions > 0 {
		result.SuccessRateBPS = int(result.Succeeded * 10000 / result.Submissions)
	}
	return result, nil
}
