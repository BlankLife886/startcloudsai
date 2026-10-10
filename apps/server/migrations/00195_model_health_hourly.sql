-- +goose Up
-- 公开模型状态页的小时聚合：worker 每 5 分钟从 tasks / assistant_runs 重算最近
-- 的小时桶（按完成时间归桶），90 天每日可用率和 24 小时曲线都从这里读。
-- 只存比例和耗时分位，不对外暴露调用量。
CREATE TABLE model_health_hourly (
    model_id        text        NOT NULL,
    bucket          timestamptz NOT NULL,
    succeeded       integer     NOT NULL DEFAULT 0,
    failed          integer     NOT NULL DEFAULT 0,
    excluded        integer     NOT NULL DEFAULT 0,
    latency_p50_ms  integer,
    latency_p95_ms  integer,
    ttft_p50_ms     integer,
    ttft_p95_ms     integer,
    speed_p50       double precision,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (model_id, bucket),
    CONSTRAINT ck_model_health_hourly_counts CHECK (succeeded >= 0 AND failed >= 0 AND excluded >= 0)
);
CREATE INDEX ix_model_health_hourly_bucket ON model_health_hourly (bucket);

-- +goose Down
DROP TABLE IF EXISTS model_health_hourly;
