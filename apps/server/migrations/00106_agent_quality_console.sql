-- +goose Up
ALTER TABLE agent_eval_runs
    ADD COLUMN reasoning_effort text NOT NULL DEFAULT '',
    ADD COLUMN sample_size integer NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
    ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX agent_execution_traces_started_status_idx
    ON agent_execution_traces (started_at DESC, status);
CREATE INDEX agent_execution_traces_version_idx
    ON agent_execution_traces (model, reasoning_effort, prompt_version, tool_version, started_at DESC);
CREATE INDEX agent_eval_runs_started_idx ON agent_eval_runs (started_at DESC);

-- +goose Down
DROP INDEX IF EXISTS agent_eval_runs_started_idx;
DROP INDEX IF EXISTS agent_execution_traces_version_idx;
DROP INDEX IF EXISTS agent_execution_traces_started_status_idx;
ALTER TABLE agent_eval_runs
    DROP COLUMN IF EXISTS metadata,
    DROP COLUMN IF EXISTS sample_size,
    DROP COLUMN IF EXISTS reasoning_effort;
