-- +goose Up
-- AI 助手里的电商套图：一套图的策划方案、每张图的生成记录与检查结果，以及累计批准的积分。
-- 生成出来的是普通 ecommerce_design 任务（params._assistantCommerceSetId 指回这里），
-- 计费、退款、历史记录都走任务本身；这里只记“这一套”的进度和预算。
CREATE TABLE assistant_commerce_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE SET NULL,
    run_id uuid REFERENCES assistant_runs(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'planned',
    brief jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary text NOT NULL DEFAULT '',
    shots jsonb NOT NULL DEFAULT '[]'::jsonb,
    input_keys text[] NOT NULL DEFAULT '{}',
    model_id text NOT NULL DEFAULT '',
    quoted_cents bigint NOT NULL DEFAULT 0,
    approved_cents bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_assistant_commerce_sets_status CHECK (status IN ('planned', 'generating', 'done', 'canceled')),
    CONSTRAINT ck_assistant_commerce_sets_cents CHECK (quoted_cents >= 0 AND approved_cents >= 0)
);
CREATE INDEX ix_assistant_commerce_sets_user ON assistant_commerce_sets (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS assistant_commerce_sets;
