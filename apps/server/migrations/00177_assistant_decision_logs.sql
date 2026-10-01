-- +goose Up
-- AI 助手 v2 每一轮的判断记录：用于影子对比（模型判断 vs 规则判断）、评估置信度阈值、
-- 观察耗时与兜底率。只存判断结果，不存用户输入（输入在 assistant_runs.prompt）。
CREATE TABLE assistant_decision_logs (
    id bigserial PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    model text NOT NULL DEFAULT '',
    intent text NOT NULL,
    confidence double precision NOT NULL DEFAULT 0,
    rules_intent text NOT NULL DEFAULT '',
    clarify boolean NOT NULL DEFAULT false,
    low_confidence boolean NOT NULL DEFAULT false,
    used_fallback boolean NOT NULL DEFAULT false,
    delegated boolean NOT NULL DEFAULT false,
    latency_ms integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_assistant_decision_logs_created ON assistant_decision_logs (created_at DESC);
CREATE INDEX ix_assistant_decision_logs_run ON assistant_decision_logs (run_id);

-- +goose Down
DROP TABLE IF EXISTS assistant_decision_logs;
