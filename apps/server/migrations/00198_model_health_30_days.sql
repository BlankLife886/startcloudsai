-- +goose Up
-- 模型状态页的单价改为展示 30 天：聚合表保留期从 7 天延长到 30 天。
-- 聚合表是派生数据，清空后由 worker 下次运行按新保留期回填 30 天。
TRUNCATE model_health_hourly;

-- +goose Down
SELECT 1;
