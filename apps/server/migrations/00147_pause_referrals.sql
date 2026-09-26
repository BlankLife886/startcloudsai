-- +goose Up
-- Temporarily withdraw referrals without deleting earned rewards or changing balances.
INSERT INTO app_settings(key,value,updated_at)
VALUES('referral_config','{"enabled":false,"settlementPaused":true}'::jsonb,now())
ON CONFLICT(key) DO UPDATE SET
 value=(CASE WHEN jsonb_typeof(app_settings.value)='object' THEN app_settings.value ELSE '{}'::jsonb END)||EXCLUDED.value,
 updated_at=EXCLUDED.updated_at;

-- +goose Down
-- Rolling back code must not silently reopen a suspended incentive program.
SELECT 1;
