-- +goose Up
-- 技能“使用说明”：告诉用户这个技能适合做什么、怎么写需求、有哪些示例。
-- 官方技能对用户只展示使用说明，正文（instruction）由服务端在调用模型时展开，
-- 不再下发给用户端。
ALTER TABLE image_skills ADD COLUMN usage_guide text NOT NULL DEFAULT '';
ALTER TABLE image_skills
    ADD CONSTRAINT ck_image_skills_usage_guide CHECK (char_length(usage_guide) <= 2000);

-- +goose Down
ALTER TABLE image_skills DROP CONSTRAINT IF EXISTS ck_image_skills_usage_guide;
ALTER TABLE image_skills DROP COLUMN IF EXISTS usage_guide;
