-- +goose Up
-- 调用名（slug）：与 Codex SKILL.md 的 frontmatter `name` 同构，hyphen-case，
-- 用户可在提示词里用 `$slug` 显式调用某个 Skill（无论是否装载）。
-- 官方 Skill 全局唯一；用户自建在自己名下唯一，允许和官方同名（解析时自建优先）。
ALTER TABLE image_skills ADD COLUMN slug text;
UPDATE image_skills
   SET slug = 'skill-' || left(replace(id::text, '-', ''), 8)
 WHERE slug IS NULL;
ALTER TABLE image_skills ALTER COLUMN slug SET NOT NULL;
ALTER TABLE image_skills
    ADD CONSTRAINT ck_image_skills_slug
    CHECK (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND char_length(slug) <= 64);
CREATE UNIQUE INDEX ux_image_skills_official_slug ON image_skills (slug)
    WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX ux_image_skills_owner_slug ON image_skills (owner_user_id, slug)
    WHERE owner_user_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS ux_image_skills_owner_slug;
DROP INDEX IF EXISTS ux_image_skills_official_slug;
ALTER TABLE image_skills DROP CONSTRAINT IF EXISTS ck_image_skills_slug;
ALTER TABLE image_skills DROP COLUMN IF EXISTS slug;
