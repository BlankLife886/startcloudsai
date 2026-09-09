-- +goose Up
CREATE TABLE user_profile_daily_rollups (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_date date NOT NULL,
    workspace text NOT NULL,
    last_activity_at timestamptz,
    last_success_at timestamptz,
    successful_runs bigint NOT NULL DEFAULT 0,
    failed_runs bigint NOT NULL DEFAULT 0,
    canceled_runs bigint NOT NULL DEFAULT 0,
    successful_units bigint NOT NULL DEFAULT 0,
    durations_ms bigint[] NOT NULL DEFAULT ARRAY[]::bigint[],
    revenue_cents bigint NOT NULL DEFAULT 0,
    upstream_cost_cents bigint NOT NULL DEFAULT 0,
    gross_profit_cents bigint NOT NULL DEFAULT 0,
    calculated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, activity_date, workspace)
);

CREATE INDEX user_profile_daily_rollups_user_date_idx
    ON user_profile_daily_rollups (user_id, activity_date DESC);
CREATE INDEX user_profile_daily_rollups_date_idx
    ON user_profile_daily_rollups (activity_date DESC);

CREATE TABLE user_profile_rollup_dirty (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_date date NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, activity_date)
);
CREATE INDEX user_profile_rollup_dirty_requested_idx
    ON user_profile_rollup_dirty (requested_at, user_id, activity_date);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION user_profile_event_workspace(source_kind text, event_type text, event_params jsonb)
RETURNS text AS $$
    SELECT CASE
        WHEN event_params->>'_source'='react_canvas' OR event_params->>'source'='react_canvas'
            OR event_params->>'workspace'='infinite_canvas' OR event_params->>'_kind' LIKE 'canvas-%' THEN 'canvas'
        WHEN event_type='ecommerce_design' OR event_params->>'workspace' LIKE 'ecommerce%'
            OR event_params->>'_kind' LIKE '%ecommerce%' THEN 'ecommerce'
        WHEN source_kind='assistant' THEN 'assistant'
        ELSE COALESCE(NULLIF(event_type,''), 'other')
    END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
-- +goose StatementEnd

INSERT INTO user_profile_daily_rollups (
    user_id, activity_date, workspace, last_activity_at, last_success_at,
    successful_runs, failed_runs, canceled_runs, successful_units, durations_ms,
    revenue_cents, upstream_cost_cents, gross_profit_cents, calculated_at
)
WITH raw AS (
    SELECT task.user_id, (task.created_at AT TIME ZONE 'Asia/Shanghai')::date AS activity_date,
        user_profile_event_workspace('task', task.type, task.params) AS workspace,
        task.created_at AS activity_at,
        CASE WHEN task.status='succeeded' THEN task.created_at END AS success_at,
        (task.status='succeeded')::int AS successful_runs,
        (task.status='failed')::int AS failed_runs,
        (task.status='canceled')::int AS canceled_runs,
        CASE WHEN task.status='succeeded' THEN GREATEST(task.count,1)::bigint ELSE 0 END AS successful_units,
        CASE WHEN task.status='succeeded' AND task.finished_at IS NOT NULL THEN
            GREATEST(0, (EXTRACT(EPOCH FROM (task.finished_at-COALESCE(task.started_at,task.created_at)))*1000)::bigint)
        END AS duration_ms,
        0::bigint AS revenue_cents, 0::bigint AS upstream_cost_cents, 0::bigint AS gross_profit_cents
    FROM tasks task
    UNION ALL
    SELECT run.user_id, (run.created_at AT TIME ZONE 'Asia/Shanghai')::date,
        user_profile_event_workspace('assistant', run.mode, run.params), run.created_at,
        CASE WHEN run.status='succeeded' THEN run.created_at END,
        (run.status='succeeded')::int, (run.status='failed')::int, (run.status='canceled')::int,
        CASE WHEN run.status='succeeded' THEN 1::bigint ELSE 0 END,
        CASE WHEN run.status='succeeded' AND run.finished_at IS NOT NULL THEN
            GREATEST(0, (EXTRACT(EPOCH FROM (run.finished_at-COALESCE(run.started_at,run.created_at)))*1000)::bigint)
        END,
        0::bigint, 0::bigint, 0::bigint
    FROM assistant_runs run
    UNION ALL
    SELECT behavior.user_id, (behavior.created_at AT TIME ZONE 'Asia/Shanghai')::date,
        behavior.feature, behavior.created_at, NULL::timestamptz,
        0, 0, 0, 0::bigint, NULL::bigint, 0::bigint, 0::bigint, 0::bigint
    FROM user_behavior_events behavior
    UNION ALL
    SELECT ledger.user_id, (ledger.created_at AT TIME ZONE 'Asia/Shanghai')::date,
        COALESCE(NULLIF(ledger.workspace,''),'other'), NULL::timestamptz, NULL::timestamptz,
        0, 0, 0, 0::bigint, NULL::bigint,
        ledger.revenue_cents, ledger.upstream_cost_cents, ledger.gross_profit_cents
    FROM usage_profit_ledger ledger WHERE ledger.user_id IS NOT NULL
)
SELECT user_id, activity_date, workspace, max(activity_at), max(success_at),
    sum(successful_runs), sum(failed_runs), sum(canceled_runs), sum(successful_units),
    COALESCE(array_agg(duration_ms ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL), ARRAY[]::bigint[]),
    sum(revenue_cents), sum(upstream_cost_cents), sum(gross_profit_cents), now()
FROM raw
GROUP BY user_id, activity_date, workspace;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION mark_user_profile_rollup_dirty() RETURNS trigger AS $$
DECLARE
    old_user_id uuid;
    new_user_id uuid;
    old_date date;
    new_date date;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_user_id := OLD.user_id;
        old_date := (OLD.created_at AT TIME ZONE 'Asia/Shanghai')::date;
        IF old_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id=old_user_id) THEN
            INSERT INTO user_profile_rollup_dirty (user_id, activity_date, requested_at)
            VALUES (old_user_id, old_date, now())
            ON CONFLICT (user_id, activity_date) DO UPDATE SET requested_at=EXCLUDED.requested_at;
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_user_id := NEW.user_id;
        new_date := (NEW.created_at AT TIME ZONE 'Asia/Shanghai')::date;
        IF new_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id=new_user_id) THEN
            INSERT INTO user_profile_rollup_dirty (user_id, activity_date, requested_at)
            VALUES (new_user_id, new_date, now())
            ON CONFLICT (user_id, activity_date) DO UPDATE SET requested_at=EXCLUDED.requested_at;
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER tasks_profile_rollup_dirty
AFTER INSERT OR UPDATE OF status, type, params, count, started_at, finished_at, created_at OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION mark_user_profile_rollup_dirty();

CREATE TRIGGER assistant_runs_profile_rollup_dirty
AFTER INSERT OR UPDATE OF status, mode, params, started_at, finished_at, created_at OR DELETE ON assistant_runs
FOR EACH ROW EXECUTE FUNCTION mark_user_profile_rollup_dirty();

CREATE TRIGGER usage_profit_profile_rollup_dirty
AFTER INSERT OR UPDATE OR DELETE ON usage_profit_ledger
FOR EACH ROW EXECUTE FUNCTION mark_user_profile_rollup_dirty();

CREATE TRIGGER user_behavior_profile_rollup_dirty
AFTER INSERT OR UPDATE OF feature, created_at OR DELETE ON user_behavior_events
FOR EACH ROW EXECUTE FUNCTION mark_user_profile_rollup_dirty();

-- +goose Down
DROP TRIGGER IF EXISTS user_behavior_profile_rollup_dirty ON user_behavior_events;
DROP TRIGGER IF EXISTS usage_profit_profile_rollup_dirty ON usage_profit_ledger;
DROP TRIGGER IF EXISTS assistant_runs_profile_rollup_dirty ON assistant_runs;
DROP TRIGGER IF EXISTS tasks_profile_rollup_dirty ON tasks;
DROP FUNCTION IF EXISTS mark_user_profile_rollup_dirty();
DROP TABLE IF EXISTS user_profile_rollup_dirty;
DROP TABLE IF EXISTS user_profile_daily_rollups;
DROP FUNCTION IF EXISTS user_profile_event_workspace(text, text, jsonb);
