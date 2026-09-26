-- +goose Up
CREATE TABLE trial_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    feature_keys text[] NOT NULL,
    access_mode text NOT NULL DEFAULT 'credit_only',
    capacity bigint NOT NULL,
    display_offset bigint NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'draft',
    created_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    activated_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_trial_campaign_title_length CHECK (char_length(title) BETWEEN 2 AND 60),
    CONSTRAINT ck_trial_campaign_feature_count CHECK (cardinality(feature_keys) BETWEEN 1 AND 6),
    CONSTRAINT ck_trial_campaign_feature_nonnull CHECK (array_position(feature_keys, NULL) IS NULL),
    CONSTRAINT ck_trial_campaign_access_mode CHECK (access_mode IN ('credit_only', 'restricted')),
    CONSTRAINT ck_trial_campaign_capacity CHECK (capacity BETWEEN 1 AND 1000000),
    CONSTRAINT ck_trial_campaign_display_offset CHECK (display_offset BETWEEN -1000000 AND 1000000),
    CONSTRAINT ck_trial_campaign_status CHECK (status IN ('draft', 'active', 'closed'))
);

CREATE UNIQUE INDEX uq_trial_campaigns_one_active
    ON trial_campaigns (status)
    WHERE status = 'active';

CREATE INDEX ix_trial_campaigns_created
    ON trial_campaigns (created_at DESC, id DESC);

ALTER TABLE trial_access_applications
    ADD COLUMN campaign_id uuid;

WITH campaign_settings AS (
    SELECT
        COALESCE(
            (SELECT value #>> '{}' FROM app_settings WHERE key = 'trial_campaign_title'),
            '限量功能体验计划'
        ) AS title,
        COALESCE(
            ARRAY(
                SELECT jsonb_array_elements_text(value)
                FROM app_settings
                WHERE key = 'trial_campaign_feature_keys'
            ),
            ARRAY['text_to_image']::text[]
        ) AS feature_keys,
        COALESCE(
            (SELECT value #>> '{}' FROM app_settings WHERE key = 'trial_campaign_access_mode'),
            'credit_only'
        ) AS access_mode,
        COALESCE(
            (SELECT (value #>> '{}')::bigint FROM app_settings WHERE key = 'trial_campaign_capacity'),
            100
        ) AS capacity,
        COALESCE(
            (SELECT (value #>> '{}')::bigint FROM app_settings WHERE key = 'trial_campaign_display_offset'),
            0
        ) AS display_offset,
        COALESCE(
            (SELECT (value #>> '{}')::boolean FROM app_settings WHERE key = 'trial_campaign_enabled'),
            true
        ) AS enabled
), normalized AS (
    SELECT
        title,
        CASE
            WHEN cardinality(feature_keys) BETWEEN 1 AND 6 THEN feature_keys
            ELSE ARRAY['text_to_image']::text[]
        END AS feature_keys,
        access_mode,
        capacity,
        display_offset,
        enabled
    FROM campaign_settings
), created_campaign AS (
    INSERT INTO trial_campaigns (
        title, feature_keys, access_mode, capacity, display_offset,
        status, activated_at, closed_at
    )
    SELECT
        title,
        feature_keys,
        access_mode,
        capacity,
        display_offset,
        CASE WHEN enabled THEN 'active' ELSE 'closed' END,
        CASE WHEN enabled THEN now() ELSE NULL END,
        CASE WHEN enabled THEN NULL ELSE now() END
    FROM normalized
    RETURNING id
)
UPDATE trial_access_applications
SET campaign_id = (SELECT id FROM created_campaign);

ALTER TABLE trial_access_applications
    ALTER COLUMN campaign_id SET NOT NULL,
    ADD CONSTRAINT trial_access_applications_campaign_id_fkey
        FOREIGN KEY (campaign_id) REFERENCES trial_campaigns(id) ON DELETE CASCADE;

ALTER TABLE trial_access_applications
    DROP CONSTRAINT trial_access_applications_user_id_key,
    DROP CONSTRAINT uq_trial_access_application_no,
    ADD CONSTRAINT uq_trial_access_campaign_user UNIQUE (campaign_id, user_id),
    ADD CONSTRAINT uq_trial_access_campaign_no UNIQUE (campaign_id, application_no);

CREATE INDEX ix_trial_access_campaign_status_created
    ON trial_access_applications (campaign_id, status, created_at DESC, id DESC);

DELETE FROM app_settings
WHERE key IN (
    'trial_campaign_enabled',
    'trial_campaign_title',
    'trial_campaign_feature_key',
    'trial_campaign_feature_keys',
    'trial_campaign_access_mode',
    'trial_campaign_capacity',
    'trial_campaign_display_offset'
);

-- +goose Down
WITH selected AS (
    SELECT *
    FROM trial_campaigns
    ORDER BY (status = 'active') DESC, created_at DESC, id DESC
    LIMIT 1
)
INSERT INTO app_settings (key, value, updated_at)
SELECT key, value, now()
FROM selected,
LATERAL (
    VALUES
        ('trial_campaign_enabled', to_jsonb(selected.status = 'active')),
        ('trial_campaign_title', to_jsonb(selected.title)),
        ('trial_campaign_feature_key', to_jsonb(selected.feature_keys[1])),
        ('trial_campaign_feature_keys', to_jsonb(selected.feature_keys)),
        ('trial_campaign_access_mode', to_jsonb(selected.access_mode)),
        ('trial_campaign_capacity', to_jsonb(selected.capacity)),
        ('trial_campaign_display_offset', to_jsonb(selected.display_offset))
) restored(key, value)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

WITH selected AS (
    SELECT id
    FROM trial_campaigns
    ORDER BY (status = 'active') DESC, created_at DESC, id DESC
    LIMIT 1
)
DELETE FROM trial_access_applications
WHERE campaign_id <> (SELECT id FROM selected);

DROP INDEX IF EXISTS ix_trial_access_campaign_status_created;

ALTER TABLE trial_access_applications
    DROP CONSTRAINT uq_trial_access_campaign_no,
    DROP CONSTRAINT uq_trial_access_campaign_user,
    ADD CONSTRAINT trial_access_applications_user_id_key UNIQUE (user_id),
    ADD CONSTRAINT uq_trial_access_application_no UNIQUE (application_no),
    DROP CONSTRAINT trial_access_applications_campaign_id_fkey,
    DROP COLUMN campaign_id;

DROP TABLE trial_campaigns;
