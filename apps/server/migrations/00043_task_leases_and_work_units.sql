-- +goose Up
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS work_units integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS lease_owner text,
    ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS lease_until timestamptz;

UPDATE tasks SET work_units = GREATEST(count, 1);

ALTER TABLE tasks
    ADD CONSTRAINT ck_tasks_work_units_range CHECK (work_units BETWEEN 1 AND 4);

CREATE INDEX IF NOT EXISTS ix_tasks_running_lease
    ON tasks (lease_until, started_at)
    WHERE status = 'running';

INSERT INTO app_settings (key, value)
VALUES
    ('user_max_running_images', '400'::jsonb),
    ('global_max_active_images', '12000'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE app_settings
SET value = '12000'::jsonb
WHERE key = 'global_max_active_tasks' AND value = '5000'::jsonb;

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_running_lease;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ck_tasks_work_units_range;
ALTER TABLE tasks
    DROP COLUMN IF EXISTS lease_until,
    DROP COLUMN IF EXISTS heartbeat_at,
    DROP COLUMN IF EXISTS lease_owner,
    DROP COLUMN IF EXISTS work_units;
DELETE FROM app_settings WHERE key IN ('user_max_running_images', 'global_max_active_images');
UPDATE app_settings
SET value = '5000'::jsonb
WHERE key = 'global_max_active_tasks' AND value = '12000'::jsonb;
