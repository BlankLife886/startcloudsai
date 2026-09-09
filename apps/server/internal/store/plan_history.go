package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Transaction-local attribution covers indirect edits such as clearing a recommendation.
func SetPlanEditor(ctx context.Context, tx pgx.Tx, admin *User) error {
	_, err := tx.Exec(ctx, `SELECT set_config('app.plan_actor_id',$1,true),set_config('app.plan_actor_name',$2,true)`, admin.ID.String(), admin.Username+" ("+admin.Email+")")
	return err
}

type PlanHistoryEntry struct {
	Revision         int             `json:"revision"`
	Snapshot         json.RawMessage `json:"snapshot"`
	Previous         json.RawMessage `json:"previous"`
	PreviousRevision *int            `json:"previousRevision"`
	CreatedAt        time.Time       `json:"createdAt"`
	ActorID          *uuid.UUID      `json:"actorId"`
	ActorName        *string         `json:"actorName"`
	Action           string          `json:"action"`
	Current          bool            `json:"current"`
	OrderCount       int64           `json:"orderCount"`
}

func ListPlanHistory(ctx context.Context, q Q, id uuid.UUID, before, limit int) ([]PlanHistoryEntry, error) {
	rows, err := q.Query(ctx, `SELECT v.revision,v.snapshot,prev.snapshot,prev.revision,v.created_at,v.actor_id,v.actor_name,v.action,
 v.revision=p.revision,(SELECT count(*) FROM orders o WHERE o.plan_id=v.plan_id AND o.plan_revision_snapshot=v.revision)
 FROM plan_versions v JOIN plans p ON p.id=v.plan_id
 LEFT JOIN LATERAL(SELECT revision,snapshot FROM plan_versions WHERE plan_id=v.plan_id AND revision<v.revision ORDER BY revision DESC LIMIT 1) prev ON true
 WHERE v.plan_id=$1 AND ($2::int=0 OR v.revision<$2) ORDER BY v.revision DESC LIMIT $3`, id, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlanHistoryEntry{}
	for rows.Next() {
		var v PlanHistoryEntry
		if err := rows.Scan(&v.Revision, &v.Snapshot, &v.Previous, &v.PreviousRevision, &v.CreatedAt, &v.ActorID, &v.ActorName, &v.Action, &v.Current, &v.OrderCount); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
