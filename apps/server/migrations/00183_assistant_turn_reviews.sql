-- +goose Up
-- AI 助手复核：管理员对可疑的真实回合（方案没人用、用户点踩、紧接着纠正、失败）判对判错。
-- 判错的回合变成回归用例，之后换模型、改提示词时拿它们检验“第一步做得对不对”。
CREATE TABLE assistant_turn_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assistant_message_id uuid NOT NULL UNIQUE,
    run_id uuid,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    verdict text NOT NULL CHECK (verdict IN ('correct', 'wrong')),
    -- 判错时这一轮本该做什么：answer / image / web / data / workspace / files。
    expected text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    signals text[] NOT NULL DEFAULT '{}',
    -- 后台管理员账号（admin_accounts），不是普通用户，所以不加外键。
    reviewed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_assistant_turn_reviews_created ON assistant_turn_reviews (created_at DESC);

-- 回归用例：只存当时的对话文字快照，不引用原消息，用户删掉对话后用例仍然可用。
CREATE TABLE assistant_agent_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid UNIQUE REFERENCES assistant_turn_reviews(id) ON DELETE SET NULL,
    mode text NOT NULL CHECK (mode IN ('chat', 'agent')),
    context jsonb NOT NULL DEFAULT '[]'::jsonb,
    prompt text NOT NULL,
    reference_count integer NOT NULL DEFAULT 0,
    expected text[] NOT NULL,
    note text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS assistant_agent_cases;
DROP TABLE IF EXISTS assistant_turn_reviews;
