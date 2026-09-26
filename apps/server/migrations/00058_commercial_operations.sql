-- +goose Up
CREATE TABLE commercial_partner_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id uuid NOT NULL REFERENCES commercial_program_applications(id) ON DELETE RESTRICT,
    program_type text NOT NULL,
    partner_code text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active',
    commission_bps integer NOT NULL DEFAULT 1000,
    platform_fee_bps integer NOT NULL DEFAULT 2000,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_commercial_partner_user_type UNIQUE (user_id, program_type),
    CONSTRAINT uq_commercial_partner_application UNIQUE (application_id),
    CONSTRAINT ck_commercial_partner_program CHECK (program_type IN ('broker','agent','advertising','ecosystem')),
    CONSTRAINT ck_commercial_partner_status CHECK (status IN ('active','suspended','closed')),
    CONSTRAINT ck_commercial_partner_commission CHECK (commission_bps BETWEEN 0 AND 5000),
    CONSTRAINT ck_commercial_partner_platform_fee CHECK (platform_fee_bps BETWEEN 0 AND 5000)
);

CREATE INDEX ix_commercial_partner_program_status
    ON commercial_partner_accounts (program_type, status, created_at DESC);

-- Existing approved applications must become operating accounts as well; an
-- upgrade must not leave previously approved users stuck in an application-only state.
INSERT INTO commercial_partner_accounts
    (user_id, application_id, program_type, partner_code, commission_bps, platform_fee_bps, created_at, updated_at)
SELECT user_id, id, program_type,
       CASE program_type WHEN 'broker' THEN 'BRO' WHEN 'agent' THEN 'AGT'
            WHEN 'advertising' THEN 'ADS' ELSE 'ECO' END || upper(substr(md5(id::text), 1, 16)),
       CASE program_type WHEN 'broker' THEN 1000 WHEN 'agent' THEN 1500 ELSE 0 END,
       CASE program_type WHEN 'ecosystem' THEN 2000 ELSE 0 END,
       COALESCE(reviewed_at, created_at), COALESCE(reviewed_at, updated_at)
FROM commercial_program_applications
WHERE status = 'approved'
ON CONFLICT (user_id, program_type) DO NOTHING;

CREATE TABLE broker_deals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id uuid NOT NULL REFERENCES commercial_partner_accounts(id) ON DELETE RESTRICT,
    client_name text NOT NULL,
    client_contact text NOT NULL DEFAULT '',
    project_title text NOT NULL,
    description text NOT NULL DEFAULT '',
    expected_amount_cents bigint NOT NULL DEFAULT 0,
    actual_amount_cents bigint NOT NULL DEFAULT 0,
    commission_bps integer NOT NULL,
    commission_cents bigint NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'submitted',
    admin_note text,
    settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_broker_deal_status CHECK (status IN ('submitted','qualified','contracted','delivered','settled','rejected','canceled')),
    CONSTRAINT ck_broker_deal_amounts CHECK (expected_amount_cents >= 0 AND actual_amount_cents >= 0 AND commission_cents >= 0),
    CONSTRAINT ck_broker_deal_commission CHECK (commission_bps BETWEEN 0 AND 5000),
    CONSTRAINT ck_broker_deal_client_length CHECK (char_length(client_name) BETWEEN 2 AND 120),
    CONSTRAINT ck_broker_deal_project_length CHECK (char_length(project_title) BETWEEN 2 AND 160)
);

CREATE INDEX ix_broker_deals_partner_created ON broker_deals (partner_id, created_at DESC);
CREATE INDEX ix_broker_deals_status_created ON broker_deals (status, created_at DESC);

CREATE TABLE agent_referrals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id uuid NOT NULL REFERENCES commercial_partner_accounts(id) ON DELETE RESTRICT,
    referred_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_agent_referral_user UNIQUE (referred_user_id),
    CONSTRAINT ck_agent_referral_status CHECK (status IN ('active','blocked'))
);

CREATE INDEX ix_agent_referrals_partner_created ON agent_referrals (partner_id, created_at DESC);

CREATE TABLE agent_commissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id uuid NOT NULL REFERENCES commercial_partner_accounts(id) ON DELETE RESTRICT,
    referral_id uuid NOT NULL REFERENCES agent_referrals(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    order_amount_cents bigint NOT NULL,
    commission_bps integer NOT NULL,
    commission_cents bigint NOT NULL,
    status text NOT NULL DEFAULT 'settled',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_agent_commission_order UNIQUE (order_id),
    CONSTRAINT ck_agent_commission_status CHECK (status IN ('settled','reversed')),
    CONSTRAINT ck_agent_commission_amounts CHECK (order_amount_cents >= 0 AND commission_cents >= 0),
    CONSTRAINT ck_agent_commission_rate CHECK (commission_bps BETWEEN 0 AND 5000)
);

CREATE INDEX ix_agent_commissions_partner_created ON agent_commissions (partner_id, created_at DESC);

CREATE TABLE ad_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id uuid NOT NULL REFERENCES commercial_partner_accounts(id) ON DELETE RESTRICT,
    title text NOT NULL,
    creative_text text NOT NULL,
    destination_url text NOT NULL,
    placement text NOT NULL DEFAULT 'growth_center',
    budget_cents bigint NOT NULL,
    status text NOT NULL DEFAULT 'submitted',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    impression_count bigint NOT NULL DEFAULT 0,
    click_count bigint NOT NULL DEFAULT 0,
    charged_at timestamptz,
    reviewed_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    admin_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_ad_campaign_status CHECK (status IN ('submitted','scheduled','active','paused','completed','rejected','canceled')),
    CONSTRAINT ck_ad_campaign_placement CHECK (placement IN ('growth_center')),
    CONSTRAINT ck_ad_campaign_budget CHECK (budget_cents BETWEEN 1 AND 1000000000),
    CONSTRAINT ck_ad_campaign_dates CHECK (ends_at > starts_at),
    CONSTRAINT ck_ad_campaign_metrics CHECK (impression_count >= 0 AND click_count >= 0),
    CONSTRAINT ck_ad_campaign_title_length CHECK (char_length(title) BETWEEN 2 AND 100),
    CONSTRAINT ck_ad_campaign_creative_length CHECK (char_length(creative_text) BETWEEN 10 AND 300)
);

CREATE INDEX ix_ad_campaigns_partner_created ON ad_campaigns (partner_id, created_at DESC);
CREATE INDEX ix_ad_campaigns_delivery ON ad_campaigns (placement, status, starts_at, ends_at);

CREATE TABLE ecosystem_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id uuid NOT NULL REFERENCES commercial_partner_accounts(id) ON DELETE RESTRICT,
    name text NOT NULL,
    category text NOT NULL,
    summary text NOT NULL,
    description text NOT NULL DEFAULT '',
    delivery_url text NOT NULL,
    pricing_model text NOT NULL DEFAULT 'free',
    price_cents bigint NOT NULL DEFAULT 0,
    platform_fee_bps integer NOT NULL,
    status text NOT NULL DEFAULT 'submitted',
    sales_count bigint NOT NULL DEFAULT 0,
    gross_cents bigint NOT NULL DEFAULT 0,
    reviewed_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    admin_note text,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_ecosystem_listing_category CHECK (category IN ('model','plugin','template','workflow','service')),
    CONSTRAINT ck_ecosystem_listing_pricing CHECK (pricing_model IN ('free','paid','external')),
    CONSTRAINT ck_ecosystem_listing_price CHECK ((pricing_model='paid' AND price_cents > 0) OR (pricing_model<>'paid' AND price_cents=0)),
    CONSTRAINT ck_ecosystem_listing_fee CHECK (platform_fee_bps BETWEEN 0 AND 5000),
    CONSTRAINT ck_ecosystem_listing_status CHECK (status IN ('submitted','published','rejected','suspended')),
    CONSTRAINT ck_ecosystem_listing_sales CHECK (sales_count >= 0 AND gross_cents >= 0),
    CONSTRAINT ck_ecosystem_listing_name_length CHECK (char_length(name) BETWEEN 2 AND 100),
    CONSTRAINT ck_ecosystem_listing_summary_length CHECK (char_length(summary) BETWEEN 10 AND 300)
);

CREATE INDEX ix_ecosystem_listings_partner_created ON ecosystem_listings (partner_id, created_at DESC);
CREATE INDEX ix_ecosystem_listings_public ON ecosystem_listings (status, category, published_at DESC);

CREATE TABLE ecosystem_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES ecosystem_listings(id) ON DELETE RESTRICT,
    buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    price_cents bigint NOT NULL,
    platform_fee_cents bigint NOT NULL,
    partner_revenue_cents bigint NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_ecosystem_order_buyer_listing UNIQUE (buyer_id, listing_id),
    CONSTRAINT ck_ecosystem_order_status CHECK (status IN ('completed','refunded')),
    CONSTRAINT ck_ecosystem_order_amounts CHECK (price_cents >= 0 AND platform_fee_cents >= 0 AND partner_revenue_cents >= 0 AND platform_fee_cents + partner_revenue_cents = price_cents)
);

CREATE INDEX ix_ecosystem_orders_listing_created ON ecosystem_orders (listing_id, created_at DESC);
CREATE INDEX ix_ecosystem_orders_buyer_created ON ecosystem_orders (buyer_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS ecosystem_orders;
DROP TABLE IF EXISTS ecosystem_listings;
DROP TABLE IF EXISTS ad_campaigns;
DROP TABLE IF EXISTS agent_commissions;
DROP TABLE IF EXISTS agent_referrals;
DROP TABLE IF EXISTS broker_deals;
DROP TABLE IF EXISTS commercial_partner_accounts;
