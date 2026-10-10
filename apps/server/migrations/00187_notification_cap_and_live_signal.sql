-- +goose Up
-- 每个用户最多保留最近 100 条通知；新通知写入时通过 pg_notify 实时告知 API，
-- 由 SSE 立即推给前端。放在触发器里，所有写通知的地方（Go、Worker 原生 SQL、批量到期任务）都自动生效。
DELETE FROM notifications AS n
USING (
    SELECT id
    FROM (
        SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
        FROM notifications
        WHERE user_id IS NOT NULL
    ) ranked
    WHERE rn > 100
) AS stale
WHERE n.id = stale.id;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notifications_after_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.user_id IS NOT NULL THEN
        DELETE FROM notifications
        WHERE id IN (
            SELECT id FROM notifications
            WHERE user_id = NEW.user_id
            ORDER BY created_at DESC, id DESC
            OFFSET 100
        );
        PERFORM pg_notify('user_notifications', NEW.user_id::text);
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER trg_notifications_after_insert
    AFTER INSERT ON notifications
    FOR EACH ROW EXECUTE FUNCTION notifications_after_insert();

-- +goose Down
DROP TRIGGER IF EXISTS trg_notifications_after_insert ON notifications;
DROP FUNCTION IF EXISTS notifications_after_insert();
