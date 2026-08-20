-- +goose Up
ALTER TABLE users
    ADD COLUMN studio_figure_url text;

ALTER TABLE user_upload_references
    DROP CONSTRAINT user_upload_references_reference_type_check;

ALTER TABLE user_upload_references
    ADD CONSTRAINT user_upload_references_reference_type_check
    CHECK (reference_type IN (
        'task_input',
        'user_asset',
        'user_avatar',
        'assistant_message',
        'assistant_run',
        'user_studio_figure'
    ));

-- +goose Down
ALTER TABLE user_upload_references
    DROP CONSTRAINT user_upload_references_reference_type_check;

ALTER TABLE user_upload_references
    ADD CONSTRAINT user_upload_references_reference_type_check
    CHECK (reference_type IN (
        'task_input',
        'user_asset',
        'user_avatar',
        'assistant_message',
        'assistant_run'
    ));

ALTER TABLE users DROP COLUMN IF EXISTS studio_figure_url;
