-- +goose Up
-- AI 助手的主动建议：按记忆和最近的套图记录，在新对话里给出“接着做”的建议。默认开启。
ALTER TABLE assistant_proactive_settings ADD COLUMN suggestions boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE assistant_proactive_settings DROP COLUMN IF EXISTS suggestions;
