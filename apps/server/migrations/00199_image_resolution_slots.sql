-- +goose Up
-- 生图模型按分辨率配置「主模型 + 备用模型」后的运行状态。
-- 槽位配置本身在 model_dispatch_config 里；这里只存会随运行变化的部分。

-- 每个模型在每个分辨率上的健康度：连续失败达到阈值即判定故障，
-- 成功一次（真实任务或定时检测）即恢复。
CREATE TABLE image_slot_member_health (
    model_id             text        NOT NULL,
    resolution           text        NOT NULL,
    status               text        NOT NULL DEFAULT 'healthy',
    consecutive_failures int         NOT NULL DEFAULT 0,
    last_failure_at      timestamptz,
    last_failure_message text        NOT NULL DEFAULT '',
    last_success_at      timestamptz,
    down_since           timestamptz,
    last_probe_at        timestamptz,
    last_probe_ok        boolean,
    last_probe_message   text        NOT NULL DEFAULT '',
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (model_id, resolution),
    CONSTRAINT ck_image_slot_member_health_status CHECK (status IN ('healthy', 'down'))
);

-- 每个公开模型的每个分辨率槽位当前在用哪个模型。
-- 自动切换时由健康度推导；手动模式下由管理员指定。
CREATE TABLE image_slot_states (
    model_id        text        NOT NULL,
    resolution      text        NOT NULL,
    active_model_id text        NOT NULL,
    all_down        boolean     NOT NULL DEFAULT false,
    manual_model_id text,
    switched_at     timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (model_id, resolution)
);

-- 切换、故障、恢复、检测记录，供后台查看，也用于统计每日检测次数。
CREATE TABLE image_slot_events (
    id              bigserial   PRIMARY KEY,
    model_id        text        NOT NULL DEFAULT '',
    resolution      text        NOT NULL,
    kind            text        NOT NULL,
    member_model_id text        NOT NULL DEFAULT '',
    from_model_id   text        NOT NULL DEFAULT '',
    to_model_id     text        NOT NULL DEFAULT '',
    ok              boolean,
    message         text        NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_image_slot_events_slot ON image_slot_events (model_id, resolution, created_at DESC);
CREATE INDEX ix_image_slot_events_member ON image_slot_events (member_model_id, resolution, created_at DESC);
CREATE INDEX ix_image_slot_events_probe ON image_slot_events (created_at) WHERE kind = 'probe';

-- +goose Down
DROP TABLE image_slot_events;
DROP TABLE image_slot_states;
DROP TABLE image_slot_member_health;
