-- +goose NO TRANSACTION
-- +goose Up
-- 拼团后台按活动分页：WHERE campaign_key = ? ORDER BY created_at DESC, id DESC。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_growth_groups_campaign_created_id ON growth_groups (campaign_key, created_at DESC, id DESC);
-- 社区作者列表按用户 (created_at, id) 游标分页，覆盖所有角色（已有索引只含 role = 'user'）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_created_id ON users (created_at DESC, id DESC);
-- 上传哈希规则按更新时间分页，sha256 作决胜列。
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_upload_hash_blocklist_updated ON upload_hash_blocklist (updated_at DESC, sha256 DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS ix_upload_hash_blocklist_updated;
DROP INDEX CONCURRENTLY IF EXISTS ix_users_created_id;
DROP INDEX CONCURRENTLY IF EXISTS ix_growth_groups_campaign_created_id;
