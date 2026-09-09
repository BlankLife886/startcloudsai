-- +goose Up
-- Closing payment does not leave a subscription change awaiting payment forever.
UPDATE subscription_changes c SET status='cancelled',updated_at=now()
WHERE c.kind='upgrade' AND c.status='pending'
AND EXISTS(SELECT 1 FROM orders o WHERE o.subscription_change_id=c.id AND o.status IN ('cancelled','expired','failed'));

-- +goose Down
-- Do not resurrect closed payment attempts on rollback.
SELECT 1;
