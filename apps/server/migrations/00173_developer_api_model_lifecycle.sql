-- +goose Up
-- 开发者 API 模型的生命周期与定时调价（docs/DEVELOPER_API_MODEL_CATALOG.md 第 5、6.4 节）。
ALTER TABLE developer_api_models
    ADD COLUMN IF NOT EXISTS sunset_at             timestamptz,
    ADD COLUMN IF NOT EXISTS deprecated_at         timestamptz,
    ADD COLUMN IF NOT EXISTS retired_at            timestamptz,
    ADD COLUMN IF NOT EXISTS replacement_id        text REFERENCES developer_api_models(id),
    -- 跟随站内价时当前生效的 API 价格；站内涨价要等预告期结束才写入这里。
    ADD COLUMN IF NOT EXISTS committed_price_cents bigint,
    ADD COLUMN IF NOT EXISTS pending_price_cents   bigint,
    ADD COLUMN IF NOT EXISTS pending_price_at      timestamptz;

ALTER TABLE developer_api_models
    ADD CONSTRAINT ck_developer_api_model_sunset CHECK (status <> 'deprecated' OR sunset_at IS NOT NULL) NOT VALID,
    ADD CONSTRAINT ck_developer_api_model_pending CHECK ((pending_price_cents IS NULL) = (pending_price_at IS NULL) AND (pending_price_cents IS NULL OR pending_price_cents >= 0)) NOT VALID,
    ADD CONSTRAINT ck_developer_api_model_replacement CHECK (replacement_id IS NULL OR replacement_id <> id) NOT VALID;
ALTER TABLE developer_api_models VALIDATE CONSTRAINT ck_developer_api_model_sunset;
ALTER TABLE developer_api_models VALIDATE CONSTRAINT ck_developer_api_model_pending;
ALTER TABLE developer_api_models VALIDATE CONSTRAINT ck_developer_api_model_replacement;

CREATE INDEX IF NOT EXISTS developer_api_models_due_idx ON developer_api_models (status)
    WHERE status IN ('deprecated') OR pending_price_at IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS developer_api_models_due_idx;
ALTER TABLE developer_api_models
    DROP CONSTRAINT IF EXISTS ck_developer_api_model_replacement,
    DROP CONSTRAINT IF EXISTS ck_developer_api_model_pending,
    DROP CONSTRAINT IF EXISTS ck_developer_api_model_sunset;
-- 旧版本只认识 draft/live：维护中与弃用中的恢复为上线，已下线的回到草稿（调用 404）。
UPDATE developer_api_models SET status='live' WHERE status IN ('maintenance','deprecated');
UPDATE developer_api_models SET status='draft' WHERE status='retired';
ALTER TABLE developer_api_models
    DROP COLUMN IF EXISTS pending_price_at,
    DROP COLUMN IF EXISTS pending_price_cents,
    DROP COLUMN IF EXISTS committed_price_cents,
    DROP COLUMN IF EXISTS replacement_id,
    DROP COLUMN IF EXISTS retired_at,
    DROP COLUMN IF EXISTS deprecated_at,
    DROP COLUMN IF EXISTS sunset_at;
