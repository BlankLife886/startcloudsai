-- +goose Up
-- Skill 词库：owner_user_id 为 NULL 即后台录入的官方 skill，非 NULL 为用户自建。
-- 两者同构，用户可基于官方 skill 复制后修改。
CREATE TABLE image_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    instruction text NOT NULL,
    -- 适用的生图页面；空数组表示全部页面可用。
    task_types jsonb NOT NULL DEFAULT '[]'::jsonb,
    category text,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    cover_key text,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_image_skills_name CHECK (char_length(trim(name)) BETWEEN 1 AND 64),
    CONSTRAINT ck_image_skills_description CHECK (char_length(description) <= 500),
    CONSTRAINT ck_image_skills_instruction CHECK (char_length(trim(instruction)) BETWEEN 1 AND 4000),
    CONSTRAINT ck_image_skills_task_types CHECK (jsonb_typeof(task_types) = 'array'),
    CONSTRAINT ck_image_skills_tags CHECK (jsonb_typeof(tags) = 'array')
);
CREATE INDEX ix_image_skills_official ON image_skills (active, sort, created_at DESC)
    WHERE owner_user_id IS NULL;
CREATE INDEX ix_image_skills_owner ON image_skills (owner_user_id, created_at DESC)
    WHERE owner_user_id IS NOT NULL;

-- 装载状态：scope='global' 为全局自动装载，其余为单个生图页面的绑定。
-- 页面绑定优先于全局：某页面一旦有绑定行，该页面就只用这些 skill。
CREATE TABLE user_skill_bindings (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope text NOT NULL,
    skill_id uuid NOT NULL REFERENCES image_skills(id) ON DELETE CASCADE,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope, skill_id),
    -- 只收「用户自己写提示词」的生图页面。puzzle 是本地工具（POST /tasks 直接拒绝），
    -- background_remove 与 media_tool 的提示词是系统生成的固定文案，拼 skill 没有意义。
    CONSTRAINT ck_user_skill_bindings_scope CHECK (scope IN (
        'global','t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art'
    ))
);
CREATE INDEX ix_user_skill_bindings_skill ON user_skill_bindings (skill_id);

-- +goose Down
DROP TABLE IF EXISTS user_skill_bindings;
DROP TABLE IF EXISTS image_skills;
