-- +goose Up
-- Agent 自动授权：开启后 Agent 整理出的图片方案不再等用户点确认，直接提交生成。
-- 预算是单轮上限，超过就退回到需要确认的方案卡，避免一次意外消耗大量积分。
-- 默认关闭；默认预算 60 约等于两张图，开启后仍然拦得住大批量生成。
ALTER TABLE users
    ADD COLUMN assistant_auto_approve boolean NOT NULL DEFAULT false,
    ADD COLUMN assistant_auto_approve_budget_cents bigint NOT NULL DEFAULT 60;

ALTER TABLE users
    ADD CONSTRAINT ck_users_assistant_auto_approve_budget
    CHECK (assistant_auto_approve_budget_cents BETWEEN 0 AND 100000);

-- +goose Down
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_assistant_auto_approve_budget;
ALTER TABLE users DROP COLUMN IF EXISTS assistant_auto_approve_budget_cents;
ALTER TABLE users DROP COLUMN IF EXISTS assistant_auto_approve;
