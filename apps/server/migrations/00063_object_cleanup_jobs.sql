-- +goose Up
CREATE TABLE object_cleanup_jobs (
    object_key text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    last_error text NOT NULL DEFAULT '',
    CONSTRAINT ck_object_cleanup_jobs_key CHECK (
        char_length(object_key) BETWEEN 1 AND 512
        AND object_key LIKE 'tasks/%'
    ),
    CONSTRAINT ck_object_cleanup_jobs_attempts CHECK (attempts >= 0)
);

CREATE INDEX ix_object_cleanup_jobs_ready
    ON object_cleanup_jobs (next_attempt_at, created_at);

-- +goose Down
DROP TABLE IF EXISTS object_cleanup_jobs;
