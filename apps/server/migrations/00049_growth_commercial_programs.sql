-- +goose Up
ALTER TABLE user_feedback
    ADD COLUMN adopted boolean NOT NULL DEFAULT false,
    ADD COLUMN reward_cents bigint NOT NULL DEFAULT 0,
    ADD COLUMN rewarded_at timestamptz;

ALTER TABLE user_feedback
    ADD CONSTRAINT ck_user_feedback_reward_nonnegative CHECK (reward_cents >= 0),
    ADD CONSTRAINT ck_user_feedback_adoption_reward
        CHECK ((NOT adopted AND reward_cents = 0 AND rewarded_at IS NULL) OR adopted);

CREATE TABLE commercial_program_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_type text NOT NULL,
    role_title text NOT NULL,
    organization text NOT NULL DEFAULT '',
    contact text NOT NULL DEFAULT '',
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    review_note text,
    reward_cents bigint NOT NULL DEFAULT 0,
    reviewed_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_commercial_program_user_type UNIQUE (user_id, program_type),
    CONSTRAINT ck_commercial_program_type
        CHECK (program_type IN ('broker', 'agent', 'advertising', 'ecosystem')),
    CONSTRAINT ck_commercial_program_status
        CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT ck_commercial_program_role_length
        CHECK (char_length(role_title) BETWEEN 2 AND 80),
    CONSTRAINT ck_commercial_program_organization_length
        CHECK (char_length(organization) <= 160),
    CONSTRAINT ck_commercial_program_contact_length
        CHECK (char_length(contact) <= 160),
    CONSTRAINT ck_commercial_program_reason_length
        CHECK (char_length(reason) BETWEEN 10 AND 2000),
    CONSTRAINT ck_commercial_program_review_note_length
        CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
    CONSTRAINT ck_commercial_program_reward_nonnegative CHECK (reward_cents >= 0)
);

CREATE INDEX ix_commercial_program_status_created
    ON commercial_program_applications (status, created_at DESC, id DESC);

CREATE TABLE growth_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_key text NOT NULL,
    code text NOT NULL UNIQUE,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'active',
    target_members integer NOT NULL,
    reward_cents bigint NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_growth_group_campaign_length CHECK (char_length(campaign_key) BETWEEN 2 AND 64),
    CONSTRAINT ck_growth_group_code_length CHECK (char_length(code) BETWEEN 6 AND 16),
    CONSTRAINT ck_growth_group_status CHECK (status IN ('active', 'completed', 'expired')),
    CONSTRAINT ck_growth_group_target CHECK (target_members BETWEEN 2 AND 10),
    CONSTRAINT ck_growth_group_reward CHECK (reward_cents BETWEEN 0 AND 1000000)
);

CREATE INDEX ix_growth_groups_campaign_status
    ON growth_groups (campaign_key, status, expires_at, created_at DESC);

CREATE TABLE growth_group_members (
    group_id uuid NOT NULL REFERENCES growth_groups(id) ON DELETE CASCADE,
    campaign_key text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member',
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT ck_growth_group_member_role CHECK (role IN ('owner', 'member'))
);

CREATE INDEX ix_growth_group_members_group_joined
    ON growth_group_members (group_id, joined_at, user_id);
CREATE INDEX ix_growth_group_members_campaign_user
    ON growth_group_members (campaign_key, user_id, joined_at DESC);

-- +goose Down
DROP TABLE IF EXISTS growth_group_members;
DROP TABLE IF EXISTS growth_groups;
DROP TABLE IF EXISTS commercial_program_applications;
ALTER TABLE user_feedback
    DROP CONSTRAINT IF EXISTS ck_user_feedback_adoption_reward,
    DROP CONSTRAINT IF EXISTS ck_user_feedback_reward_nonnegative,
    DROP COLUMN IF EXISTS rewarded_at,
    DROP COLUMN IF EXISTS reward_cents,
    DROP COLUMN IF EXISTS adopted;
