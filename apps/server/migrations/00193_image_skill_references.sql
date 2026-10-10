-- +goose Up
-- 官方技能的参考资料：SKILL.md 之外的 references/*.md、assets/*.md。
-- 只给 AI 助手按需读取（read_skill_reference），不下发给用户端，也不拼进生图提示词。
CREATE TABLE image_skill_references (
    skill_id uuid NOT NULL REFERENCES image_skills(id) ON DELETE CASCADE,
    path text NOT NULL,
    title text NOT NULL DEFAULT '',
    purpose text NOT NULL DEFAULT '',
    content text NOT NULL,
    sort int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (skill_id, path),
    CONSTRAINT ck_image_skill_references_path CHECK (path ~ '^(references|assets)/[A-Za-z0-9][A-Za-z0-9._-]*\.(md|txt)$' AND char_length(path) <= 120),
    CONSTRAINT ck_image_skill_references_content CHECK (octet_length(content) <= 65536)
);

-- +goose Down
DROP TABLE IF EXISTS image_skill_references;
