-- +goose Up
CREATE TABLE ecommerce_handheld_catalog (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('model', 'scene', 'hand')),
    label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
    image_key text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecommerce_handheld_catalog_list_idx
    ON ecommerce_handheld_catalog (kind, active, sort, created_at);

CREATE TABLE ecommerce_handheld_projects (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id uuid REFERENCES ecommerce_products(id) ON DELETE SET NULL,
    name text NOT NULL,
    product_snapshot jsonb NOT NULL,
    draft jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecommerce_handheld_projects_user_idx
    ON ecommerce_handheld_projects (user_id, updated_at DESC, id DESC);

CREATE TABLE ecommerce_handheld_batches (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid REFERENCES ecommerce_handheld_projects(id) ON DELETE SET NULL,
    product_id uuid REFERENCES ecommerce_products(id) ON DELETE SET NULL,
    parent_batch_id uuid REFERENCES ecommerce_handheld_batches(id) ON DELETE SET NULL,
    status text NOT NULL CHECK (status IN ('queued', 'generating', 'quality_checking', 'review_ready', 'completed', 'partial', 'failed', 'canceled')),
    model_id text NOT NULL DEFAULT '',
    product_snapshot jsonb NOT NULL,
    job_spec jsonb NOT NULL,
    item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 24),
    total_cost_cents bigint NOT NULL CHECK (total_cost_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ecommerce_handheld_batches_user_idx
    ON ecommerce_handheld_batches (user_id, created_at DESC, id DESC);

CREATE TABLE ecommerce_handheld_items (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES ecommerce_handheld_batches(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
    parent_item_id uuid REFERENCES ecommerce_handheld_items(id) ON DELETE SET NULL,
    item_index integer NOT NULL,
    label text NOT NULL DEFAULT '',
    prompt text NOT NULL,
    shot_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'queued',
    qa_status text NOT NULL DEFAULT 'pending' CHECK (qa_status IN ('pending', 'running', 'passed', 'failed', 'error', 'waived')),
    review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'accepted', 'rejected')),
    review_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, item_index)
);
CREATE INDEX ecommerce_handheld_items_task_idx ON ecommerce_handheld_items (task_id);

CREATE TABLE ecommerce_handheld_inputs (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES ecommerce_handheld_batches(id) ON DELETE CASCADE,
    item_id uuid REFERENCES ecommerce_handheld_items(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('product_front', 'product_side', 'product_back', 'logo_detail', 'colorway', 'hand_or_model', 'scene', 'layout')),
    object_key text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, item_id, role, ordinal)
);

CREATE TABLE ecommerce_handheld_quality_reports (
    id uuid PRIMARY KEY,
    item_id uuid NOT NULL UNIQUE REFERENCES ecommerce_handheld_items(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'error', 'waived')),
    detector text NOT NULL DEFAULT 'manual_required',
    checks jsonb NOT NULL DEFAULT '[]'::jsonb,
    score numeric(5,2),
    summary text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE ecommerce_handheld_quality_reports;
DROP TABLE ecommerce_handheld_inputs;
DROP TABLE ecommerce_handheld_items;
DROP TABLE ecommerce_handheld_batches;
DROP TABLE ecommerce_handheld_projects;
DROP TABLE ecommerce_handheld_catalog;
