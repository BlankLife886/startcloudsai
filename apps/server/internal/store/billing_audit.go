package store

import (
	"context"
	"encoding/json"
)

type BillingAudit struct {
	SourceID      string          `json:"sourceId"`
	Decision      BillingDecision `json:"decision"`
	SettledPoints int64           `json:"settledPoints"`
	Allocations   json.RawMessage `json:"allocations"`
}

// A single batch query includes all reservation generations, including failed retries.
func ListBillingAudit(ctx context.Context, q Q, ids []string) (map[string][]BillingAudit, error) {
	out := map[string][]BillingAudit{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT split_part(d.source_id,'/',1),d.source_id,d.snapshot,d.settled_points,
 COALESCE((SELECT jsonb_agg(x) FROM (
 SELECT 'subscription' AS bucket,l.subscription_id::text AS origin,l.id AS lot_id,a.allocated_points,a.remaining_points,
 CASE WHEN a.accounting_version=2 THEN a.settled_points END AS settled_points,
 CASE WHEN a.accounting_version=2 THEN a.released_points END AS released_points,
 CASE WHEN a.accounting_version=2 THEN a.expired_points END AS expired_points,false AS price_lock_eligible
 FROM subscription_credit_allocations a JOIN subscription_credit_lots l ON l.id=a.lot_id WHERE a.source_type=d.source_type AND a.source_id=d.source_id
 UNION ALL
 SELECT 'topup',l.plan_name,l.id,a.allocated_points,a.remaining_points,a.settled_points,a.released_points,0,l.price_lock_eligible
 FROM topup_credit_allocations a JOIN topup_credit_lots l ON l.id=a.lot_id WHERE a.source_type=d.source_type AND a.source_id=d.source_id
 ) x),'[]'::jsonb)
 FROM billing_decisions d WHERE d.source_type IN ('task','assistant_run') AND split_part(d.source_id,'/',1)=ANY($1) ORDER BY d.created_at DESC,d.source_id DESC`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var a BillingAudit
		if err := rows.Scan(&id, &a.SourceID, &a.Decision, &a.SettledPoints, &a.Allocations); err != nil {
			return nil, err
		}
		out[id] = append(out[id], a)
	}
	return out, rows.Err()
}
