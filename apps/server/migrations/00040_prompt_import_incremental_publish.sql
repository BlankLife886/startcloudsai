-- +goose Up
ALTER TABLE prompt_import_items
    ADD COLUMN published_prompt_id uuid REFERENCES prompt_library(id) ON DELETE SET NULL,
    ADD COLUMN published_at timestamptz;

UPDATE prompt_import_items i
SET published_prompt_id = p.id,
    published_at = COALESCE(b.completed_at, i.updated_at)
FROM prompt_import_batches b, prompt_library p
WHERE i.batch_id = b.id
  AND b.status = 'completed'
  AND i.review_status = 'approved'
  AND p.source_id = i.source_id
  AND p.source_item_key = i.source_item_key;

CREATE INDEX ix_prompt_import_items_batch_unpublished
    ON prompt_import_items (batch_id, created_at ASC)
    WHERE review_status = 'approved' AND published_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS ix_prompt_import_items_batch_unpublished;
ALTER TABLE prompt_import_items
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS published_prompt_id;
