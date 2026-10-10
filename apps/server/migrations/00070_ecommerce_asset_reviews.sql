-- +goose Up
CREATE TABLE ecommerce_asset_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending',
    checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
    note text NOT NULL DEFAULT '',
    channel text NOT NULL DEFAULT '',
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_ecommerce_asset_reviews_status
        CHECK (status IN ('pending', 'approved', 'changes_requested')),
    CONSTRAINT ck_ecommerce_asset_reviews_note_length
        CHECK (char_length(note) <= 800),
    CONSTRAINT ck_ecommerce_asset_reviews_channel_length
        CHECK (char_length(channel) <= 80),
    UNIQUE (user_id, task_id)
);

CREATE INDEX ix_ecommerce_asset_reviews_user_updated
    ON ecommerce_asset_reviews (user_id, updated_at DESC, id DESC);

CREATE INDEX ix_ecommerce_asset_reviews_user_status
    ON ecommerce_asset_reviews (user_id, status, updated_at DESC);

-- +goose Down
DROP TABLE IF EXISTS ecommerce_asset_reviews;
