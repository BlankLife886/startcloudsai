-- +goose Up
ALTER TABLE object_cleanup_jobs
    DROP CONSTRAINT ck_object_cleanup_jobs_key;

ALTER TABLE object_cleanup_jobs
    ADD CONSTRAINT ck_object_cleanup_jobs_key CHECK (
        char_length(object_key) BETWEEN 1 AND 512
        AND (object_key LIKE 'tasks/%' OR object_key LIKE 'uploads/%')
    );

-- +goose Down
DELETE FROM object_cleanup_jobs WHERE object_key LIKE 'uploads/%';

ALTER TABLE object_cleanup_jobs
    DROP CONSTRAINT ck_object_cleanup_jobs_key;

ALTER TABLE object_cleanup_jobs
    ADD CONSTRAINT ck_object_cleanup_jobs_key CHECK (
        char_length(object_key) BETWEEN 1 AND 512
        AND object_key LIKE 'tasks/%'
    );
