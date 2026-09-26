-- +goose Up
CREATE TABLE prompt_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    label text NOT NULL,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    builtin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_prompt_categories_key CHECK (char_length(trim(key)) BETWEEN 1 AND 64),
    CONSTRAINT ck_prompt_categories_label CHECK (char_length(trim(label)) BETWEEN 1 AND 64)
);

INSERT INTO prompt_categories (key, label, sort, active, builtin) VALUES
    ('portrait', '人像人物', 10, true, true),
    ('photography', '摄影写实', 20, true, true),
    ('product', '产品商业', 30, true, true),
    ('illustration', '插画动漫', 40, true, true),
    ('scene', '场景建筑', 50, true, true),
    ('design', '视觉设计', 60, true, true),
    ('game', '游戏美术', 70, true, true),
    ('typography', '文字排版', 80, true, true),
    ('other', '其他', 90, true, true);

UPDATE prompt_library
SET category = 'other'
WHERE COALESCE(NULLIF(trim(category), ''), 'other') = 'other'
  AND category IS DISTINCT FROM 'other';

INSERT INTO prompt_categories (key, label, sort, active, builtin)
SELECT existing.key, existing.key, 1000 + row_number() OVER (ORDER BY existing.key) * 10, true, false
FROM (
    SELECT DISTINCT trim(category) AS key
    FROM prompt_library
    WHERE COALESCE(NULLIF(trim(category), ''), 'other') <> 'other'
) AS existing
ON CONFLICT (key) DO NOTHING;

CREATE INDEX ix_prompt_categories_public_order
    ON prompt_categories (active, sort ASC, created_at ASC);

-- +goose Down
DROP TABLE IF EXISTS prompt_categories;
