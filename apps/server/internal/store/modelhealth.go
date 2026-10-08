package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ModelHealthRetention is how far back the public status page looks; the
// hourly table keeps a little more so the oldest day is always complete.
const (
	ModelHealthRetention     = 30 * 24 * time.Hour
	modelHealthKeep          = 31 * 24 * time.Hour
	modelHealthRecomputeBack = time.Hour
)

// ModelHealthAgg is one model's outcome counts and latency over a window.
// Failed counts platform and upstream failures; Excluded holds outcomes the
// user caused (cancel, content policy), which do not count against stability.
// Latency is a whole image generation for image models and the model-call
// time of a turn for chat models; TTFT and the token speed exist only for chat.
// Speed is images per minute for image models and output tokens per second
// for chat models. PriceCents is the median unit price (credits per image or
// per chat turn) recorded on the calls themselves.
type ModelHealthAgg struct {
	ModelID      string
	Bucket       time.Time
	Succeeded    int
	Failed       int
	Excluded     int
	LatencyP50Ms *int
	LatencyP95Ms *int
	TTFTP50Ms    *int
	TTFTP95Ms    *int
	SpeedP50     *float64
	PriceCents   *int64
	// Window-only means (not stored hourly): whole-generation latency, and
	// latency divided by the images it returned (image models only).
	LatencyAvgMs  *int
	PerImageAvgMs *int
}

// modelHealthSamplesSQL yields one row per finished generation in
// [$1, $2): image tasks attribute to the public model that served them
// (params._modelConfigId), assistant chat/agent turns to their chat model.
// Assistant mirror tasks (type 'assistant') and image-mode assistant runs are
// left out so nothing is counted twice.
var modelHealthSamplesSQL = strings.NewReplacer(
	"{{task_user_caused}}", modelHealthUserCausedSQL("error_code"),
	"{{run_user_caused}}", modelHealthUserCausedSQL("run.error_code"),
).Replace(`
WITH samples AS (
	SELECT params->>'_modelConfigId' AS model_id, finished_at,
		CASE
			WHEN status = 'succeeded' THEN 's'
			WHEN status = 'canceled' OR {{task_user_caused}} THEN 'x'
			ELSE 'f'
		END AS outcome,
		CASE WHEN status = 'succeeded' AND started_at IS NOT NULL AND finished_at > started_at
			THEN extract(epoch FROM finished_at - started_at) * 1000 END AS latency_ms,
		NULL::double precision AS ttft_ms,
		CASE WHEN status = 'succeeded' AND started_at IS NOT NULL AND finished_at > started_at
				AND jsonb_typeof(output_keys) = 'array' AND jsonb_array_length(output_keys) > 0
			THEN jsonb_array_length(output_keys) * 60.0 / extract(epoch FROM finished_at - started_at) END AS speed,
		CASE WHEN status = 'succeeded' AND started_at IS NOT NULL AND finished_at > started_at
				AND jsonb_typeof(output_keys) = 'array' AND jsonb_array_length(output_keys) > 0
			THEN extract(epoch FROM finished_at - started_at) * 1000 / jsonb_array_length(output_keys) END AS per_image_ms,
		CASE WHEN jsonb_typeof(params->'_modelEffectivePriceCents') = 'number'
			THEN (params->>'_modelEffectivePriceCents')::double precision END AS price
	FROM tasks
	WHERE finished_at >= $1 AND finished_at < $2
		AND status IN ('succeeded', 'failed', 'canceled')
		AND type <> 'assistant'
		AND COALESCE(params->>'_modelConfigId', '') <> ''
	UNION ALL
	SELECT run.params->>'_chatModelConfigId', run.finished_at,
		CASE
			WHEN run.status = 'succeeded' THEN 's'
			WHEN run.status = 'canceled' OR {{run_user_caused}} THEN 'x'
			ELSE 'f'
		END,
		CASE WHEN run.status = 'succeeded' AND jsonb_typeof(msg.metadata->'usage'->'durationMs') = 'number'
			THEN (msg.metadata->'usage'->>'durationMs')::double precision END,
		CASE WHEN run.status = 'succeeded' AND jsonb_typeof(msg.metadata->'usage'->'firstTokenMs') = 'number'
			THEN (msg.metadata->'usage'->>'firstTokenMs')::double precision END,
		CASE WHEN run.status = 'succeeded'
				AND jsonb_typeof(msg.metadata->'usage'->'durationMs') = 'number'
				AND jsonb_typeof(msg.metadata->'usage'->'outputTokens') = 'number'
				AND (msg.metadata->'usage'->>'durationMs')::double precision > 0
			THEN (msg.metadata->'usage'->>'outputTokens')::double precision * 1000
				/ (msg.metadata->'usage'->>'durationMs')::double precision END,
		NULL::double precision,
		CASE WHEN jsonb_typeof(run.params->'_chatModelEffectivePriceCents') = 'number'
			THEN (run.params->>'_chatModelEffectivePriceCents')::double precision END
	FROM assistant_runs run
	LEFT JOIN assistant_messages msg ON msg.id = run.assistant_message_id
	WHERE run.finished_at >= $1 AND run.finished_at < $2
		AND run.status IN ('succeeded', 'failed', 'canceled')
		AND run.mode <> 'image' AND COALESCE(run.resolved_mode, '') <> 'image'
		AND COALESCE(run.params->>'_chatModelConfigId', '') <> ''
)`)

const modelHealthAggregateColumns = `
	count(*) FILTER (WHERE outcome = 's')::int,
	count(*) FILTER (WHERE outcome = 'f')::int,
	count(*) FILTER (WHERE outcome = 'x')::int,
	round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms))::int,
	round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::int,
	round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft_ms))::int,
	round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft_ms))::int,
	percentile_cont(0.5) WITHIN GROUP (ORDER BY speed),
	round(percentile_disc(0.5) WITHIN GROUP (ORDER BY price))::bigint`

// modelHealthUserCausedSQL matches failures the user caused rather than the
// model or the platform.
func modelHealthUserCausedSQL(column string) string {
	return fmt.Sprintf(`(COALESCE(%[1]s, '') IN ('user_canceled', 'admin_force_failed')
		OR COALESCE(%[1]s, '') LIKE 'content_policy%%'
		OR COALESCE(%[1]s, '') LIKE 'invalid%%'
		OR COALESCE(%[1]s, '') LIKE 'validation%%'
		OR COALESCE(%[1]s, '') LIKE 'insufficient%%')`, column)
}

// ModelHealthWindow aggregates every model over [from, to) straight from the
// source tables. The status page uses it for the live and 24-hour figures.
func ModelHealthWindow(ctx context.Context, q Q, from, to time.Time) (map[string]ModelHealthAgg, error) {
	rows, err := q.Query(ctx, modelHealthSamplesSQL+`
		SELECT model_id,`+modelHealthAggregateColumns+`,
			round(avg(latency_ms))::int, round(avg(per_image_ms))::int
		FROM samples GROUP BY model_id`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]ModelHealthAgg{}
	for rows.Next() {
		var item ModelHealthAgg
		if err := rows.Scan(&item.ModelID, &item.Succeeded, &item.Failed, &item.Excluded,
			&item.LatencyP50Ms, &item.LatencyP95Ms, &item.TTFTP50Ms, &item.TTFTP95Ms, &item.SpeedP50, &item.PriceCents,
			&item.LatencyAvgMs, &item.PerImageAvgMs); err != nil {
			return nil, err
		}
		out[item.ModelID] = item
	}
	return out, rows.Err()
}

// RefreshModelHealthHourly recomputes the hourly buckets from the last stored
// one (minus an hour, since that hour may have been partial) up to now, or
// backfills the whole retention window on an empty table. Rows are bucketed by
// finish time, so a closed hour never changes after it has been recomputed.
func RefreshModelHealthHourly(ctx context.Context, tx pgx.Tx, now time.Time) (time.Time, error) {
	now = now.UTC()
	oldest := now.Add(-ModelHealthRetention).Truncate(time.Hour)
	from := oldest
	// Two workers may run the job at once; the delete-then-insert must not interleave.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('model_health_hourly'))`); err != nil {
		return time.Time{}, err
	}
	var last *time.Time
	if err := tx.QueryRow(ctx, `SELECT max(bucket) FROM model_health_hourly`).Scan(&last); err != nil {
		return time.Time{}, err
	}
	if last != nil {
		from = last.UTC().Add(-modelHealthRecomputeBack)
		if from.Before(oldest) {
			from = oldest
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM model_health_hourly WHERE bucket >= $1 OR bucket < $2`,
		from, now.Add(-modelHealthKeep)); err != nil {
		return time.Time{}, err
	}
	_, err := tx.Exec(ctx, modelHealthSamplesSQL+`
		INSERT INTO model_health_hourly (
			model_id, bucket, succeeded, failed, excluded,
			latency_p50_ms, latency_p95_ms, ttft_p50_ms, ttft_p95_ms, speed_p50, price_cents, updated_at
		)
		SELECT model_id, date_trunc('hour', finished_at),`+modelHealthAggregateColumns+`, now()
		FROM samples GROUP BY 1, 2`, from, now)
	return from, err
}

// ListModelHealthHourly returns the stored buckets since the given time,
// oldest first.
func ListModelHealthHourly(ctx context.Context, q Q, since time.Time) ([]ModelHealthAgg, error) {
	rows, err := q.Query(ctx, `SELECT model_id, bucket, succeeded, failed, excluded,
			latency_p50_ms, latency_p95_ms, ttft_p50_ms, ttft_p95_ms, speed_p50, price_cents
		FROM model_health_hourly WHERE bucket >= $1 ORDER BY bucket`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModelHealthAgg{}
	for rows.Next() {
		var item ModelHealthAgg
		if err := rows.Scan(&item.ModelID, &item.Bucket, &item.Succeeded, &item.Failed, &item.Excluded,
			&item.LatencyP50Ms, &item.LatencyP95Ms, &item.TTFTP50Ms, &item.TTFTP95Ms, &item.SpeedP50, &item.PriceCents); err != nil {
			return nil, err
		}
		item.Bucket = item.Bucket.UTC()
		out = append(out, item)
	}
	return out, rows.Err()
}
