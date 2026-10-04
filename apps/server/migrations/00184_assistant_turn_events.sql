-- +goose Up
-- AI 助手质量改为由用户行为驱动：不再由管理员逐条复核。
-- 每一轮发生的事（用户一键纠正、出图方案被执行、按了停止、出图后马上删图、点踩、紧接着用文字纠正）
-- 在发生时记一行；后台只看比例和趋势，用户的一键纠正同时变成回归用例。
DROP TABLE IF EXISTS assistant_turn_reviews CASCADE;

CREATE TABLE assistant_turn_events (
    id bigserial PRIMARY KEY,
    assistant_message_id uuid NOT NULL,
    run_id uuid,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    mode text NOT NULL DEFAULT '',
    model text NOT NULL DEFAULT '',
    prompt_version text NOT NULL DEFAULT '',
    event text NOT NULL,
    -- 一键纠正时：这一轮实际做了什么、用户说本该做什么（answer / image / web …）。
    got text NOT NULL DEFAULT '',
    expected text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (assistant_message_id, event)
);
CREATE INDEX ix_assistant_turn_events_created ON assistant_turn_events (created_at DESC);

-- 质量指标按时间窗口统计 v2 回合，只扫这一部分。
CREATE INDEX ix_assistant_runs_v2_created ON assistant_runs (created_at) WHERE params->>'_engine' = 'v2';

-- 回归用例由用户的一键纠正产生：同一模式下同一句话只留一条（prompt_key 是规范化后的原话）。
ALTER TABLE assistant_agent_cases DROP COLUMN IF EXISTS review_id;
ALTER TABLE assistant_agent_cases ADD COLUMN source_message_id uuid;
ALTER TABLE assistant_agent_cases ADD COLUMN prompt_key text NOT NULL DEFAULT '';
UPDATE assistant_agent_cases SET prompt_key = md5(lower(btrim(prompt)));
DELETE FROM assistant_agent_cases older USING assistant_agent_cases newer
WHERE older.mode = newer.mode AND older.prompt_key = newer.prompt_key AND older.created_at < newer.created_at;
CREATE UNIQUE INDEX ux_assistant_agent_cases_prompt ON assistant_agent_cases (mode, prompt_key);

-- +goose Down
DROP INDEX IF EXISTS ux_assistant_agent_cases_prompt;
ALTER TABLE assistant_agent_cases DROP COLUMN IF EXISTS prompt_key;
ALTER TABLE assistant_agent_cases DROP COLUMN IF EXISTS source_message_id;
ALTER TABLE assistant_agent_cases ADD COLUMN review_id uuid;
DROP INDEX IF EXISTS ix_assistant_runs_v2_created;
DROP TABLE IF EXISTS assistant_turn_events;
CREATE TABLE assistant_turn_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assistant_message_id uuid NOT NULL UNIQUE,
    run_id uuid,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    verdict text NOT NULL CHECK (verdict IN ('correct', 'wrong')),
    expected text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    signals text[] NOT NULL DEFAULT '{}',
    reviewed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
