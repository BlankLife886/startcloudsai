-- +goose Up
ALTER TABLE users
    ADD COLUMN require_cost_confirm boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS require_cost_confirm;
