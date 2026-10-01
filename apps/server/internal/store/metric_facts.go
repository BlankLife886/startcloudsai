package store

import "strconv"

// 本文件是“用户自己的数据”统计口径的唯一来源。个人中心使用统计和 AI 助手的
// 数据查询都从这里取事实行，保证同一个用户在不同页面看到的数字一致。
//
// 两段 SQL 都只接受一个参数：$1 = user_id。调用方把它们放进 CTE 使用，
// 自己的其它参数从 $2 开始编号。

// usageMaxTaskSeconds 是单个任务计入创作时长的上限，避免异常长的排队或卡死任务拉高统计。
const usageMaxTaskSeconds = 3600

// excludedSpendSourceTypes 是订阅内部划转，不属于用户的真实消耗。
const excludedSpendSourceTypes = `('subscription_refund_hold','subscription_upgrade_exchange','subscription_cycle_expiry')`

// UserActivityFactsSQL 每行是一次创作：站内图片任务或 AI 助手运行。
//
// 列：created_at, workspace, model, status, images, seconds,
// id, record_type（task / assistant_run）, conversation_id, prompt（前 120 字）。
//
// 助手出图时会额外写一条 _historyMirror 任务，让图片出现在历史记录里；它和助手运行
// 是同一次创作，这里必须排除，否则创作数和图片数会被算两遍。
var UserActivityFactsSQL = `
	SELECT t.created_at,
		t.type AS workspace,
		COALESCE(NULLIF(t.params->>'_modelDisplayName', ''), NULLIF(t.model, ''), '') AS model,
		t.status,
		(CASE WHEN jsonb_typeof(t.output_keys) = 'array' THEN jsonb_array_length(t.output_keys) ELSE 0 END
			+ t.deleted_output_count)::bigint AS images,
		CASE WHEN t.started_at IS NOT NULL AND t.finished_at > t.started_at
			THEN LEAST(EXTRACT(EPOCH FROM t.finished_at - t.started_at), ` + strconv.Itoa(usageMaxTaskSeconds) + `)::bigint
			ELSE 0 END AS seconds,
		t.id::text AS id,
		'task'::text AS record_type,
		''::text AS conversation_id,
		left(t.prompt, 120) AS prompt
	FROM tasks t
	WHERE t.user_id = $1
		AND lower(COALESCE(t.params->>'_historyMirror', '')) <> 'true'
	UNION ALL
	SELECT r.created_at,
		COALESCE(NULLIF(c.workspace, ''), 'assistant') AS workspace,
		COALESCE(NULLIF(r.params->>'_modelDisplayName', ''), '') AS model,
		r.status,
		(CASE WHEN r.status = 'succeeded' AND jsonb_typeof(m.metadata->'images') = 'array'
			THEN jsonb_array_length(m.metadata->'images') ELSE 0 END)::bigint AS images,
		CASE WHEN r.started_at IS NOT NULL AND r.finished_at > r.started_at
			THEN LEAST(EXTRACT(EPOCH FROM r.finished_at - r.started_at), ` + strconv.Itoa(usageMaxTaskSeconds) + `)::bigint
			ELSE 0 END AS seconds,
		r.id::text AS id,
		'assistant_run'::text AS record_type,
		r.conversation_id::text AS conversation_id,
		left(r.prompt, 120) AS prompt
	FROM assistant_runs r
	LEFT JOIN assistant_messages m ON m.id = r.assistant_message_id
	LEFT JOIN assistant_conversations c ON c.id = r.conversation_id
	WHERE r.user_id = $1`

// UserLedgerFactsSQL 每行是一条钱包账本记录，按钱包汇总（queryWalletLedgerStats）
// 的口径拆成四种金额：
//
//   - spend_points：生成消耗。与钱包“已消耗”中的 spend 部分逐条一致，包括早期
//     delta 为 0 的记录回退到关联任务 / 助手运行的实扣金额。
//   - deduct_points：人工扣减（admin_adjust 为负）。钱包“已消耗”= spend + deduct。
//   - refund_points：冻结退回（release）。与钱包“退回”一致。
//   - income_points：入账（grant、refund、admin_adjust 为正）。与钱包“入账”一致。
//
// 列：created_at, kind, source_type, workspace, model,
// spend_points, deduct_points, refund_points, income_points,
// id, source_record_id（关联的任务 / 助手运行）, conversation_id, prompt（前 120 字）, reason。
var UserLedgerFactsSQL = `
	SELECT l.created_at,
		l.kind,
		l.source_type,
		CASE
			WHEN l.source_type = 'task' THEN COALESCE(t.type, 'other')
			WHEN l.source_type = 'assistant_run' THEN COALESCE(NULLIF(c.workspace, ''), 'assistant')
			WHEN l.source_type = 'developer_api' THEN 'developer_api'
			ELSE 'other'
		END AS workspace,
		COALESCE(NULLIF(t.params->>'_modelDisplayName', ''), NULLIF(t.model, ''),
			NULLIF(a.params->>'_modelDisplayName', ''), '') AS model,
		(CASE
			WHEN l.kind <> 'spend' OR l.source_type IN ` + excludedSpendSourceTypes + ` THEN 0
			WHEN l.settled_points IS NOT NULL THEN l.settled_points
			WHEN ABS(l.delta_cents) > 0 THEN ABS(l.delta_cents)
			WHEN COALESCE((regexp_match(COALESCE(l.reason, ''), '消耗冻结 ([0-9]+)'))[1], '') <> ''
				THEN (regexp_match(COALESCE(l.reason, ''), '消耗冻结 ([0-9]+)'))[1]::bigint
			ELSE GREATEST(
				CASE WHEN t.id::text = l.source_id THEN COALESCE(t.cost_cents, 0) ELSE 0 END,
				COALESCE(a.cost_cents, 0))
		END)::bigint AS spend_points,
		(CASE WHEN l.kind = 'admin_adjust' AND l.delta_cents < 0 THEN -l.delta_cents ELSE 0 END)::bigint AS deduct_points,
		(CASE WHEN l.kind = 'release' AND l.source_type NOT IN ('subscription_refund_hold','subscription_upgrade_exchange')
			THEN l.delta_cents ELSE 0 END)::bigint AS refund_points,
		(CASE WHEN l.kind IN ('grant', 'refund') OR (l.kind = 'admin_adjust' AND l.delta_cents > 0)
			THEN l.delta_cents ELSE 0 END)::bigint AS income_points,
		l.id::text AS id,
		COALESCE(t.id::text, a.id::text, '') AS source_record_id,
		COALESCE(a.conversation_id::text, '') AS conversation_id,
		left(COALESCE(t.prompt, a.prompt, ''), 120) AS prompt,
		left(COALESCE(l.reason, ''), 120) AS reason
	FROM wallet_ledger l
	LEFT JOIN tasks t ON l.source_type = 'task'
		AND t.user_id = l.user_id
		AND t.id::text = split_part(COALESCE(l.source_id, ''), '/', 1)
	LEFT JOIN assistant_runs a ON l.source_type = 'assistant_run'
		AND a.user_id = l.user_id
		AND a.id::text = split_part(COALESCE(l.source_id, ''), '/', 1)
	LEFT JOIN assistant_conversations c ON c.id = a.conversation_id
	WHERE l.user_id = $1`
