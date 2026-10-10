-- +goose Up
-- 内容违规记录：上游因内容违规驳回的生图请求。每条记录说明当时的提示词、上游原话、
-- 命中的识别规则，以及这次是扣费、按每日免扣次数退回，还是事后由管理员退回。
CREATE TABLE content_policy_violations (
    id               uuid PRIMARY KEY,
    user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type      text NOT NULL,
    source_id        text NOT NULL,
    feature          text NOT NULL DEFAULT '',
    model_id         text NOT NULL DEFAULT '',
    prompt           text NOT NULL DEFAULT '',
    upstream_message text NOT NULL DEFAULT '',
    matched_rule     text NOT NULL DEFAULT '',
    amount_cents     bigint NOT NULL DEFAULT 0,
    charged_cents    bigint NOT NULL DEFAULT 0,
    status           text NOT NULL,
    waive_reason     text NOT NULL DEFAULT '',
    refunded_at      timestamptz,
    refunded_by      uuid,
    refund_note      text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_content_policy_violation_source UNIQUE (source_type, source_id),
    CONSTRAINT ck_content_policy_violation_source CHECK (source_type IN ('task', 'assistant_run', 'developer_api')),
    CONSTRAINT ck_content_policy_violation_status CHECK (status IN ('charged', 'waived', 'refunded')),
    CONSTRAINT ck_content_policy_violation_amounts CHECK (amount_cents >= 0 AND charged_cents >= 0)
);
CREATE INDEX idx_content_policy_violations_user_time ON content_policy_violations (user_id, created_at DESC);
CREATE INDEX idx_content_policy_violations_time ON content_policy_violations (created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS content_policy_violations;
