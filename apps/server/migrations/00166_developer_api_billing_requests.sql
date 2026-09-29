-- +goose Up
-- 开发者 API 直通请求（标准 /v1 图片、Responses 对话）的账务状态。
-- 每个请求要么成功结算、要么失败释放，网关不重试；pending 行只用于进程
-- 中途退出时，由回收任务在 expires_at 之后释放预留。
CREATE TABLE IF NOT EXISTS developer_api_billing_requests (
    billing_id     text        PRIMARY KEY,
    source_type    text        NOT NULL,
    user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
    api_key_id     uuid        REFERENCES user_api_keys(id) ON DELETE SET NULL,
    usage_event_id uuid        REFERENCES api_key_usage_events(id) ON DELETE SET NULL,
    price_cents    bigint      NOT NULL DEFAULT 0,
    status         text        NOT NULL,
    expires_at     timestamptz NOT NULL,
    settled_at     timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_developer_api_billing_status CHECK (status IN ('pending','succeeded','failed','expired')),
    CONSTRAINT ck_developer_api_billing_price CHECK (price_cents >= 0)
);
CREATE INDEX IF NOT EXISTS developer_api_billing_open_idx
    ON developer_api_billing_requests (expires_at) WHERE status = 'pending';

-- 历史上未结算也未释放的图片预留：不再等待重试，立即交给回收任务释放。
INSERT INTO developer_api_billing_requests (billing_id, source_type, user_id, api_key_id, price_cents, status, expires_at, created_at)
SELECT f.source_id, f.source_type, f.user_id, profit.api_key_id, -f.delta_cents, 'pending',
       now(), f.created_at
FROM wallet_ledger f
LEFT JOIN usage_profit_ledger profit
       ON profit.source_type = 'developer_api' AND profit.source_id = f.source_id AND profit.billing_generation = 0
WHERE f.kind = 'freeze' AND f.source_type = 'openai_image_request' AND f.source_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM wallet_ledger d WHERE d.source_type = f.source_type
                  AND d.source_id = f.source_id AND d.kind IN ('spend','release'))
ON CONFLICT (billing_id) DO NOTHING;

-- 历史上因客户端断开而无法释放的 Responses 对话预留：立即交给回收任务释放。
INSERT INTO developer_api_billing_requests (billing_id, source_type, user_id, price_cents, status, expires_at, created_at)
SELECT f.source_id, f.source_type, f.user_id, -f.delta_cents, 'pending', now(), f.created_at
FROM wallet_ledger f
WHERE f.kind = 'freeze' AND f.source_type = 'open_api_responses_chat' AND f.source_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM wallet_ledger d WHERE d.source_type = f.source_type
                  AND d.source_id = f.source_id AND d.kind IN ('spend','release'))
ON CONFLICT (billing_id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS developer_api_billing_requests;
