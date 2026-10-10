-- +goose Up
-- 技能不再"装载"到页面或全局，而是在输入框里以 @ 按需调用，装载表随之废弃。
DROP TABLE IF EXISTS user_skill_bindings;

-- +goose Down
CREATE TABLE user_skill_bindings (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope text NOT NULL,
    skill_id uuid NOT NULL REFERENCES image_skills(id) ON DELETE CASCADE,
    sort integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope, skill_id),
    CONSTRAINT ck_user_skill_bindings_scope CHECK (scope IN (
        'global','t2i','coloring','ui_design','ecommerce_design','model_sheet','game_art'
    ))
);
CREATE INDEX ix_user_skill_bindings_skill ON user_skill_bindings (skill_id);
