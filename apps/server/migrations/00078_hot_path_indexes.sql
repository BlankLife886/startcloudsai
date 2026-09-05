-- +goose Up
-- Global task-admission counts (taskflow.CreateTask) previously scanned every
-- active row and re-checked the JSONB _kind filter on the heap. This partial
-- index materializes exactly the admission-visible active rows and carries
-- work_units, so both count(*) and sum(work_units) run as index-only scans
-- inside the short global-admission critical section.
CREATE INDEX ix_tasks_active_admission
    ON tasks (status, work_units)
    WHERE status IN ('queued', 'running')
      AND COALESCE(params->>'_kind', '') <> 'ui_design_asset_history';

-- wallet.CountTaskLedger matches source_id = '<uuid>' OR source_id LIKE
-- '<uuid>/%'. The default-collation unique index cannot serve the prefix range,
-- forcing a scan of every (kind, source_type='task') row. A text_pattern_ops
-- index makes both the equality and the prefix range index-scannable.
CREATE INDEX ix_wallet_ledger_task_source
    ON wallet_ledger (kind, source_type, source_id text_pattern_ops)
    WHERE source_type = 'task';

-- Finance/report aggregations (SpendDailySince / FinanceTotalsSince) filter the
-- append-only ledger by created_at across the whole table. A BRIN index tracks
-- the time-ordered heap cheaply without the write amplification of a btree.
CREATE INDEX ix_wallet_ledger_created_brin
    ON wallet_ledger USING brin (created_at);

-- Hourly session cleanup deletes by expires_at; without an index it scanned the
-- whole sessions table.
CREATE INDEX ix_sessions_expires_at ON sessions (expires_at);

-- Finished canvas workflow runs are cleaned up by age; index the terminal rows
-- by finished_at so the cleanup job does not scan live runs.
CREATE INDEX ix_canvas_workflow_runs_finished
    ON canvas_workflow_runs (finished_at)
    WHERE status <> 'running';

-- +goose Down
DROP INDEX IF EXISTS ix_canvas_workflow_runs_finished;
DROP INDEX IF EXISTS ix_sessions_expires_at;
DROP INDEX IF EXISTS ix_wallet_ledger_created_brin;
DROP INDEX IF EXISTS ix_wallet_ledger_task_source;
DROP INDEX IF EXISTS ix_tasks_active_admission;
