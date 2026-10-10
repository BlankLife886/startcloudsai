-- +goose Up
-- 任务执行时间线：每个任务在 worker 各阶段（排队/准备/提交/生成/下载/保存/重试/结束）
-- 追加一行事件，供后台"耗时详情"展示。写入是尽力而为，失败不影响任务执行。
CREATE TABLE task_timeline_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id uuid NOT NULL,
    stage text NOT NULL,
    status text NOT NULL DEFAULT 'info',
    message text NOT NULL DEFAULT '',
    duration_ms bigint,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_task_timeline_events_task ON task_timeline_events (task_id, id);
-- 保留期清理（按 created_at 范围删除）走 BRIN，追加型表几乎零维护成本。
CREATE INDEX ix_task_timeline_events_created_brin
    ON task_timeline_events USING brin (created_at);

-- +goose Down
DROP TABLE IF EXISTS task_timeline_events;
