-- +goose Up
-- 技能来源地址：改编自开源项目的官方技能记录上游仓库（通常是 GitHub），
-- 用户端技能详情显示为一个图标，点击跳转。空串表示没有来源。
ALTER TABLE image_skills ADD COLUMN source_url text NOT NULL DEFAULT '';
ALTER TABLE image_skills
    ADD CONSTRAINT ck_image_skills_source_url CHECK (
        source_url = '' OR (char_length(source_url) <= 300 AND source_url LIKE 'https://%')
    );

-- +goose Down
ALTER TABLE image_skills DROP CONSTRAINT IF EXISTS ck_image_skills_source_url;
ALTER TABLE image_skills DROP COLUMN IF EXISTS source_url;
