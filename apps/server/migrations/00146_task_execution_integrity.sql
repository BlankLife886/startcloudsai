-- +goose Up
-- Only a corresponding assistant run proves a legacy history mirror.
UPDATE tasks task SET lease_owner='ui-design-asset-history'
WHERE task.type='ui_design'
  AND task.idempotency_key='ui-design-asset:'||(task.params->>'assistantRunId')
  AND EXISTS (SELECT 1 FROM assistant_runs run
              WHERE run.id::text=task.params->>'assistantRunId'
                AND run.user_id=task.user_id AND run.params->>'serviceKey'='ui_design_asset');

-- Clear obsolete client-era claims only on unsubmitted queued work.
UPDATE tasks task SET params=COALESCE(params,'{}'::jsonb)-'_completionClaimId'-'_completionClaimedAtMs'
WHERE task.status='queued' AND task.lease_owner IS NULL
  AND (CASE WHEN jsonb_typeof(task.output_keys)='array' THEN jsonb_array_length(task.output_keys) ELSE 0 END)=0
  AND NOT EXISTS (SELECT 1 FROM task_upstream_attempts attempt
                  WHERE attempt.task_id=task.id AND attempt.status IN ('submitting','pending'))
  AND NOT (CASE WHEN jsonb_typeof(task.params->'_crunTaskIds')='array'
                THEN jsonb_array_length(task.params->'_crunTaskIds')>0 ELSE false END);

CREATE INDEX IF NOT EXISTS ix_tasks_active_admission_v2 ON tasks(user_id,status)
INCLUDE(work_units,count)
WHERE status IN ('queued','running') AND COALESCE(lease_owner,'')<>'ui-design-asset-history';

-- +goose Down
DROP INDEX IF EXISTS ix_tasks_active_admission_v2;
-- Do not recreate invalid claims or remove proven ownership markers.
