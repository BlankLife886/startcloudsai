-- +goose Up
ALTER TABLE assistant_runs
    ADD COLUMN queue_position bigint NOT NULL DEFAULT 0;

WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY conversation_id ORDER BY created_at ASC, id ASC
    ) AS position
    FROM assistant_runs
)
UPDATE assistant_runs run
SET queue_position = ranked.position
FROM ranked
WHERE ranked.id = run.id;

DROP INDEX IF EXISTS assistant_runs_one_active_per_conversation_idx;

CREATE UNIQUE INDEX assistant_runs_one_running_per_conversation_idx
    ON assistant_runs (conversation_id)
    WHERE status = 'running';

CREATE INDEX assistant_runs_conversation_queue_idx
    ON assistant_runs (conversation_id, queue_position ASC, created_at ASC, id ASC)
    WHERE status = 'queued';

-- +goose Down
DROP INDEX IF EXISTS assistant_runs_conversation_queue_idx;
DROP INDEX IF EXISTS assistant_runs_one_running_per_conversation_idx;

CREATE UNIQUE INDEX assistant_runs_one_active_per_conversation_idx
    ON assistant_runs (conversation_id)
    WHERE status IN ('queued', 'running');

ALTER TABLE assistant_runs DROP COLUMN IF EXISTS queue_position;
