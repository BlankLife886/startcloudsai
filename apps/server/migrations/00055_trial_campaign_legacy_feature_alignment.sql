-- +goose Up
-- The first campaign is migrated from the old mutable singleton settings. Its
-- existing applications must inherit that final feature set, otherwise users
-- approved before multi-feature support only retain the legacy primary feature.
UPDATE trial_access_applications application
SET feature_key = campaign.feature_keys[1],
    feature_keys = campaign.feature_keys,
    updated_at = now()
FROM trial_campaigns campaign
WHERE application.campaign_id = campaign.id
  AND campaign.created_by IS NULL;

INSERT INTO user_trial_feature_entitlements (
    user_id, feature_key, application_id, granted_at
)
SELECT
    application.user_id,
    feature.key,
    application.id,
    COALESCE(application.reviewed_at, application.updated_at)
FROM trial_access_applications application
JOIN trial_campaigns campaign ON campaign.id = application.campaign_id
CROSS JOIN LATERAL unnest(application.feature_keys) AS feature(key)
WHERE campaign.created_by IS NULL
  AND application.status = 'approved'
ON CONFLICT (user_id, feature_key) DO UPDATE
SET application_id = EXCLUDED.application_id,
    granted_at = EXCLUDED.granted_at,
    revoked_at = NULL;

-- +goose Down
DELETE FROM user_trial_feature_entitlements entitlement
USING trial_access_applications application, trial_campaigns campaign
WHERE entitlement.application_id = application.id
  AND application.campaign_id = campaign.id
  AND campaign.created_by IS NULL
  AND entitlement.feature_key <> application.feature_key;

UPDATE trial_access_applications application
SET feature_keys = ARRAY[application.feature_key],
    updated_at = now()
FROM trial_campaigns campaign
WHERE application.campaign_id = campaign.id
  AND campaign.created_by IS NULL;
