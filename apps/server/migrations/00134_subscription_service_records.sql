-- +goose Up
ALTER TABLE subscription_changes ADD COLUMN public_message text NOT NULL DEFAULT '',
 ADD COLUMN requested_amount_cents bigint, ADD COLUMN refund_calculation jsonb;
ALTER TABLE notifications ADD COLUMN target_path text;
CREATE TABLE subscription_change_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), change_id uuid NOT NULL REFERENCES subscription_changes(id) ON DELETE CASCADE,
 action text NOT NULL, occurred_at timestamptz NOT NULL, actor_id uuid REFERENCES admin_accounts(id),
 internal_note text NOT NULL DEFAULT '', public_message text NOT NULL,
 amount_cents bigint NOT NULL, calculation jsonb, UNIQUE(change_id,action)
);
UPDATE subscription_changes SET public_message=CASE
 WHEN status='reviewing' THEN '退订申请已提交，正在审核。审核期间订阅权益仍可使用。'
 WHEN status='processing' THEN '退订审核已通过，正在办理退款。订阅积分暂时冻结，通用积分不受影响。'
 WHEN status='completed' AND amount_cents=0 THEN '退订已完成，本次无可退金额，剩余订阅积分已回收。'
 WHEN status='completed' THEN '退款已确认完成，订阅已结束，剩余订阅积分已回收。'
 WHEN status='rejected' THEN '本次退订申请未通过，原订阅权益按有效期保留。'
 ELSE '本次申请已结束。' END WHERE kind='refund';
INSERT INTO subscription_change_events(change_id,action,occurred_at,actor_id,internal_note,public_message,amount_cents)
SELECT id,'legacy_status',updated_at,reviewed_by,review_note,public_message,amount_cents FROM subscription_changes WHERE kind='refund';
-- Backfill the missing current-stage notice, without inventing historical calculation snapshots.
INSERT INTO notifications(user_id,kind,title,body,source_type,source_id,target_path)
SELECT user_id,'order',CASE status WHEN 'reviewing' THEN '退订申请已提交' WHEN 'processing' THEN '退订审核已通过' WHEN 'completed' THEN '退订已完成' ELSE '退订审核结果' END,
 public_message,'subscription_refund_'||status,id,'/subscriptions?subscription='||subscription_id::text||'&view=changes'
FROM subscription_changes WHERE kind='refund'
ON CONFLICT(source_type,source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM subscription_change_events) THEN
  RAISE EXCEPTION 'subscription audit records exist; refusing lossy rollback';
 END IF;
END $$;
-- +goose StatementEnd
DROP TABLE subscription_change_events;
ALTER TABLE notifications DROP COLUMN target_path;
ALTER TABLE subscription_changes DROP COLUMN public_message,DROP COLUMN requested_amount_cents,DROP COLUMN refund_calculation;
