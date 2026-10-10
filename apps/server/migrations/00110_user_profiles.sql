-- +goose Up
CREATE TABLE user_profile_metrics (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lifecycle text NOT NULL DEFAULT 'new',
    risk_level text NOT NULL DEFAULT 'low',
    value_tier text NOT NULL DEFAULT 'none',
    primary_workspace text NOT NULL DEFAULT '',
    last_activity_at timestamptz,
    last_success_at timestamptz,
    active_days_7 integer NOT NULL DEFAULT 0,
    active_days_30 integer NOT NULL DEFAULT 0,
    lifetime_successful_runs bigint NOT NULL DEFAULT 0,
    successful_runs_30 bigint NOT NULL DEFAULT 0,
    failed_runs_30 bigint NOT NULL DEFAULT 0,
    canceled_runs_30 bigint NOT NULL DEFAULT 0,
    successful_units_30 bigint NOT NULL DEFAULT 0,
    success_rate_bps_30 integer NOT NULL DEFAULT 0,
    average_duration_ms_30 bigint NOT NULL DEFAULT 0,
    p95_duration_ms_30 bigint NOT NULL DEFAULT 0,
    feature_diversity_30 integer NOT NULL DEFAULT 0,
    revenue_cents_30 bigint NOT NULL DEFAULT 0,
    upstream_cost_cents_30 bigint NOT NULL DEFAULT 0,
    gross_profit_cents_30 bigint NOT NULL DEFAULT 0,
    asset_count bigint NOT NULL DEFAULT 0,
    canvas_project_count bigint NOT NULL DEFAULT 0,
    submission_count bigint NOT NULL DEFAULT 0,
    active_api_key_count bigint NOT NULL DEFAULT 0,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    tag_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
    rule_version integer NOT NULL DEFAULT 1,
    calculated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_profile_lifecycle CHECK (lifecycle IN ('new','activated','active','dormant','churn_risk','returned')),
    CONSTRAINT ck_user_profile_risk CHECK (risk_level IN ('low','medium','high')),
    CONSTRAINT ck_user_profile_value CHECK (value_tier IN ('none','standard','high','loss_making')),
    CONSTRAINT ck_user_profile_tags CHECK (jsonb_typeof(tags) = 'array'),
    CONSTRAINT ck_user_profile_tag_reasons CHECK (jsonb_typeof(tag_reasons) = 'object')
);

CREATE INDEX user_profile_metrics_lifecycle_idx ON user_profile_metrics (lifecycle, calculated_at DESC);
CREATE INDEX user_profile_metrics_risk_idx ON user_profile_metrics (risk_level, calculated_at DESC);
CREATE INDEX user_profile_metrics_profit_idx ON user_profile_metrics (gross_profit_cents_30 DESC, calculated_at DESC);
CREATE INDEX user_profile_metrics_tags_idx ON user_profile_metrics USING gin (tags);

CREATE TABLE user_profile_refresh_queue (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_profile_refresh_queue_requested_idx ON user_profile_refresh_queue (requested_at, user_id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enqueue_user_profile_refresh() RETURNS trigger AS $$
DECLARE
    target_user_id uuid;
BEGIN
    target_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    IF target_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = target_user_id) THEN
        INSERT INTO user_profile_refresh_queue (user_id, requested_at)
        VALUES (target_user_id, now())
        ON CONFLICT (user_id) DO UPDATE SET requested_at = EXCLUDED.requested_at;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enqueue_user_profile_refresh_from_user() RETURNS trigger AS $$
BEGIN
    INSERT INTO user_profile_refresh_queue (user_id, requested_at)
    VALUES (NEW.id, now())
    ON CONFLICT (user_id) DO UPDATE SET requested_at = EXCLUDED.requested_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER users_profile_refresh
AFTER INSERT OR UPDATE OF last_login_at, status ON users
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh_from_user();

CREATE TRIGGER tasks_profile_refresh
AFTER INSERT OR UPDATE OF status, model, count, params, started_at, finished_at OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

CREATE TRIGGER assistant_runs_profile_refresh
AFTER INSERT OR UPDATE OF status, mode, resolved_mode, params, started_at, finished_at OR DELETE ON assistant_runs
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

CREATE TRIGGER usage_profit_profile_refresh
AFTER INSERT OR UPDATE OR DELETE ON usage_profit_ledger
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

CREATE TRIGGER user_assets_profile_refresh
AFTER INSERT OR UPDATE OF deleted_at OR DELETE ON user_assets
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

CREATE TRIGGER canvas_projects_profile_refresh
AFTER INSERT OR UPDATE OR DELETE ON canvas_projects
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

CREATE TRIGGER gallery_submissions_profile_refresh
AFTER INSERT OR UPDATE OF status OR DELETE ON gallery_submissions
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

CREATE TRIGGER user_api_keys_profile_refresh
AFTER INSERT OR UPDATE OF status, expires_at, last_used_at OR DELETE ON user_api_keys
FOR EACH ROW EXECUTE FUNCTION enqueue_user_profile_refresh();

INSERT INTO user_profile_refresh_queue (user_id)
SELECT id FROM users WHERE role = 'user'
ON CONFLICT (user_id) DO NOTHING;

-- +goose Down
DROP TRIGGER IF EXISTS user_api_keys_profile_refresh ON user_api_keys;
DROP TRIGGER IF EXISTS gallery_submissions_profile_refresh ON gallery_submissions;
DROP TRIGGER IF EXISTS canvas_projects_profile_refresh ON canvas_projects;
DROP TRIGGER IF EXISTS user_assets_profile_refresh ON user_assets;
DROP TRIGGER IF EXISTS usage_profit_profile_refresh ON usage_profit_ledger;
DROP TRIGGER IF EXISTS assistant_runs_profile_refresh ON assistant_runs;
DROP TRIGGER IF EXISTS tasks_profile_refresh ON tasks;
DROP TRIGGER IF EXISTS users_profile_refresh ON users;
DROP FUNCTION IF EXISTS enqueue_user_profile_refresh();
DROP FUNCTION IF EXISTS enqueue_user_profile_refresh_from_user();
DROP TABLE IF EXISTS user_profile_refresh_queue;
DROP TABLE IF EXISTS user_profile_metrics;
