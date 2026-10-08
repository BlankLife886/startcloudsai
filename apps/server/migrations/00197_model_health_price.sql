-- +goose Up
-- 模型状态页改为展示 7 天，并新增价格曲线：每小时记录调用时生效单价的中位数。
-- 聚合表是派生数据，清空后由 worker 下次运行按新口径回填 7 天。
ALTER TABLE model_health_hourly ADD COLUMN price_cents bigint;
TRUNCATE model_health_hourly;

-- +goose Down
ALTER TABLE model_health_hourly DROP COLUMN IF EXISTS price_cents;
