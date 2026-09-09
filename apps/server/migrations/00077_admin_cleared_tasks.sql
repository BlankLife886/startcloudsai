-- +goose Up
ALTER TABLE tasks
    ADD COLUMN admin_cleared_at timestamptz;

ALTER TABLE assistant_runs
    ADD COLUMN admin_cleared_at timestamptz;

CREATE INDEX tasks_admin_visible_idx
    ON tasks (created_at DESC, id DESC)
    WHERE admin_cleared_at IS NULL;

CREATE INDEX assistant_runs_admin_visible_idx
    ON assistant_runs (created_at DESC, id DESC)
    WHERE admin_cleared_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS assistant_runs_admin_visible_idx;
DROP INDEX IF EXISTS tasks_admin_visible_idx;

ALTER TABLE assistant_runs
    DROP COLUMN IF EXISTS admin_cleared_at;

ALTER TABLE tasks
    DROP COLUMN IF EXISTS admin_cleared_at;
