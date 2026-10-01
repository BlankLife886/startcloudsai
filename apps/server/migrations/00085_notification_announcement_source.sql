-- +goose Up
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS source_type text,
    ADD COLUMN IF NOT EXISTS source_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_source
    ON notifications (source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

UPDATE notifications AS n
SET source_type = 'announcement',
    source_id = a.id
FROM announcements AS a
WHERE n.user_id IS NULL
  AND n.kind = 'announcement'
  AND n.source_id IS NULL
  AND n.title = a.title
  AND n.id = (
      SELECT n2.id
      FROM notifications AS n2
      WHERE n2.user_id IS NULL
        AND n2.kind = 'announcement'
        AND n2.source_id IS NULL
        AND n2.title = a.title
      ORDER BY n2.created_at
      LIMIT 1
  );

INSERT INTO notifications (user_id, kind, title, body, source_type, source_id, created_at)
SELECT NULL, 'announcement', a.title, a.body, 'announcement', a.id, a.created_at
FROM announcements AS a
WHERE a.active = true
  AND NOT EXISTS (
    SELECT 1
    FROM notifications AS n
    WHERE n.source_type = 'announcement' AND n.source_id = a.id
);

-- +goose Down
DROP INDEX IF EXISTS uq_notifications_source;
ALTER TABLE notifications
    DROP COLUMN IF EXISTS source_id,
    DROP COLUMN IF EXISTS source_type;
