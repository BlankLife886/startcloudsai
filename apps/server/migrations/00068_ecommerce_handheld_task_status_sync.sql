-- +goose Up
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

CREATE TRIGGER ecommerce_handheld_task_status_sync
AFTER UPDATE OF status ON tasks
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION sync_ecommerce_handheld_task_status();

UPDATE ecommerce_handheld_items AS item
   SET status = task.status,
       updated_at = now()
  FROM tasks AS task
 WHERE task.id = item.task_id
   AND item.status IS DISTINCT FROM task.status;

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
       GROUP BY item.batch_id
  ) AS summary
 WHERE batch.id = summary.batch_id
   AND batch.status IN ('queued', 'generating')
   AND batch.status IS DISTINCT FROM summary.status;

-- +goose Down
DROP TRIGGER IF EXISTS ecommerce_handheld_task_status_sync ON tasks;
DROP FUNCTION IF EXISTS sync_ecommerce_handheld_task_status();
