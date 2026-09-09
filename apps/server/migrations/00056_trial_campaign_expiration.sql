-- +goose Up
ALTER TABLE trial_campaigns
    ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');

UPDATE trial_campaigns
SET expires_at = CASE
    WHEN status = 'active' THEN now() + interval '30 days'
    ELSE GREATEST(
        COALESCE(activated_at, created_at) + interval '30 days',
        created_at + interval '1 second'
    )
END;

ALTER TABLE trial_campaigns
    ADD CONSTRAINT ck_trial_campaign_expiry_after_creation
        CHECK (expires_at > created_at);

CREATE INDEX ix_trial_campaigns_active_expiry
    ON trial_campaigns (expires_at)
    WHERE status = 'active';

-- +goose Down
DROP INDEX IF EXISTS ix_trial_campaigns_active_expiry;

ALTER TABLE trial_campaigns
    DROP CONSTRAINT IF EXISTS ck_trial_campaign_expiry_after_creation,
    DROP COLUMN expires_at;
