-- +goose Up
-- AI 助手对话的数量管理：置顶和归档记在服务端（置顶的对话不会被自动归档），
-- 归档后按后台设置的天数自动删除；每人每天新建对话数单独计数（删掉对话也不会退回次数）。
ALTER TABLE assistant_conversations
    ADD COLUMN pinned_at timestamptz,
    ADD COLUMN archived_at timestamptz;

CREATE INDEX assistant_conversations_archived_idx
    ON assistant_conversations (archived_at)
    WHERE archived_at IS NOT NULL;

CREATE TABLE assistant_conversation_daily_creations (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day date NOT NULL,
    count integer NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

-- +goose Down
DROP TABLE IF EXISTS assistant_conversation_daily_creations;
DROP INDEX IF EXISTS assistant_conversations_archived_idx;
ALTER TABLE assistant_conversations DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS pinned_at;
