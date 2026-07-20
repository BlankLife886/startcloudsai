-- +goose Up
-- 兑换码（CDK）
CREATE TABLE redemption_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    grant_cents bigint NOT NULL,
    batch_id text NOT NULL,
    note text,
    status text NOT NULL DEFAULT 'active',
    expires_at timestamptz,
    redeemed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_redemption_codes_grant_positive CHECK (grant_cents > 0),
    CONSTRAINT ck_redemption_codes_status CHECK (status IN ('active','redeemed','disabled'))
);
CREATE INDEX ix_redemption_codes_batch ON redemption_codes (batch_id);
CREATE INDEX ix_redemption_codes_status_created ON redemption_codes (status, created_at DESC);

-- 套餐扩展：kind（topup 充值包 / subscription 订阅）
ALTER TABLE plans
    ADD COLUMN kind text NOT NULL DEFAULT 'topup',
    ADD COLUMN duration_days integer NOT NULL DEFAULT 0,
    ADD COLUMN daily_grant_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE plans
    ADD CONSTRAINT ck_plans_kind CHECK (kind IN ('topup','subscription'));

-- 订阅期
CREATE TABLE subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL REFERENCES plans(id),
    order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    daily_grant_cents bigint NOT NULL,
    last_granted_date date,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_subscriptions_status CHECK (status IN ('active','expired'))
);
CREATE INDEX ix_subscriptions_status_ends ON subscriptions (status, ends_at);
CREATE INDEX ix_subscriptions_user_ends ON subscriptions (user_id, ends_at DESC);

-- +goose Down
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE plans
    DROP CONSTRAINT IF EXISTS ck_plans_kind,
    DROP COLUMN IF EXISTS daily_grant_cents,
    DROP COLUMN IF EXISTS duration_days,
    DROP COLUMN IF EXISTS kind;
DROP TABLE IF EXISTS redemption_codes;
