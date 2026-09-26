-- +goose Up
ALTER TABLE usage_profit_ledger DROP CONSTRAINT ck_usage_profit_source;
ALTER TABLE usage_profit_ledger
    ADD CONSTRAINT ck_usage_profit_source CHECK (source_type IN ('task','assistant_run','developer_api'));

-- +goose Down
ALTER TABLE usage_profit_ledger DROP CONSTRAINT ck_usage_profit_source;
ALTER TABLE usage_profit_ledger
    ADD CONSTRAINT ck_usage_profit_source CHECK (source_type IN ('task','assistant_run'));
