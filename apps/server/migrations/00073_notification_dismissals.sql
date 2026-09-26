-- +goose Up
CREATE TABLE notification_dismissals (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notification_id)
);
CREATE INDEX ix_notification_dismissals_notification ON notification_dismissals (notification_id);

-- +goose Down
DROP TABLE IF EXISTS notification_dismissals;
