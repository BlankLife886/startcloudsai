-- +goose Up
ALTER TABLE email_login_codes DROP CONSTRAINT ck_email_login_codes_purpose;
ALTER TABLE email_login_codes
    ADD CONSTRAINT ck_email_login_codes_purpose CHECK (purpose IN ('register', 'reset'));

-- +goose Down
DELETE FROM email_login_codes WHERE purpose = 'reset';
ALTER TABLE email_login_codes DROP CONSTRAINT ck_email_login_codes_purpose;
ALTER TABLE email_login_codes
    ADD CONSTRAINT ck_email_login_codes_purpose CHECK (purpose IN ('login', 'register'));
