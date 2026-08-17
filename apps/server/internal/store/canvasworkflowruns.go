package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CanvasWorkflowRun struct {
	ID               uuid.UUID       `json:"id"`
	ProjectID        uuid.UUID       `json:"projectId"`
	UserID           uuid.UUID       `json:"userId"`
	OwnerID          uuid.UUID       `json:"ownerId"`
	Status           string          `json:"status"`
	NodeIDs          json.RawMessage `json:"nodeIds"`
	CompletedNodeIDs json.RawMessage `json:"completedNodeIds"`
	CurrentNodeID    *string         `json:"currentNodeId"`
	ErrorMessage     string          `json:"errorMessage"`
	LeaseExpiresAt   *time.Time      `json:"leaseExpiresAt"`
	StartedAt        time.Time       `json:"startedAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
	FinishedAt       *time.Time      `json:"finishedAt"`
}

const canvasWorkflowRunCols = `id, project_id, user_id, owner_id, status, node_ids, completed_node_ids,
	current_node_id, error_message, lease_expires_at, started_at, updated_at, finished_at`

func scanCanvasWorkflowRun(row pgx.Row) (*CanvasWorkflowRun, error) {
	var item CanvasWorkflowRun
	if err := row.Scan(
		&item.ID, &item.ProjectID, &item.UserID, &item.OwnerID, &item.Status, &item.NodeIDs, &item.CompletedNodeIDs,
		&item.CurrentNodeID, &item.ErrorMessage, &item.LeaseExpiresAt, &item.StartedAt, &item.UpdatedAt, &item.FinishedAt,
	); err != nil {
		return nil, err
	}
	return &item, nil
}

func scanOptionalCanvasWorkflowRun(row pgx.Row) (*CanvasWorkflowRun, error) {
	item, err := scanCanvasWorkflowRun(row)
	return nilOnNoRows(item, err)
}

func GetActiveCanvasWorkflowRun(ctx context.Context, q Q, userID, projectID uuid.UUID) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `SELECT `+canvasWorkflowRunCols+`
		FROM canvas_workflow_runs WHERE user_id = $1 AND project_id = $2 AND status = 'running'`, userID, projectID))
}

// AcquireCanvasWorkflowRun creates the active run or takes over an expired lease.
// The same owner may reacquire immediately after a page refresh.
func AcquireCanvasWorkflowRun(ctx context.Context, q Q, userID, projectID, ownerID uuid.UUID, nodeIDs json.RawMessage, now time.Time, lease time.Duration) (*CanvasWorkflowRun, bool, error) {
	item, err := scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET owner_id = $3, lease_expires_at = $5, updated_at = $4
		WHERE user_id = $1 AND project_id = $2 AND status = 'running'
		  AND (owner_id = $3 OR lease_expires_at IS NULL OR lease_expires_at <= $4)
		RETURNING `+canvasWorkflowRunCols, userID, projectID, ownerID, now, now.Add(lease)))
	if err != nil || item != nil {
		return item, item != nil, err
	}

	item, err = scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `INSERT INTO canvas_workflow_runs
		(project_id, user_id, owner_id, status, node_ids, completed_node_ids, lease_expires_at, started_at, updated_at)
		VALUES ($1, $2, $3, 'running', $4, '[]'::jsonb, $6, $5, $5)
		ON CONFLICT (project_id) WHERE status = 'running' DO NOTHING
		RETURNING `+canvasWorkflowRunCols, projectID, userID, ownerID, nodeIDs, now, now.Add(lease)))
	if err != nil || item != nil {
		return item, item != nil, err
	}
	item, err = GetActiveCanvasWorkflowRun(ctx, q, userID, projectID)
	return item, false, err
}

func UpdateCanvasWorkflowRunProgress(ctx context.Context, q Q, userID, projectID, runID, ownerID uuid.UUID, completedNodeIDs json.RawMessage, currentNodeID string, now time.Time, lease time.Duration) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET completed_node_ids = $5, current_node_id = NULLIF($6, ''), lease_expires_at = $8, updated_at = $7
		WHERE id = $3 AND project_id = $2 AND user_id = $1 AND owner_id = $4 AND status = 'running'
		RETURNING `+canvasWorkflowRunCols, userID, projectID, runID, ownerID, completedNodeIDs, currentNodeID, now, now.Add(lease)))
}

func FinishCanvasWorkflowRun(ctx context.Context, q Q, userID, projectID, runID, ownerID uuid.UUID, status string, completedNodeIDs json.RawMessage, currentNodeID, errorMessage string, now time.Time) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET status = $5, completed_node_ids = $6, current_node_id = NULLIF($7, ''), error_message = $8,
			lease_expires_at = NULL, updated_at = $9, finished_at = $9
		WHERE id = $3 AND project_id = $2 AND user_id = $1 AND owner_id = $4 AND status = 'running'
		RETURNING `+canvasWorkflowRunCols, userID, projectID, runID, ownerID, status, completedNodeIDs, currentNodeID, errorMessage, now))
}

func CancelCanvasWorkflowRun(ctx context.Context, q Q, userID, projectID, runID uuid.UUID, completedNodeIDs json.RawMessage, currentNodeID string, now time.Time) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET status = 'canceled', completed_node_ids = $4, current_node_id = NULLIF($5, ''),
			lease_expires_at = NULL, updated_at = $6, finished_at = $6
		WHERE id = $3 AND project_id = $2 AND user_id = $1 AND status = 'running'
		RETURNING `+canvasWorkflowRunCols, userID, projectID, runID, completedNodeIDs, currentNodeID, now))
}
