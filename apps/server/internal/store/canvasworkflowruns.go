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
	CanceledNodeIDs  json.RawMessage `json:"canceledNodeIds"`
	CurrentNodeID    *string         `json:"currentNodeId"`
	ErrorMessage     string          `json:"errorMessage"`
	NodeMetrics      json.RawMessage `json:"nodeMetrics"`
	TotalCostCents   int64           `json:"totalCostCents"`
	ErrorNodeID      *string         `json:"errorNodeId"`
	LeaseExpiresAt   *time.Time      `json:"leaseExpiresAt"`
	StartedAt        time.Time       `json:"startedAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
	FinishedAt       *time.Time      `json:"finishedAt"`
}

const canvasWorkflowRunCols = `id, project_id, user_id, owner_id, status, node_ids, completed_node_ids, canceled_node_ids,
	current_node_id, error_message, node_metrics, total_cost_cents, error_node_id, lease_expires_at, started_at, updated_at, finished_at`

func scanCanvasWorkflowRun(row pgx.Row) (*CanvasWorkflowRun, error) {
	var item CanvasWorkflowRun
	if err := row.Scan(
		&item.ID, &item.ProjectID, &item.UserID, &item.OwnerID, &item.Status, &item.NodeIDs, &item.CompletedNodeIDs, &item.CanceledNodeIDs,
		&item.CurrentNodeID, &item.ErrorMessage, &item.NodeMetrics, &item.TotalCostCents, &item.ErrorNodeID, &item.LeaseExpiresAt,
		&item.StartedAt, &item.UpdatedAt, &item.FinishedAt,
	); err != nil {
		return nil, err
	}
	return &item, nil
}

type CanvasWorkflowRunProgress struct {
	CompletedNodeIDs json.RawMessage
	CanceledNodeIDs  json.RawMessage
	CurrentNodeID    string
	NodeMetrics      json.RawMessage
	TotalCostCents   *int64
	ErrorNodeID      string
	ErrorMessage     string
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

func UpdateCanvasWorkflowRunProgress(ctx context.Context, q Q, userID, projectID, runID, ownerID uuid.UUID, completedNodeIDs, canceledNodeIDs json.RawMessage, currentNodeID string, now time.Time, lease time.Duration) (*CanvasWorkflowRun, error) {
	return UpdateCanvasWorkflowRunProgressWithMetrics(ctx, q, userID, projectID, runID, ownerID, CanvasWorkflowRunProgress{
		CompletedNodeIDs: completedNodeIDs, CanceledNodeIDs: canceledNodeIDs, CurrentNodeID: currentNodeID,
	}, now, lease)
}

func UpdateCanvasWorkflowRunProgressWithMetrics(ctx context.Context, q Q, userID, projectID, runID, ownerID uuid.UUID, progress CanvasWorkflowRunProgress, now time.Time, lease time.Duration) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET completed_node_ids = $5,
			canceled_node_ids = (
				SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
				FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(canvas_workflow_runs.canceled_node_ids || $6::jsonb) AS canceled(value)) merged
			),
			current_node_id = NULLIF($7, ''),
			node_metrics = COALESCE($10::jsonb, node_metrics),
			total_cost_cents = COALESCE($11, total_cost_cents),
			error_node_id = NULLIF($12, ''),
			lease_expires_at = $9, updated_at = $8
		WHERE id = $3 AND project_id = $2 AND user_id = $1 AND owner_id = $4 AND status = 'running'
		RETURNING `+canvasWorkflowRunCols, userID, projectID, runID, ownerID, progress.CompletedNodeIDs, progress.CanceledNodeIDs,
		progress.CurrentNodeID, now, now.Add(lease), nullableJSON(progress.NodeMetrics), progress.TotalCostCents, progress.ErrorNodeID))
}

func FinishCanvasWorkflowRun(ctx context.Context, q Q, userID, projectID, runID, ownerID uuid.UUID, status string, completedNodeIDs, canceledNodeIDs json.RawMessage, currentNodeID, errorMessage string, now time.Time) (*CanvasWorkflowRun, error) {
	return FinishCanvasWorkflowRunWithMetrics(ctx, q, userID, projectID, runID, ownerID, status, CanvasWorkflowRunProgress{
		CompletedNodeIDs: completedNodeIDs, CanceledNodeIDs: canceledNodeIDs, CurrentNodeID: currentNodeID, ErrorMessage: errorMessage,
	}, now)
}

func FinishCanvasWorkflowRunWithMetrics(ctx context.Context, q Q, userID, projectID, runID, ownerID uuid.UUID, status string, progress CanvasWorkflowRunProgress, now time.Time) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET status = $5, completed_node_ids = $6,
			canceled_node_ids = (
				SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
				FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(canvas_workflow_runs.canceled_node_ids || $7::jsonb) AS canceled(value)) merged
			),
			current_node_id = NULLIF($8, ''), error_message = $9,
			node_metrics = COALESCE($11::jsonb, node_metrics),
			total_cost_cents = COALESCE($12, total_cost_cents),
			error_node_id = NULLIF($13, ''),
			lease_expires_at = NULL, updated_at = $10, finished_at = $10
		WHERE id = $3 AND project_id = $2 AND user_id = $1 AND owner_id = $4 AND status = 'running'
		RETURNING `+canvasWorkflowRunCols, userID, projectID, runID, ownerID, status, progress.CompletedNodeIDs,
		progress.CanceledNodeIDs, progress.CurrentNodeID, progress.ErrorMessage, now, nullableJSON(progress.NodeMetrics), progress.TotalCostCents, progress.ErrorNodeID))
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

// FailAbandonedCanvasWorkflowRuns terminates running rows whose lease expired
// before the cutoff (owner never came back). Lease takeover on acquire already
// lets a returning client resume, so anything expired this long is abandoned.
func FailAbandonedCanvasWorkflowRuns(ctx context.Context, q Q, leaseExpiredBefore, now time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `UPDATE canvas_workflow_runs
		SET status = 'failed', error_message = 'workflow abandoned: lease expired',
			lease_expires_at = NULL, updated_at = $2, finished_at = $2
		WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1`,
		leaseExpiredBefore, now)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// DeleteFinishedCanvasWorkflowRunsBefore removes terminal run rows past the
// retention window; uses ix_canvas_workflow_runs_finished.
func DeleteFinishedCanvasWorkflowRunsBefore(ctx context.Context, q Q, before time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM canvas_workflow_runs
		WHERE status <> 'running' AND finished_at IS NOT NULL AND finished_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func CancelCanvasWorkflowRun(ctx context.Context, q Q, userID, projectID, runID uuid.UUID, completedNodeIDs, canceledNodeIDs json.RawMessage, currentNodeID string, now time.Time) (*CanvasWorkflowRun, error) {
	return CancelCanvasWorkflowRunWithMetrics(ctx, q, userID, projectID, runID, CanvasWorkflowRunProgress{
		CompletedNodeIDs: completedNodeIDs, CanceledNodeIDs: canceledNodeIDs, CurrentNodeID: currentNodeID,
	}, now)
}

func CancelCanvasWorkflowRunWithMetrics(ctx context.Context, q Q, userID, projectID, runID uuid.UUID, progress CanvasWorkflowRunProgress, now time.Time) (*CanvasWorkflowRun, error) {
	return scanOptionalCanvasWorkflowRun(q.QueryRow(ctx, `UPDATE canvas_workflow_runs
		SET status = 'canceled', completed_node_ids = $4,
			canceled_node_ids = (
				SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
				FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(canvas_workflow_runs.canceled_node_ids || $5::jsonb) AS canceled(value)) merged
			),
			current_node_id = NULLIF($6, ''),
			node_metrics = COALESCE($8::jsonb, node_metrics),
			total_cost_cents = COALESCE($9, total_cost_cents),
			error_node_id = NULLIF($10, ''),
			lease_expires_at = NULL, updated_at = $7, finished_at = $7
		WHERE id = $3 AND project_id = $2 AND user_id = $1 AND status = 'running'
		RETURNING `+canvasWorkflowRunCols, userID, projectID, runID, progress.CompletedNodeIDs, progress.CanceledNodeIDs,
		progress.CurrentNodeID, now, nullableJSON(progress.NodeMetrics), progress.TotalCostCents, progress.ErrorNodeID))
}
