-- +goose Up
-- 兼容期结束：Key 的指定模型只存 allowed_api_model_ids（API 模型目录 ID）。
-- 旧列里的站内模型 ID 由目录初始化（apicatalog.EnsureInitialized）映射过去；
-- serve 启动时先迁移到 00173、初始化目录，再执行本迁移。目录还没初始化而仍有
-- Key 指定了模型时拒绝删列，避免丢失这些设置。
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM developer_api_models)
       AND EXISTS (SELECT 1 FROM user_api_keys WHERE status <> 'revoked' AND cardinality(allowed_model_ids) > 0) THEN
        RAISE EXCEPTION '开发者 API 模型目录尚未初始化：请先用 serve 启动（会自动初始化）或执行 server api-models-migrate --apply';
    END IF;
END $$;
-- +goose StatementEnd
ALTER TABLE user_api_keys DROP COLUMN IF EXISTS allowed_model_ids;

-- +goose Down
-- 旧列恢复为空（不限模型）；需要回滚到旧版本时，按 allowed_api_model_ids 指向的站内模型回填。
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS allowed_model_ids text[] NOT NULL DEFAULT '{}';
UPDATE user_api_keys k SET allowed_model_ids = COALESCE((
    SELECT array_agg(DISTINCT m.target_model_id) FROM developer_api_models m WHERE m.id = ANY(k.allowed_api_model_ids)
), '{}');
