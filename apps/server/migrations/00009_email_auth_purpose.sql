-- +goose Up
DELETE FROM email_login_codes;
ALTER TABLE email_login_codes
    ADD COLUMN purpose text NOT NULL DEFAULT 'login',
    ADD CONSTRAINT ck_email_login_codes_purpose CHECK (purpose IN ('login', 'register'));

-- +goose Down
ALTER TABLE email_login_codes
    DROP CONSTRAINT IF EXISTS ck_email_login_codes_purpose,
    DROP COLUMN IF EXISTS purpose;
