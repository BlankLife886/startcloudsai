-- +goose Up
ALTER TABLE ecommerce_tryon_catalog
    ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ecommerce_tryon_catalog
    DROP CONSTRAINT ck_ecommerce_tryon_catalog_kind,
    DROP CONSTRAINT ck_ecommerce_tryon_catalog_image_key;

ALTER TABLE ecommerce_tryon_catalog
    ADD CONSTRAINT ck_ecommerce_tryon_catalog_kind
        CHECK (kind IN ('model', 'scene', 'garment', 'hand')),
    ADD CONSTRAINT ck_ecommerce_tryon_catalog_image_key
        CHECK (
            (image_key LIKE 'ecommerce-tryon/%'
                OR image_key LIKE 'ecommerce-handheld/%'
                OR image_key LIKE 'ecommerce-catalog/%')
            AND char_length(image_key) BETWEEN 16 AND 200
        );

INSERT INTO ecommerce_tryon_catalog
    (id, kind, label, image_key, apparel, metadata, sort, active, created_at, updated_at)
SELECT
    id, kind, left(label, 32), image_key, '', metadata, sort, active, created_at, updated_at
FROM ecommerce_handheld_catalog
WHERE image_key LIKE 'ecommerce-handheld/%'
   OR image_key LIKE 'ecommerce-tryon/%'
   OR image_key LIKE 'ecommerce-catalog/%'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM ecommerce_tryon_catalog
WHERE kind = 'hand'
   OR image_key LIKE 'ecommerce-handheld/%'
   OR image_key LIKE 'ecommerce-catalog/%';

ALTER TABLE ecommerce_tryon_catalog
    DROP CONSTRAINT ck_ecommerce_tryon_catalog_kind,
    DROP CONSTRAINT ck_ecommerce_tryon_catalog_image_key;

ALTER TABLE ecommerce_tryon_catalog
    ADD CONSTRAINT ck_ecommerce_tryon_catalog_kind
        CHECK (kind IN ('model', 'scene', 'garment')),
    ADD CONSTRAINT ck_ecommerce_tryon_catalog_image_key
        CHECK (
            image_key LIKE 'ecommerce-tryon/%'
            AND char_length(image_key) BETWEEN 16 AND 200
        );

ALTER TABLE ecommerce_tryon_catalog DROP COLUMN metadata;
