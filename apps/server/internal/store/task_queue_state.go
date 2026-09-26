package store

import (
	"context"
	"github.com/google/uuid"
)

// Only work that has not reached an upstream can compete for a fresh slot.
// A task waiting on an unavailable route must not block another usable model.
func ListUserDispatchableTaskIDs(ctx context.Context, q Q, userID uuid.UUID, limit int, include ...uuid.UUID) ([]uuid.UUID, error) {
	current := uuid.Nil
	if len(include) > 0 {
		current = include[0]
	}
	rows, err := q.Query(ctx, `SELECT task.id FROM tasks task
		WHERE task.user_id=$1 AND task.status='queued'
		AND COALESCE(task.lease_owner,'')<>$2
		AND NOT `+taskRetainedExecutionSQL("task")+`
		AND (task.id=$4 OR COALESCE(task.params->>'_completionClaimId','')='')
		AND (task.id=$4 OR COALESCE(task.params->>'_queueWaitReason','') IN ('','user_execution_limit','user_queue_order'))
		ORDER BY task.created_at, CASE WHEN task.params->>'batchIndex' ~ '^[0-9]{1,3}$' THEN (task.params->>'batchIndex')::int ELSE 0 END,task.id
		LIMIT $3`, userID, UIDesignAssetHistoryLeaseOwner, limit, current)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func SetTaskQueueWaitReason(ctx context.Context, q Q, id uuid.UUID, reason string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE tasks SET params=jsonb_set(COALESCE(params,'{}'::jsonb),'{_queueWaitReason}',to_jsonb($2::text))
		WHERE id=$1 AND status='queued' AND COALESCE(params->>'_queueWaitReason','') IS DISTINCT FROM $2`, id, reason)
	return tag.RowsAffected() > 0, err
}
