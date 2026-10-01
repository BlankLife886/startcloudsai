-- +goose Up
ALTER TABLE users DROP CONSTRAINT ck_users_status;
ALTER TABLE users
    ADD CONSTRAINT ck_users_status CHECK (status IN ('active','banned','deleted'));
ALTER TABLE users ADD COLUMN deleted_at timestamptz;

-- +goose Down
UPDATE users SET status = 'banned' WHERE status = 'deleted';
ALTER TABLE users DROP COLUMN deleted_at;
ALTER TABLE users DROP CONSTRAINT ck_users_status;
ALTER TABLE users
    ADD CONSTRAINT ck_users_status CHECK (status IN ('active','banned'));
