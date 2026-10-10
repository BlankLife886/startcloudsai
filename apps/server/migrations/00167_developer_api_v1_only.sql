-- +goose Up
-- 开发者 API 只保留 OpenAI 兼容的 /v1：同步返回结果，不再有任务 API、Webhook 回调或按接口划分的 Key 权限。
DROP TABLE IF EXISTS api_webhook_deliveries;
DROP TABLE IF EXISTS api_webhook_endpoints;
ALTER TABLE user_api_keys DROP COLUMN IF EXISTS scopes;

-- +goose Down
-- 回调数据与 Key 权限随 Up 一起删除，无法恢复；Down 只还原结构。
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL
    DEFAULT ARRAY['models:read','files:write','tasks:write','tasks:read']::text[];
