-- +goose Up
-- Referral controls follow the independent subscription service-record migration.
ALTER TABLE referral_rewards
 ADD COLUMN status text NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','skipped','recovery_pending','reversed')),
 ADD COLUMN decision_reason text NOT NULL DEFAULT '',
 ADD COLUMN config_snapshot jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN reversed_at timestamptz,
 ADD COLUMN reversal_reason text NOT NULL DEFAULT '',
 ADD COLUMN reversal_admin_id uuid REFERENCES admin_accounts(id);
UPDATE referral_rewards SET status='skipped',decision_reason='rounded_to_zero' WHERE reward_points=0;
CREATE INDEX referral_rewards_status ON referral_rewards(status,created_at DESC,order_id);
CREATE INDEX referral_rewards_invitee ON referral_rewards(invitee_id,created_at DESC);
CREATE TABLE referral_reward_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES referral_rewards(order_id),
 admin_id uuid NOT NULL REFERENCES admin_accounts(id),
 action text NOT NULL CHECK (action IN ('reversal_requested','reversal_completed')),
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM referral_rewards WHERE status IN ('recovery_pending','reversed')) THEN
  RAISE EXCEPTION 'Cannot roll back referral recovery records';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE referral_reward_actions;
DROP INDEX referral_rewards_status;
DROP INDEX referral_rewards_invitee;
ALTER TABLE referral_rewards DROP COLUMN status,DROP COLUMN decision_reason,DROP COLUMN config_snapshot,
 DROP COLUMN reversed_at,DROP COLUMN reversal_reason,DROP COLUMN reversal_admin_id;
