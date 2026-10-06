-- +goose Up
-- 公告与通知彻底分开：公告只存在 announcements 表，
-- 删掉 00085 留下的公告镜像行（通知查询不再需要逐条排除 kind = 'announcement'）。
DELETE FROM notifications
WHERE kind = 'announcement' OR source_type = 'announcement';

-- +goose Down
SELECT 1;
