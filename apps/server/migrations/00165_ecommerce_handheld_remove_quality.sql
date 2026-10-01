-- +goose Up
-- 手持商品暂不做质检：移除从未启用的质检报告表、质检/验收字段，批次全部成功直接记为 completed。
DROP TABLE IF EXISTS ecommerce_handheld_quality_reports;

ALTER TABLE ecommerce_handheld_items
    DROP COLUMN IF EXISTS qa_status,
    DROP COLUMN IF EXISTS review_status,
    DROP COLUMN IF EXISTS review_note;

ALTER TABLE ecommerce_handheld_batches DROP CONSTRAINT IF EXISTS ecommerce_handheld_batches_status_check;
UPDATE ecommerce_handheld_batches
   SET status = 'completed', updated_at = now()
 WHERE status IN ('quality_checking', 'review_ready');
ALTER TABLE ecommerce_handheld_batches
    ADD CONSTRAINT ecommerce_handheld_batches_status_check
    CHECK (status IN ('queued', 'generating', 'completed', 'partial', 'failed', 'canceled'));

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION sync_ecommerce_handheld_task_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ecommerce_handheld_items
       SET status = NEW.status,
           updated_at = now()
     WHERE task_id = NEW.id;

    UPDATE ecommerce_handheld_batches AS batch
       SET status = summary.status,
           updated_at = now()
      FROM (
          SELECT item.batch_id,
                 CASE
              WHEN count(*) FILTER (
                  WHERE item.task_id IS NULL
                     OR COALESCE(task.status, item.status) IN ('queued', 'running')
              ) > 0 THEN 'generating'
              WHEN count(*) FILTER (
                  WHERE COALESCE(task.status, item.status) = 'succeeded'
              ) = count(*) THEN 'completed'
              WHEN count(*) FILTER (
                  WHERE COALESCE(task.status, item.status) = 'succeeded'
              ) > 0 THEN 'partial'
              WHEN count(*) FILTER (
                  WHERE COALESCE(task.status, item.status) = 'canceled'
              ) = count(*) THEN 'canceled'
              ELSE 'failed'
                 END AS status
            FROM ecommerce_handheld_items AS item
            LEFT JOIN tasks AS task ON task.id = item.task_id
           WHERE item.batch_id IN (
               SELECT linked.batch_id
                 FROM ecommerce_handheld_items AS linked
                WHERE linked.task_id = NEW.id
           )
           GROUP BY item.batch_id
      ) AS summary
     WHERE batch.id = summary.batch_id
       AND batch.status IS DISTINCT FROM summary.status;

    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION sync_ecommerce_handheld_task_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ecommerce_handheld_items
       SET status = NEW.status,
           updated_at = now()
     WHERE task_id = NEW.id;

    UPDATE ecommerce_handheld_batches AS batch
       SET status = summary.status,
           updated_at = now()
      FROM (
          SELECT item.batch_id,
                 CASE
              WHEN count(*) FILTER (
                  WHERE item.task_id IS NULL
                     OR COALESCE(task.status, item.status) IN ('queued', 'running')
              ) > 0 THEN 'generating'
              WHEN count(*) FILTER (
                  WHERE COALESCE(task.status, item.status) = 'succeeded'
              ) = count(*) THEN 'review_ready'
              WHEN count(*) FILTER (
                  WHERE COALESCE(task.status, item.status) = 'succeeded'
              ) > 0 THEN 'partial'
              WHEN count(*) FILTER (
                  WHERE COALESCE(task.status, item.status) = 'canceled'
              ) = count(*) THEN 'canceled'
              ELSE 'failed'
                 END AS status
            FROM ecommerce_handheld_items AS item
            LEFT JOIN tasks AS task ON task.id = item.task_id
           WHERE item.batch_id IN (
               SELECT linked.batch_id
                 FROM ecommerce_handheld_items AS linked
                WHERE linked.task_id = NEW.id
           )
           GROUP BY item.batch_id
      ) AS summary
     WHERE batch.id = summary.batch_id
       AND batch.status IS DISTINCT FROM summary.status;

    RETURN NEW;
END;
$$;
-- +goose StatementEnd

ALTER TABLE ecommerce_handheld_batches DROP CONSTRAINT IF EXISTS ecommerce_handheld_batches_status_check;
ALTER TABLE ecommerce_handheld_batches
    ADD CONSTRAINT ecommerce_handheld_batches_status_check
    CHECK (status IN ('queued', 'generating', 'quality_checking', 'review_ready', 'completed', 'partial', 'failed', 'canceled'));

ALTER TABLE ecommerce_handheld_items
    ADD COLUMN qa_status text NOT NULL DEFAULT 'pending' CHECK (qa_status IN ('pending', 'running', 'passed', 'failed', 'error', 'waived')),
    ADD COLUMN review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'accepted', 'rejected')),
    ADD COLUMN review_note text NOT NULL DEFAULT '';

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
