-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email citext NOT NULL UNIQUE,
    username text NOT NULL,
    password_hash text NOT NULL,
    avatar_url text,
    role text NOT NULL DEFAULT 'user',
    status text NOT NULL DEFAULT 'active',
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_users_role CHECK (role IN ('user','admin')),
    CONSTRAINT ck_users_status CHECK (status IN ('active','banned'))
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    ip text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sessions_user_id ON sessions (user_id);

CREATE TABLE wallets (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance_cents bigint NOT NULL DEFAULT 0,
    frozen_cents bigint NOT NULL DEFAULT 0,
    updated_at timestamptz,
    CONSTRAINT ck_wallets_balance_nonneg CHECK (balance_cents >= 0),
    CONSTRAINT ck_wallets_frozen_nonneg CHECK (frozen_cents >= 0)
);

CREATE TABLE wallet_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    delta_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    source_type text NOT NULL,
    source_id text,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_wallet_ledger_kind CHECK (kind IN ('grant','spend','freeze','release','refund','admin_adjust'))
);
CREATE INDEX ix_wallet_ledger_user_created ON wallet_ledger (user_id, created_at);
CREATE UNIQUE INDEX uq_wallet_ledger_idem ON wallet_ledger (kind, source_type, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    price_cents bigint NOT NULL,
    grant_cents bigint NOT NULL,
    bonus_cents bigint NOT NULL DEFAULT 0,
    features jsonb NOT NULL DEFAULT '[]'::jsonb,
    active boolean NOT NULL DEFAULT true,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL REFERENCES plans(id),
    amount_cents bigint NOT NULL,
    grant_cents bigint NOT NULL,
    bonus_cents bigint NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending',
    provider text NOT NULL DEFAULT 'mock',
    provider_order_id text,
    paid_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_orders_status CHECK (status IN ('pending','paid','completed','failed','expired'))
);
CREATE INDEX ix_orders_user_created ON orders (user_id, created_at);
CREATE INDEX ix_orders_status ON orders (status);
CREATE UNIQUE INDEX uq_orders_provider_order ON orders (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    prompt text NOT NULL,
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    count integer NOT NULL DEFAULT 1,
    input_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    output_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    cost_cents bigint NOT NULL,
    idempotency_key text,
    error_code text,
    error_message text,
    attempt integer NOT NULL DEFAULT 0,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_tasks_type CHECK (type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle')),
    CONSTRAINT ck_tasks_status CHECK (status IN ('queued','running','succeeded','failed','canceled')),
    CONSTRAINT ck_tasks_count CHECK (count >= 1 AND count <= 4)
);
CREATE INDEX ix_tasks_user_created ON tasks (user_id, created_at);
CREATE INDEX ix_tasks_status_created ON tasks (status, created_at);
CREATE UNIQUE INDEX uq_tasks_user_idem ON tasks (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE gallery_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    title text,
    status text NOT NULL DEFAULT 'pending',
    cover_key text,
    media_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    reject_reason text,
    reviewed_by uuid REFERENCES users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_gallery_submissions_status CHECK (status IN ('pending','approved','rejected','removed'))
);
CREATE INDEX ix_gallery_submissions_status_created ON gallery_submissions (status, created_at);

CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'system',
    title text NOT NULL,
    body text,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notifications_user_created ON notifications (user_id, created_at);

CREATE TABLE notification_reads (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    body text,
    active boolean NOT NULL DEFAULT true,
    starts_at timestamptz,
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE changelog_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text NOT NULL,
    date date NOT NULL,
    tag text NOT NULL,
    title text NOT NULL,
    summary text,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    highlight boolean NOT NULL DEFAULT false,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_changelog_entries_tag CHECK (tag IN ('feature','experience'))
);

CREATE TABLE app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz
);

-- +goose Down
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS changelog_entries;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS notification_reads;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS gallery_submissions;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS wallet_ledger;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
