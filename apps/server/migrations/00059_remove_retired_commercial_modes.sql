-- +goose Up
-- 中介、代理、广告、平台生态及免费日额度已从产品职责中撤下。
-- 钱包流水是不可变账务记录，保留历史 source_type，停止产生新流水。
DROP TABLE IF EXISTS ecosystem_orders;
DROP TABLE IF EXISTS ecosystem_listings;
DROP TABLE IF EXISTS ad_campaigns;
DROP TABLE IF EXISTS agent_commissions;
DROP TABLE IF EXISTS agent_referrals;
DROP TABLE IF EXISTS broker_deals;
DROP TABLE IF EXISTS commercial_partner_accounts;
DROP TABLE IF EXISTS commercial_program_applications;

DELETE FROM app_settings
WHERE key IN ('free_daily_cents', 'growth_partner_applications_enabled');

-- +goose Down
-- Irreversible by design: removed business data and retired modes must not be restored.
