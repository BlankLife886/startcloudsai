-- +goose Up
-- 套图记录同时承载助手发起的其它出图类工作（目前是图片工具，如背景移除）：
-- kind 区分来源，shots 里每张图自带输入图与工具。
ALTER TABLE assistant_commerce_sets ADD COLUMN kind text NOT NULL DEFAULT 'commerce';
ALTER TABLE assistant_commerce_sets ADD CONSTRAINT ck_assistant_commerce_sets_kind CHECK (kind IN ('commerce', 'tool'));

-- +goose Down
ALTER TABLE assistant_commerce_sets DROP CONSTRAINT IF EXISTS ck_assistant_commerce_sets_kind;
ALTER TABLE assistant_commerce_sets DROP COLUMN IF EXISTS kind;
