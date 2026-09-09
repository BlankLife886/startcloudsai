-- +goose Up
CREATE TABLE referral_codes (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 code text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE referral_links (
 invitee_id uuid PRIMARY KEY REFERENCES users(id),
 inviter_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (invitee_id <> inviter_id)
);
CREATE INDEX referral_links_inviter ON referral_links(inviter_id, created_at DESC);
CREATE TABLE referral_rewards (
 order_id uuid PRIMARY KEY REFERENCES orders(id),
 inviter_id uuid NOT NULL REFERENCES users(id),
 invitee_id uuid NOT NULL REFERENCES users(id),
 base_points bigint NOT NULL CHECK (base_points > 0),
 reward_points bigint NOT NULL CHECK (reward_points >= 0),
 mode text NOT NULL CHECK (mode IN ('percent','fixed')),
 rate integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_rewards_inviter ON referral_rewards(inviter_id, created_at DESC);

-- +goose Down
DROP TABLE referral_rewards;
DROP TABLE referral_links;
DROP TABLE referral_codes;
