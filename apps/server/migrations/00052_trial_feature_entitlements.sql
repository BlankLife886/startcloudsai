-- +goose Up
ALTER TABLE trial_access_applications
    ADD COLUMN feature_key text NOT NULL DEFAULT 'text_to_image',
    ADD CONSTRAINT ck_trial_access_feature_key_nonempty
        CHECK (char_length(feature_key) BETWEEN 2 AND 80);

ALTER TABLE wallets
    ADD COLUMN trial_feature_key text,
    ADD CONSTRAINT ck_wallets_trial_feature_key_nonempty
        CHECK (trial_feature_key IS NULL OR char_length(trial_feature_key) BETWEEN 2 AND 80);

UPDATE wallets
SET trial_feature_key = 'text_to_image'
WHERE trial_balance_cents + trial_frozen_cents > 0;

ALTER TABLE task_credit_reservations
    ADD COLUMN trial_feature_key text;

UPDATE task_credit_reservations
SET trial_feature_key = 'text_to_image'
WHERE trial_cents > 0;

ALTER TABLE task_credit_reservations
    ADD CONSTRAINT ck_task_credit_reservation_trial_feature
    CHECK (
        (trial_cents = 0 AND trial_remaining_cents = 0)
        OR trial_feature_key IS NOT NULL
    );

CREATE TABLE user_trial_feature_entitlements (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_key text NOT NULL,
    application_id uuid NOT NULL UNIQUE REFERENCES trial_access_applications(id) ON DELETE CASCADE,
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    PRIMARY KEY (user_id, feature_key),
    CONSTRAINT ck_trial_feature_entitlement_key_nonempty
        CHECK (char_length(feature_key) BETWEEN 2 AND 80)
);

INSERT INTO user_trial_feature_entitlements (user_id, feature_key, application_id, granted_at)
SELECT user_id, feature_key, id, COALESCE(reviewed_at, updated_at)
FROM trial_access_applications
WHERE status = 'approved'
ON CONFLICT (user_id, feature_key) DO NOTHING;

INSERT INTO app_settings (key, value, updated_at)
VALUES
    ('trial_campaign_feature_key', '"text_to_image"'::jsonb, now()),
    ('trial_campaign_access_mode', '"credit_only"'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

DELETE FROM app_settings WHERE key = 'trial_campaign_feature';

-- +goose Down
INSERT INTO app_settings (key, value, updated_at)
VALUES ('trial_campaign_feature', '"文生图"'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

DELETE FROM app_settings
WHERE key IN ('trial_campaign_feature_key', 'trial_campaign_access_mode');

DROP TABLE IF EXISTS user_trial_feature_entitlements;

ALTER TABLE task_credit_reservations
    DROP CONSTRAINT IF EXISTS ck_task_credit_reservation_trial_feature,
    DROP COLUMN IF EXISTS trial_feature_key;

ALTER TABLE wallets
    DROP CONSTRAINT IF EXISTS ck_wallets_trial_feature_key_nonempty,
    DROP COLUMN IF EXISTS trial_feature_key;

ALTER TABLE trial_access_applications
    DROP CONSTRAINT IF EXISTS ck_trial_access_feature_key_nonempty,
    DROP COLUMN IF EXISTS feature_key;
