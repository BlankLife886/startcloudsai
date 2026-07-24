-- +goose Up
ALTER TABLE prompt_library
    ADD COLUMN like_count integer NOT NULL DEFAULT 0,
    ADD COLUMN favorite_count integer NOT NULL DEFAULT 0,
    ADD COLUMN use_count integer NOT NULL DEFAULT 0;

-- 旧词条没有行为数据：依据原人工顺序叠加稳定散列，提供冷启动热度，
-- 后续真实点赞、收藏和使用会在这些初始值上持续累积。
UPDATE prompt_library
SET use_count = GREATEST(0, 1800 - sort) + mod(hashtext(id::text)::bigint + 2147483648, 41),
    favorite_count = GREATEST(0, (1200 - sort) / 8) + mod(hashtext(id::text || ':fav')::bigint + 2147483648, 13),
    like_count = GREATEST(0, (1500 - sort) / 5) + mod(hashtext(id::text || ':like')::bigint + 2147483648, 19);

CREATE TABLE prompt_user_engagement (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt_id uuid NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
    liked boolean NOT NULL DEFAULT false,
    favorited boolean NOT NULL DEFAULT false,
    use_count integer NOT NULL DEFAULT 0,
    last_used_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, prompt_id)
);

CREATE INDEX ix_prompt_library_popular
    ON prompt_library (active, favorite_count DESC, like_count DESC, use_count DESC, created_at DESC);
CREATE INDEX ix_prompt_user_engagement_favorites
    ON prompt_user_engagement (user_id, updated_at DESC) WHERE favorited;

-- +goose Down
DROP INDEX IF EXISTS ix_prompt_user_engagement_favorites;
DROP INDEX IF EXISTS ix_prompt_library_popular;
DROP TABLE IF EXISTS prompt_user_engagement;
ALTER TABLE prompt_library
    DROP COLUMN IF EXISTS use_count,
    DROP COLUMN IF EXISTS favorite_count,
    DROP COLUMN IF EXISTS like_count;
