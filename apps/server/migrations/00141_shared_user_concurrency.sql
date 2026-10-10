-- +goose Up
INSERT INTO app_settings(key,value,updated_at)
SELECT 'user_concurrency_before_shared',value,now() FROM app_settings WHERE key='user_max_concurrent_tasks'
ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings(key,value,updated_at) VALUES('user_max_concurrent_tasks','4'::jsonb,now())
ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM subscriptions WHERE billing_contract ? 'concurrencyBonus') THEN
  RAISE EXCEPTION 'shared concurrency contracts exist; audited rollback required';
 END IF;
END $$;
-- +goose StatementEnd
UPDATE app_settings SET value=COALESCE((SELECT value FROM app_settings WHERE key='user_concurrency_before_shared'),'20'::jsonb),updated_at=now()
WHERE key='user_max_concurrent_tasks' AND value='4'::jsonb;
DELETE FROM app_settings WHERE key='user_concurrency_before_shared';
