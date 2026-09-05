-- +goose Up
ALTER TABLE trial_access_applications
    ADD COLUMN feature_keys text[];

UPDATE trial_access_applications
SET feature_keys = ARRAY[feature_key];

ALTER TABLE trial_access_applications
    ALTER COLUMN feature_keys SET NOT NULL,
    ALTER COLUMN feature_keys SET DEFAULT ARRAY['text_to_image']::text[],
    ADD CONSTRAINT ck_trial_access_feature_keys_count
        CHECK (cardinality(feature_keys) BETWEEN 1 AND 6),
    ADD CONSTRAINT ck_trial_access_feature_keys_nonnull
        CHECK (array_position(feature_keys, NULL) IS NULL),
    ADD CONSTRAINT ck_trial_access_primary_feature
        CHECK (feature_keys[1] = feature_key);

ALTER TABLE user_trial_feature_entitlements
    DROP CONSTRAINT IF EXISTS user_trial_feature_entitlements_application_id_key;

CREATE INDEX ix_trial_feature_entitlements_application
    ON user_trial_feature_entitlements (application_id);

INSERT INTO app_settings (key, value, updated_at)
VALUES (
    'trial_campaign_feature_keys',
    COALESCE(
        (
            SELECT jsonb_build_array(value #>> '{}')
            FROM app_settings
            WHERE key = 'trial_campaign_feature_key'
        ),
        '["text_to_image"]'::jsonb
    ),
    now()
)
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DELETE FROM user_trial_feature_entitlements entitlement
USING (
    SELECT ctid, row_number() OVER (
        PARTITION BY application_id
        ORDER BY granted_at, feature_key
    ) AS position
    FROM user_trial_feature_entitlements
) duplicate
WHERE entitlement.ctid = duplicate.ctid
  AND duplicate.position > 1;

DROP INDEX IF EXISTS ix_trial_feature_entitlements_application;

ALTER TABLE user_trial_feature_entitlements
    ADD CONSTRAINT user_trial_feature_entitlements_application_id_key
        UNIQUE (application_id);

DELETE FROM app_settings WHERE key = 'trial_campaign_feature_keys';

ALTER TABLE trial_access_applications
    DROP CONSTRAINT IF EXISTS ck_trial_access_primary_feature,
    DROP CONSTRAINT IF EXISTS ck_trial_access_feature_keys_nonnull,
    DROP CONSTRAINT IF EXISTS ck_trial_access_feature_keys_count,
    DROP COLUMN IF EXISTS feature_keys;
