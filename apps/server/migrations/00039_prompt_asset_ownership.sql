-- +goose Up
ALTER TABLE prompt_library
    ADD COLUMN asset_origin text NOT NULL DEFAULT 'missing'
        CHECK (asset_origin IN ('owned_storage','gallery','external','missing')),
    ADD COLUMN asset_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN asset_verified_at timestamptz,
    ADD COLUMN asset_note text NOT NULL DEFAULT '';

UPDATE prompt_library
SET asset_origin = CASE
        WHEN gallery_submission_id IS NOT NULL THEN 'gallery'
        WHEN COALESCE(cover_key, '') = '' THEN 'missing'
        WHEN cover_key ~ '^https?://' THEN 'external'
        ELSE 'owned_storage'
    END,
    asset_verified = CASE
        WHEN COALESCE(cover_key, '') <> '' AND cover_key !~ '^https?://' THEN true
        ELSE false
    END,
    asset_verified_at = CASE
        WHEN COALESCE(cover_key, '') <> '' AND cover_key !~ '^https?://' THEN now()
        ELSE NULL
    END,
    asset_note = CASE
        WHEN cover_key ~ '^https?://' THEN '外部远程图片，尚未确认所有权或使用授权'
        WHEN gallery_submission_id IS NOT NULL THEN '来自图库投稿，需确认投稿授权范围'
        WHEN COALESCE(cover_key, '') = '' THEN '无封面图片，不需要图片资产验证'
        ELSE '本站存储文件，系统自动验证存储来源'
    END;

CREATE INDEX ix_prompt_library_asset_audit
    ON prompt_library (asset_origin, asset_verified, created_at DESC);

ALTER TABLE prompt_import_items
    ADD COLUMN asset_origin text NOT NULL DEFAULT 'missing'
        CHECK (asset_origin IN ('owned_storage','gallery','external','missing')),
    ADD COLUMN asset_status text NOT NULL DEFAULT 'not_required'
        CHECK (asset_status IN ('pending','verified','rejected','not_required')),
    ADD COLUMN asset_note text NOT NULL DEFAULT '';

UPDATE prompt_import_items
SET asset_origin = CASE
        WHEN COALESCE(cover_key, '') = '' THEN 'missing'
        WHEN cover_key ~ '^https?://' THEN 'external'
        ELSE 'owned_storage'
    END,
    asset_status = CASE
        WHEN COALESCE(cover_key, '') = '' THEN 'not_required'
        WHEN cover_key ~ '^https?://' THEN 'pending'
        ELSE 'verified'
    END,
    asset_note = CASE
        WHEN cover_key ~ '^https?://' THEN '外部远程图片，必须人工确认自有或已获授权'
        WHEN COALESCE(cover_key, '') = '' THEN '无封面图片'
        ELSE '本站存储文件'
    END;

CREATE INDEX ix_prompt_import_items_asset_review
    ON prompt_import_items (batch_id, asset_status, created_at ASC);

-- +goose Down
DROP INDEX IF EXISTS ix_prompt_import_items_asset_review;
ALTER TABLE prompt_import_items
    DROP COLUMN IF EXISTS asset_note,
    DROP COLUMN IF EXISTS asset_status,
    DROP COLUMN IF EXISTS asset_origin;
DROP INDEX IF EXISTS ix_prompt_library_asset_audit;
ALTER TABLE prompt_library
    DROP COLUMN IF EXISTS asset_note,
    DROP COLUMN IF EXISTS asset_verified_at,
    DROP COLUMN IF EXISTS asset_verified,
    DROP COLUMN IF EXISTS asset_origin;
