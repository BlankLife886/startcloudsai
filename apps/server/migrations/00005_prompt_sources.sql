-- +goose Up
CREATE TABLE prompt_sources (
    id text PRIMARY KEY,
    name text NOT NULL,
    source_url text NOT NULL,
    format text NOT NULL CHECK (format IN ('json','markdown','html')),
    task_type text NOT NULL DEFAULT 't2i' CHECK (task_type IN ('t2i','coloring','ui_design','model_sheet','game_art','puzzle')),
    default_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    auto_sync_enabled boolean NOT NULL DEFAULT true,
    sync_interval_minutes integer NOT NULL DEFAULT 360,
    next_sync_at timestamptz,
    sync_lock_token text NOT NULL DEFAULT '',
    sync_lock_expires_at timestamptz,
    item_count integer NOT NULL DEFAULT 0,
    last_synced_at timestamptz,
    last_sync_duration_ms bigint NOT NULL DEFAULT 0,
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prompt_library
    ADD COLUMN source_id text NOT NULL DEFAULT '',
    ADD COLUMN source_item_key text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX ux_prompt_library_source_item ON prompt_library (source_id, source_item_key)
    WHERE source_id <> '' AND source_item_key <> '';
CREATE INDEX ix_prompt_library_source ON prompt_library (source_id) WHERE source_id <> '';

-- 内置 6 源（walleven 同款）；next_sync_at = now() 使首轮自动同步立即触发
INSERT INTO prompt_sources (id, name, source_url, format, next_sync_at) VALUES
    ('banana-prompt-quicker', 'Banana Prompt Quicker', 'https://glidea.github.io/banana-prompt-quicker/prompts.json', 'json', now()),
    ('awesome-gpt-image', 'Awesome GPT Image', 'https://cdn.jsdelivr.net/gh/ZeroLu/awesome-gpt-image@main/README.zh-CN.md', 'markdown', now()),
    ('awesome-gpt4o-image', 'Awesome GPT-4o Image Prompts', 'https://cdn.jsdelivr.net/gh/ImgEdify/Awesome-GPT4o-Image-Prompts@main/Prompts.html', 'html', now()),
    ('youmind-gpt-image-2', 'YouMind GPT Image 2', 'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/awesome-gpt-image-2@main/README_zh.md', 'markdown', now()),
    ('youmind-nano-banana-pro', 'YouMind Nano Banana Pro', 'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/awesome-nano-banana-pro-prompts@main/README_zh.md', 'markdown', now()),
    ('davidwu-gpt-image-2', 'DavidWu GPT Image 2 Prompts', 'https://cdn.jsdelivr.net/gh/davidwuw0811-boop/awesome-gpt-image2-prompts@main/prompts.json', 'json', now());

-- +goose Down
DROP INDEX IF EXISTS ix_prompt_library_source;
DROP INDEX IF EXISTS ux_prompt_library_source_item;
ALTER TABLE prompt_library
    DROP COLUMN IF EXISTS source_item_key,
    DROP COLUMN IF EXISTS source_id;
DROP TABLE IF EXISTS prompt_sources;
