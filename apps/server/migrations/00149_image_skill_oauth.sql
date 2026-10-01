-- +goose Up
CREATE TABLE image_skill_oauth_authorization_codes (
    code_hash varchar(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    scope text NOT NULL DEFAULT 'images',
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX image_skill_oauth_codes_expiry_idx ON image_skill_oauth_authorization_codes (expires_at)
    WHERE consumed_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS image_skill_oauth_authorization_codes;
