-- +goose Up
-- 开发者 API 模型目录：对外稳定的模型名、状态与价格，指向一个站内模型。
-- 设计见 docs/DEVELOPER_API_MODEL_CATALOG.md。目录内容由 `server api-models-migrate --apply` 回填。
CREATE TABLE IF NOT EXISTS developer_api_models (
    id                  text        PRIMARY KEY,
    api_name            text        NOT NULL,
    aliases             text[]      NOT NULL DEFAULT '{}',
    kind                text        NOT NULL,
    target_model_id     text        NOT NULL,
    status              text        NOT NULL DEFAULT 'draft',
    price_mode          text        NOT NULL DEFAULT 'follow',
    price_cents         bigint,
    max_concurrency     integer     NOT NULL DEFAULT 0,
    description         text        NOT NULL DEFAULT '',
    published_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_developer_api_model_kind CHECK (kind IN ('image','chat')),
    CONSTRAINT ck_developer_api_model_status CHECK (status IN ('draft','live','maintenance','deprecated','retired')),
    CONSTRAINT ck_developer_api_model_price_mode CHECK (price_mode IN ('follow','fixed')),
    CONSTRAINT ck_developer_api_model_price CHECK (price_cents IS NULL OR price_cents >= 0),
    CONSTRAINT ck_developer_api_model_fixed_price CHECK (price_mode <> 'fixed' OR price_cents IS NOT NULL),
    CONSTRAINT ck_developer_api_model_concurrency CHECK (max_concurrency BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX IF NOT EXISTS developer_api_models_name_idx ON developer_api_models (lower(api_name));
CREATE INDEX IF NOT EXISTS developer_api_models_target_idx ON developer_api_models (target_model_id);

CREATE TABLE IF NOT EXISTS developer_api_model_events (
    id            bigserial   PRIMARY KEY,
    api_model_id  text        NOT NULL REFERENCES developer_api_models(id),
    admin_id      uuid,
    action        text        NOT NULL,
    reason        text        NOT NULL DEFAULT '',
    before        jsonb,
    after         jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS developer_api_model_events_model_idx ON developer_api_model_events (api_model_id, created_at DESC);

-- Key 的指定模型改为引用目录条目；兼容期内旧列继续写入，便于回滚。
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS allowed_api_model_ids text[] NOT NULL DEFAULT '{}';

-- 调用记录保存请求当时的 API 模型与名称，改名或删除后历史不变。
ALTER TABLE developer_api_billing_requests
    ADD COLUMN IF NOT EXISTS api_model_id text,
    ADD COLUMN IF NOT EXISTS api_model_name text;

-- +goose Down
ALTER TABLE developer_api_billing_requests DROP COLUMN IF EXISTS api_model_name, DROP COLUMN IF EXISTS api_model_id;
ALTER TABLE user_api_keys DROP COLUMN IF EXISTS allowed_api_model_ids;
DROP TABLE IF EXISTS developer_api_model_events;
DROP TABLE IF EXISTS developer_api_models;
