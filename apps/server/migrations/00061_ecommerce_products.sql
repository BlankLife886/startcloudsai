-- +goose Up
CREATE TABLE ecommerce_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sku text NOT NULL DEFAULT '',
    title text NOT NULL,
    brand text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    selling_points text NOT NULL DEFAULT '',
    target_audience text NOT NULL DEFAULT '',
    material text NOT NULL DEFAULT '',
    color text NOT NULL DEFAULT '',
    dimensions text NOT NULL DEFAULT '',
    platform text NOT NULL DEFAULT '',
    market text NOT NULL DEFAULT '',
    language text NOT NULL DEFAULT '',
    asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    protected_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_ecommerce_products_status CHECK (status IN ('active', 'archived')),
    CONSTRAINT ck_ecommerce_products_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT ck_ecommerce_products_sku_length CHECK (char_length(sku) <= 80),
    CONSTRAINT ck_ecommerce_products_asset_count CHECK (jsonb_array_length(asset_ids) BETWEEN 1 AND 6),
    CONSTRAINT ck_ecommerce_products_protected_count CHECK (jsonb_array_length(protected_elements) <= 12)
);

CREATE INDEX ix_ecommerce_products_user_updated
    ON ecommerce_products (user_id, updated_at DESC, id DESC);
CREATE INDEX ix_ecommerce_products_user_status
    ON ecommerce_products (user_id, status, updated_at DESC);
CREATE UNIQUE INDEX uq_ecommerce_products_user_sku
    ON ecommerce_products (user_id, lower(sku))
    WHERE sku <> '';

-- +goose Down
DROP TABLE IF EXISTS ecommerce_products;
