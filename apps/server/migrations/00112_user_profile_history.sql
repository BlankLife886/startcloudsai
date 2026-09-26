-- +goose Up
CREATE TABLE user_profile_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lifecycle text NOT NULL,
    risk_level text NOT NULL,
    value_tier text NOT NULL,
    primary_workspace text NOT NULL DEFAULT '',
    active_days_30 integer NOT NULL DEFAULT 0,
    successful_runs_30 bigint NOT NULL DEFAULT 0,
    failed_runs_30 bigint NOT NULL DEFAULT 0,
    success_rate_bps_30 integer NOT NULL DEFAULT 0,
    revenue_cents_30 bigint NOT NULL DEFAULT 0,
    gross_profit_cents_30 bigint NOT NULL DEFAULT 0,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    calculated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_profile_history_lifecycle CHECK (lifecycle IN ('new','activated','active','dormant','churn_risk','returned')),
    CONSTRAINT ck_user_profile_history_risk CHECK (risk_level IN ('low','medium','high')),
    CONSTRAINT ck_user_profile_history_value CHECK (value_tier IN ('none','standard','high','loss_making')),
    CONSTRAINT ck_user_profile_history_tags CHECK (jsonb_typeof(tags) = 'array')
);

CREATE INDEX user_profile_history_user_calculated_idx
    ON user_profile_history (user_id, calculated_at DESC);
CREATE INDEX user_profile_history_lifecycle_calculated_idx
    ON user_profile_history (lifecycle, calculated_at DESC);
CREATE INDEX user_profile_history_risk_calculated_idx
    ON user_profile_history (risk_level, calculated_at DESC);

INSERT INTO user_profile_history (
    user_id, lifecycle, risk_level, value_tier, primary_workspace, active_days_30,
    successful_runs_30, failed_runs_30, success_rate_bps_30, revenue_cents_30,
    gross_profit_cents_30, tags, calculated_at
)
SELECT user_id, lifecycle, risk_level, value_tier, primary_workspace, active_days_30,
    successful_runs_30, failed_runs_30, success_rate_bps_30, revenue_cents_30,
    gross_profit_cents_30, tags, calculated_at
FROM user_profile_metrics;

-- +goose Down
DROP TABLE IF EXISTS user_profile_history;
