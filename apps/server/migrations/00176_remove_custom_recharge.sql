-- +goose Up
-- 自定义金额充值下线：蓝鲸只配置固定金额收款码，任意金额无法扫码直付。
-- 历史订单的 recharge_policy_snapshot 保留用于对账与退款核算；方案只下架不删除。
UPDATE plans SET active=false, recommended=false, updated_at=now() WHERE recharge_policy IS NOT NULL AND active;
ALTER TABLE plans ADD CONSTRAINT ck_plans_custom_recharge_retired CHECK (recharge_policy IS NULL OR NOT active);

-- +goose Down
ALTER TABLE plans DROP CONSTRAINT ck_plans_custom_recharge_retired;
