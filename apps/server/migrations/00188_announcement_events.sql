-- +goose Up
-- 公告操作时间线：创建、编辑、启停、推送、删除都留一条记录。
-- 不对 announcements 建外键，公告删除后时间线仍可回查（title 为当时的标题快照）。
CREATE TABLE announcement_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id uuid NOT NULL,
    title text NOT NULL,
    action text NOT NULL CHECK (action IN ('created', 'updated', 'enabled', 'disabled', 'pushed', 'deleted')),
    changes text[] NOT NULL DEFAULT '{}',
    -- 后台账号在 admin_accounts，不建外键；actor_name 为操作时的名字快照。
    actor_id uuid,
    actor_name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_announcement_events_announcement ON announcement_events (announcement_id, created_at DESC);
CREATE INDEX ix_announcement_events_created ON announcement_events (created_at DESC);

-- 已有公告补齐能还原的两条：创建与最近一次推送。
INSERT INTO announcement_events (announcement_id, title, action, created_at)
SELECT id, title, 'created', created_at FROM announcements;
INSERT INTO announcement_events (announcement_id, title, action, created_at)
SELECT id, title, 'pushed', pushed_at FROM announcements WHERE pushed_at IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS announcement_events;
