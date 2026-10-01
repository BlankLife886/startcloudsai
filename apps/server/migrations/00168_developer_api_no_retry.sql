-- +goose Up
-- 开发者 API 不再重试：去掉幂等参数指纹、重新投递计数和“结果不确定”状态。
-- 00166 已按最终结构修改；本迁移只修正已经执行过旧版 00166 的数据库。
UPDATE developer_api_billing_requests SET status = 'pending', expires_at = now() WHERE status = 'ambiguous';
ALTER TABLE developer_api_billing_requests
    DROP CONSTRAINT IF EXISTS ck_developer_api_billing_replays,
    DROP CONSTRAINT IF EXISTS ck_developer_api_billing_status,
    DROP COLUMN IF EXISTS fingerprint,
    DROP COLUMN IF EXISTS replay_count;
ALTER TABLE developer_api_billing_requests
    ADD CONSTRAINT ck_developer_api_billing_status CHECK (status IN ('pending','succeeded','failed','expired'));
DROP INDEX IF EXISTS developer_api_billing_open_idx;
CREATE INDEX developer_api_billing_open_idx ON developer_api_billing_requests (expires_at) WHERE status = 'pending';

-- +goose Down
SELECT 1;
