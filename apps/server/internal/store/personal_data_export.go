package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// BuildPersonalDataExport returns user-owned, portable account data. Secrets,
// session credentials, internal risk signals and binary objects are excluded.
func BuildPersonalDataExport(ctx context.Context, q Q, userID uuid.UUID, exportedAt time.Time) (json.RawMessage, error) {
	var raw []byte
	err := q.QueryRow(ctx, `
		SELECT jsonb_build_object(
			'schemaVersion', 1,
			'exportedAt', $2::timestamptz,
			'account', (
				SELECT jsonb_build_object(
					'id', id, 'email', email::text, 'username', username,
					'avatarUrl', avatar_url, 'studioFigureUrl', studio_figure_url,
					'bio', bio, 'location', location, 'websiteUrl', website_url,
					'requireCostConfirm', require_cost_confirm,
					'lastLoginAt', last_login_at, 'createdAt', created_at
				) FROM users WHERE id = $1
			),
			'wallet', COALESCE((
				SELECT jsonb_build_object(
					'balancePoints', balance_cents, 'frozenPoints', frozen_cents,
					'trialBalancePoints', trial_balance_cents,
					'trialFrozenPoints', trial_frozen_cents, 'updatedAt', updated_at
				) FROM wallets WHERE user_id = $1
			), 'null'::jsonb),
			'walletEntries', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', id, 'kind', kind, 'deltaPoints', delta_cents,
					'balanceAfterPoints', balance_after_cents,
					'sourceType', source_type, 'sourceId', source_id,
					'reason', reason, 'creditBucket', credit_bucket, 'createdAt', created_at
				) ORDER BY created_at, id) FROM wallet_ledger WHERE user_id = $1
			), '[]'::jsonb),
			'orders', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', o.id, 'planCode', p.code, 'planName', p.name,
					'amountCents', o.amount_cents, 'grantPoints', o.grant_cents,
					'bonusPoints', o.bonus_cents, 'status', o.status,
					'provider', o.provider, 'paymentMethod', o.payment_method,
					'paidAt', o.paid_at, 'completedAt', o.completed_at, 'createdAt', o.created_at
				) ORDER BY o.created_at, o.id)
				FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.user_id = $1
			), '[]'::jsonb),
			'subscriptions', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', s.id, 'planCode', p.code, 'planName', p.name,
					'startsAt', s.starts_at, 'endsAt', s.ends_at,
					'dailyGrantPoints', s.daily_grant_cents,
					'lastGrantedDate', s.last_granted_date, 'status', s.status,
					'createdAt', s.created_at
				) ORDER BY s.created_at, s.id)
				FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = $1
			), '[]'::jsonb),
			'tasks', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', id, 'type', type, 'status', status, 'prompt', prompt,
					'params', params, 'count', count, 'model', model,
					'inputKeys', input_keys, 'outputKeys', output_keys,
					'thumbnailKeys', thumbnail_keys, 'costPoints', cost_cents,
					'errorCode', error_code, 'errorMessage', error_message,
					'startedAt', started_at, 'finishedAt', finished_at, 'createdAt', created_at
				) ORDER BY created_at, id) FROM tasks WHERE user_id = $1
			), '[]'::jsonb),
			'assistantConversations', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', c.id, 'title', c.title, 'workspace', c.workspace,
					'createdAt', c.created_at, 'updatedAt', c.updated_at,
					'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
						'id', m.id, 'role', m.role, 'content', m.content,
						'kind', m.kind, 'status', m.status, 'metadata', m.metadata,
						'createdAt', m.created_at, 'updatedAt', m.updated_at
					) ORDER BY m.created_at, m.id) FROM assistant_messages m
					WHERE m.conversation_id = c.id), '[]'::jsonb)
				) ORDER BY c.created_at, c.id) FROM assistant_conversations c WHERE c.user_id = $1
			), '[]'::jsonb),
			'assets', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', id, 'title', title, 'fileKey', file_key,
					'thumbnailKey', thumbnail_key, 'contentType', content_type,
					'sizeBytes', size_bytes, 'tags', tags, 'sourceType', source_type,
					'sourceId', source_id, 'sourceMetadata', source_metadata,
					'parentAssetId', parent_asset_id, 'deletedAt', deleted_at,
					'updatedAt', updated_at, 'createdAt', created_at
				) ORDER BY created_at, id) FROM user_assets WHERE user_id = $1
			), '[]'::jsonb),
			'gallerySubmissions', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', id, 'taskId', task_id, 'title', title, 'status', status,
					'coverKey', cover_key, 'mediaKeys', media_keys,
					'rejectReason', reject_reason, 'reviewedAt', reviewed_at, 'createdAt', created_at
				) ORDER BY created_at, id) FROM gallery_submissions WHERE user_id = $1
			), '[]'::jsonb),
			'feedback', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', id, 'category', category, 'title', title, 'content', content,
					'pageUrl', page_url, 'status', status, 'adminReply', admin_reply,
					'handledAt', handled_at, 'createdAt', created_at, 'updatedAt', updated_at
				) ORDER BY created_at, id) FROM user_feedback WHERE user_id = $1
			), '[]'::jsonb),
			'communityReports', COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', id, 'submissionId', submission_id, 'reason', reason,
					'detail', detail, 'status', status, 'createdAt', created_at,
					'updatedAt', updated_at, 'reviewedAt', reviewed_at
				) ORDER BY created_at, id) FROM gallery_submission_reports WHERE reporter_user_id = $1
			), '[]'::jsonb),
			'blockedUserIds', COALESCE((
				SELECT jsonb_agg(blocked_user_id ORDER BY created_at, blocked_user_id)
				FROM user_blocks WHERE blocker_user_id = $1
			), '[]'::jsonb)
		)::text
	`, userID, exportedAt.UTC()).Scan(&raw)
	return json.RawMessage(raw), err
}
