-- +goose Up
UPDATE wallet_ledger AS ledger
SET reason = replace(ledger.reason, 'AI 助手', '无限画布')
FROM assistant_runs AS run
JOIN assistant_conversations AS conversation ON conversation.id = run.conversation_id
WHERE ledger.source_type = 'assistant_run'
  AND ledger.reason LIKE '%AI 助手%'
  AND split_part(ledger.source_id, '/', 1)::uuid = run.id
  AND (
    conversation.workspace = 'infinite_canvas'
    OR COALESCE(run.params->>'_source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(run.params->>'workspace', '') = 'infinite_canvas'
    OR COALESCE(run.params->>'source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(run.params->>'_kind', '') LIKE 'canvas-%'
  );

UPDATE wallet_ledger AS ledger
SET reason = replace(replace(replace(replace(
      ledger.reason,
      '任务冻结', '无限画布冻结'),
      '任务结算', '无限画布结算'),
      '任务解冻', '无限画布解冻'),
      '任务重跑冻结', '无限画布重跑冻结')
FROM tasks AS task
WHERE ledger.source_type = 'task'
  AND split_part(ledger.source_id, '/', 1)::uuid = task.id
  AND (
    COALESCE(task.params->>'_source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(task.params->>'source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(task.params->>'_kind', '') LIKE 'canvas-%'
  )
  AND (
    ledger.reason LIKE '%任务冻结%'
    OR ledger.reason LIKE '%任务结算%'
    OR ledger.reason LIKE '%任务解冻%'
    OR ledger.reason LIKE '%任务重跑冻结%'
  );

-- +goose Down
UPDATE wallet_ledger AS ledger
SET reason = replace(ledger.reason, '无限画布', 'AI 助手')
FROM assistant_runs AS run
JOIN assistant_conversations AS conversation ON conversation.id = run.conversation_id
WHERE ledger.source_type = 'assistant_run'
  AND ledger.reason LIKE '%无限画布%'
  AND split_part(ledger.source_id, '/', 1)::uuid = run.id
  AND (
    conversation.workspace = 'infinite_canvas'
    OR COALESCE(run.params->>'_source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(run.params->>'workspace', '') = 'infinite_canvas'
    OR COALESCE(run.params->>'source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(run.params->>'_kind', '') LIKE 'canvas-%'
  );

UPDATE wallet_ledger AS ledger
SET reason = replace(replace(replace(replace(
      ledger.reason,
      '无限画布重跑冻结', '任务重跑冻结'),
      '无限画布冻结', '任务冻结'),
      '无限画布结算', '任务结算'),
      '无限画布解冻', '任务解冻')
FROM tasks AS task
WHERE ledger.source_type = 'task'
  AND split_part(ledger.source_id, '/', 1)::uuid = task.id
  AND (
    COALESCE(task.params->>'_source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(task.params->>'source', '') IN ('react_canvas', 'infinite_canvas')
    OR COALESCE(task.params->>'_kind', '') LIKE 'canvas-%'
  )
  AND (
    ledger.reason LIKE '%无限画布冻结%'
    OR ledger.reason LIKE '%无限画布结算%'
    OR ledger.reason LIKE '%无限画布解冻%'
    OR ledger.reason LIKE '%无限画布重跑冻结%'
  );
