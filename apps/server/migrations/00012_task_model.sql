-- +goose Up
ALTER TABLE tasks ADD COLUMN model text NOT NULL DEFAULT '';

-- 老任务创建时尚未保存实际模型。迁移时使用仍然有效的服务端任务模型配置补齐，
-- 后续任务会在创建时快照模型，不再随后台配置变化。
WITH configured AS (
    SELECT value
    FROM app_settings
    WHERE key = 'task_models'
)
UPDATE tasks
SET model = COALESCE(
    NULLIF((SELECT value ->> tasks.type FROM configured), ''),
    NULLIF((SELECT value ->> 'default' FROM configured), ''),
    'gpt-image-2'
)
WHERE model = '';

-- +goose Down
ALTER TABLE tasks DROP COLUMN IF EXISTS model;
