-- +goose Up
-- AI 助手的长期记忆：品牌资料、商品、风格偏好、习惯和满意方案。
-- 只属于用户本人；用户可以在助手里查看、修改、删除，也可以整体关闭。
CREATE TABLE assistant_memories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    title text NOT NULL,
    content text NOT NULL DEFAULT '',
    image_keys text[] NOT NULL DEFAULT '{}',
    -- user：用户在记忆面板里自己写的；assistant：对话里由助手记下的。
    source text NOT NULL DEFAULT 'user',
    conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE SET NULL,
    commerce_set_id uuid REFERENCES assistant_commerce_sets(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_assistant_memories_kind CHECK (kind IN ('brand', 'product', 'style', 'habit', 'favorite')),
    CONSTRAINT ck_assistant_memories_source CHECK (source IN ('user', 'assistant')),
    CONSTRAINT ck_assistant_memories_title CHECK (char_length(title) BETWEEN 1 AND 60),
    CONSTRAINT ck_assistant_memories_content CHECK (char_length(content) <= 1000),
    CONSTRAINT ck_assistant_memories_images CHECK (cardinality(image_keys) <= 6)
);
CREATE INDEX ix_assistant_memories_user ON assistant_memories (user_id, kind, updated_at DESC);

-- 没有记录表示开启（默认开启）。
CREATE TABLE assistant_memory_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS assistant_memory_settings;
DROP TABLE IF EXISTS assistant_memories;
