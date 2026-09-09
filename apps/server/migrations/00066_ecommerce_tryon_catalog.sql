-- +goose Up
CREATE TABLE ecommerce_tryon_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    label text NOT NULL,
    image_key text NOT NULL,
    apparel text NOT NULL DEFAULT '',
    sort int NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_ecommerce_tryon_catalog_kind CHECK (kind IN ('model', 'scene', 'garment')),
    CONSTRAINT ck_ecommerce_tryon_catalog_label_length CHECK (char_length(label) BETWEEN 1 AND 32),
    CONSTRAINT ck_ecommerce_tryon_catalog_apparel CHECK (
        apparel = '' OR apparel IN ('上装', '下装', '全身')
    ),
    CONSTRAINT ck_ecommerce_tryon_catalog_image_key CHECK (
        image_key LIKE 'ecommerce-tryon/%' AND char_length(image_key) BETWEEN 16 AND 200
    )
);

CREATE INDEX ix_ecommerce_tryon_catalog_kind_sort
    ON ecommerce_tryon_catalog (kind, sort ASC, created_at ASC, id ASC);

CREATE UNIQUE INDEX uq_ecommerce_tryon_catalog_image_key
    ON ecommerce_tryon_catalog (image_key);

-- +goose Down
DROP TABLE IF EXISTS ecommerce_tryon_catalog;
