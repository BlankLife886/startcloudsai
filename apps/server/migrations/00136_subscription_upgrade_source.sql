-- +goose Up
-- Use immutable purchase/upgrade snapshots, never the mutable current plan catalog.
WITH evidence AS (
 SELECT c.id,
 CASE WHEN previous.id IS NOT NULL THEN jsonb_build_object(
  'planId',previous.target_plan_id,'planName',previous.snapshot->>'planName',
  'priceCents',previous.snapshot->'priceCents','dailyPoints',previous.snapshot->'dailyPoints',
  'durationDays',previous.snapshot->'durationDays')
 ELSE jsonb_build_object(
  'planId',original.plan_id,'planName',original.plan_name_snapshot,
  'priceCents',original.amount_cents,'dailyPoints',original.plan_daily_grant_snapshot,
  'durationDays',original.plan_duration_days_snapshot) END AS source
 FROM subscription_changes c
 JOIN subscriptions s ON s.id=c.subscription_id
 LEFT JOIN orders original ON original.id=s.order_id
 LEFT JOIN LATERAL (
  SELECT p.id,p.target_plan_id,p.snapshot FROM subscription_changes p
  WHERE p.subscription_id=c.subscription_id AND p.kind='upgrade' AND p.status='completed'
   AND p.expected_revision<c.expected_revision
  ORDER BY p.expected_revision DESC,p.completed_at DESC,p.id LIMIT 1
 ) previous ON true
 WHERE c.kind='upgrade' AND NOT c.snapshot ? 'sourcePlan'
  AND CASE WHEN previous.id IS NOT NULL THEN
   previous.target_plan_id IS NOT NULL AND btrim(COALESCE(previous.snapshot->>'planName',''))<>''
  ELSE original.plan_id IS NOT NULL AND btrim(COALESCE(original.plan_name_snapshot,''))<>'' END
)
UPDATE subscription_changes c SET snapshot=jsonb_set(c.snapshot,'{sourcePlan}',e.source)
FROM evidence e WHERE e.id=c.id;

-- +goose Down
-- This is factual provenance enrichment; never discard it on rollback.
SELECT 1;
