-- +goose Up
ALTER TABLE announcements
  ADD COLUMN push_id uuid,
  ADD COLUMN pushed_at timestamptz;

-- +goose Down
ALTER TABLE announcements
  DROP COLUMN pushed_at,
  DROP COLUMN push_id;
