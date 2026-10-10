-- +goose Up
CREATE TABLE execution_snapshots (
    source_type text NOT NULL CHECK (source_type IN ('task', 'assistant_run')),
    source_id uuid NOT NULL,
    slot text NOT NULL,
    config jsonb NOT NULL,
    config_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_type, source_id, slot)
);

COMMENT ON TABLE execution_snapshots IS 'Private immutable execution configuration; credential fields remain encrypted and are never serialized to clients';

-- +goose StatementBegin
CREATE FUNCTION reject_execution_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'execution snapshots are immutable';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER execution_snapshots_immutable BEFORE UPDATE ON execution_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_execution_snapshot_update();

-- +goose StatementBegin
CREATE FUNCTION cleanup_execution_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM execution_snapshots
    WHERE source_id = OLD.id
      AND source_type = CASE WHEN TG_TABLE_NAME = 'tasks' THEN 'task' ELSE 'assistant_run' END;
    RETURN OLD;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER tasks_cleanup_execution_snapshots AFTER DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION cleanup_execution_snapshots();
CREATE TRIGGER assistant_runs_cleanup_execution_snapshots AFTER DELETE ON assistant_runs
FOR EACH ROW EXECUTE FUNCTION cleanup_execution_snapshots();

-- +goose Down
DROP TRIGGER tasks_cleanup_execution_snapshots ON tasks;
DROP TRIGGER assistant_runs_cleanup_execution_snapshots ON assistant_runs;
DROP FUNCTION cleanup_execution_snapshots();
DROP TABLE execution_snapshots;
DROP FUNCTION reject_execution_snapshot_update();
