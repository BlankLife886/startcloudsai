-- +goose Up
-- 官方技能配图：cover_key 作为技能库卡片与详情的封面；sample_images 是详情里的
-- 效果示例图，[{ "key": "skill-images/...", "caption": "..." }]，按数组顺序展示。
ALTER TABLE image_skills ADD COLUMN sample_images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE image_skills DROP COLUMN IF EXISTS sample_images;
