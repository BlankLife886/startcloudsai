-- +goose Up
CREATE UNIQUE INDEX assistant_runs_one_active_per_conversation_idx
    ON assistant_runs (conversation_id)
    WHERE status IN ('queued', 'running');

-- +goose Down
DROP INDEX IF EXISTS assistant_runs_one_active_per_conversation_idx;
