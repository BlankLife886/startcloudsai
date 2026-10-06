-- +goose Up
-- AI 助手“照着竞品做”：用户上传的竞品截图和拆解出的风格。截图只用来分析，
-- 不作为出图参考；套图策划时按 id 引用这份风格。
CREATE TABLE assistant_competitor_refs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE SET NULL,
    image_keys text[] NOT NULL DEFAULT '{}',
    style jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_assistant_competitor_refs_conversation ON assistant_competitor_refs (conversation_id, created_at DESC);
CREATE INDEX ix_assistant_competitor_refs_user ON assistant_competitor_refs (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS assistant_competitor_refs;
