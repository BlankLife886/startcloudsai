-- +goose Up
DELETE FROM email_login_codes;
ALTER TABLE email_login_codes DROP CONSTRAINT ck_email_login_codes_purpose;
ALTER TABLE email_login_codes
    ADD CONSTRAINT ck_email_login_codes_purpose CHECK (purpose = 'authenticate');

-- +goose Down
DELETE FROM email_login_codes;
ALTER TABLE email_login_codes DROP CONSTRAINT ck_email_login_codes_purpose;
ALTER TABLE email_login_codes
    ADD CONSTRAINT ck_email_login_codes_purpose CHECK (purpose IN ('register', 'login'));
