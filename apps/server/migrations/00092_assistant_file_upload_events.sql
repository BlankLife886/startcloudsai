-- +goose Up
CREATE TABLE assistant_file_upload_events (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_file_upload_events_user_created_idx
    ON assistant_file_upload_events (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS assistant_file_upload_events;
