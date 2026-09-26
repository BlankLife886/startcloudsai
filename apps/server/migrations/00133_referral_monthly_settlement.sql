-- +goose Up
CREATE TABLE referral_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 inviter_id uuid NOT NULL REFERENCES users(id),
 settlement_month date NOT NULL,
 points bigint NOT NULL CHECK (points>0),
 reward_count bigint NOT NULL CHECK (reward_count>0),
 settled_at timestamptz NOT NULL,
 UNIQUE(inviter_id,settlement_month)
);
ALTER TABLE referral_rewards DROP CONSTRAINT referral_rewards_status_check;
ALTER TABLE referral_rewards ADD CONSTRAINT referral_rewards_status_check
 CHECK(status IN ('pending_settlement','granted','skipped','voided','recovery_pending','reversed'));
ALTER TABLE referral_rewards
 ADD COLUMN settlement_month date GENERATED ALWAYS AS (date_trunc('month',created_at AT TIME ZONE 'Asia/Shanghai')::date) STORED,
 ADD COLUMN settlement_due_at timestamptz GENERATED ALWAYS AS ((date_trunc('month',created_at AT TIME ZONE 'Asia/Shanghai') + interval '1 month 5 minutes') AT TIME ZONE 'Asia/Shanghai') STORED,
 ADD COLUMN settlement_id uuid REFERENCES referral_settlements(id),
 ADD COLUMN settled_at timestamptz,
 ADD COLUMN voided_at timestamptz,
 ADD COLUMN settlement_retry_at timestamptz,
 ADD COLUMN settlement_error text NOT NULL DEFAULT '';
-- Historic credited rewards remain credited and are never enqueued for payment again.
UPDATE referral_rewards r SET settled_at=COALESCE((SELECT l.created_at FROM wallet_ledger l
 WHERE l.kind='grant' AND l.source_type='referral' AND l.source_id=r.order_id::text),r.created_at)
 WHERE r.status IN ('granted','recovery_pending','reversed');
ALTER TABLE referral_rewards ADD CONSTRAINT referral_rewards_paid_timestamp
 CHECK(status NOT IN ('granted','recovery_pending','reversed') OR settled_at IS NOT NULL);
CREATE INDEX referral_rewards_month_due ON referral_rewards(settlement_due_at,inviter_id,settlement_month)
 WHERE status='pending_settlement';
ALTER TABLE referral_reward_actions DROP CONSTRAINT referral_reward_actions_action_check;
ALTER TABLE referral_reward_actions ADD CONSTRAINT referral_reward_actions_action_check
 CHECK(action IN ('reversal_requested','reversal_completed','reward_voided'));

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM referral_rewards WHERE status IN ('pending_settlement','voided') OR settlement_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Cannot discard monthly referral accruals or settlements';
 END IF;
END $$;
-- +goose StatementEnd
DROP INDEX referral_rewards_month_due;
ALTER TABLE referral_rewards DROP CONSTRAINT referral_rewards_paid_timestamp;
ALTER TABLE referral_rewards DROP COLUMN settlement_month,DROP COLUMN settlement_due_at,DROP COLUMN settlement_id,
 DROP COLUMN settled_at,DROP COLUMN voided_at,DROP COLUMN settlement_retry_at,DROP COLUMN settlement_error;
DROP TABLE referral_settlements;
ALTER TABLE referral_rewards DROP CONSTRAINT referral_rewards_status_check;
ALTER TABLE referral_rewards ADD CONSTRAINT referral_rewards_status_check CHECK(status IN ('granted','skipped','recovery_pending','reversed'));
ALTER TABLE referral_reward_actions DROP CONSTRAINT referral_reward_actions_action_check;
ALTER TABLE referral_reward_actions ADD CONSTRAINT referral_reward_actions_action_check CHECK(action IN ('reversal_requested','reversal_completed'));
