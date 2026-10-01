-- +goose Up
-- 用户可自行停用 API Key（paused），随时重新启用；与风控冻结（frozen）、撤销（revoked）区分。
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS ck_user_api_key_status;
ALTER TABLE user_api_keys
    ADD CONSTRAINT ck_user_api_key_status CHECK (status IN ('active','paused','frozen','revoked')) NOT VALID;
ALTER TABLE user_api_keys VALIDATE CONSTRAINT ck_user_api_key_status;

-- +goose Down
UPDATE user_api_keys SET status='active',updated_at=now() WHERE status='paused';
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS ck_user_api_key_status;
ALTER TABLE user_api_keys
    ADD CONSTRAINT ck_user_api_key_status CHECK (status IN ('active','frozen','revoked')) NOT VALID;
ALTER TABLE user_api_keys VALIDATE CONSTRAINT ck_user_api_key_status;
