package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const planCols = `id, code, name, description, badge, kind, price_cents, grant_cents, bonus_cents, duration_days, daily_grant_cents, features, active, recommended, sort, created_at, updated_at`

func scanPlan(row pgx.Row) (*Plan, error) {
	var p Plan
	err := row.Scan(&p.ID, &p.Code, &p.Name, &p.Description, &p.Badge, &p.Kind, &p.PriceCents, &p.GrantCents, &p.BonusCents,
		&p.DurationDays, &p.DailyGrantCents, &p.Features, &p.Active, &p.Recommended, &p.Sort, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func GetPlan(ctx context.Context, q Q, id uuid.UUID) (*Plan, error) {
	p, err := scanPlan(q.QueryRow(ctx, `SELECT `+planCols+` FROM plans WHERE id = $1`, id))
	return nilOnNoRows(p, err)
}

func GetActivePlan(ctx context.Context, q Q, id uuid.UUID) (*Plan, error) {
	p, err := scanPlan(q.QueryRow(ctx, `SELECT `+planCols+` FROM plans WHERE id = $1 AND active = true`, id))
	return nilOnNoRows(p, err)
}

func GetPlanByCode(ctx context.Context, q Q, code string) (*Plan, error) {
	p, err := scanPlan(q.QueryRow(ctx, `SELECT `+planCols+` FROM plans WHERE code = $1`, code))
	return nilOnNoRows(p, err)
}

func InsertPlan(ctx context.Context, q Q, p *Plan) (*Plan, error) {
	if p.Features == nil {
		p.Features = []string{}
	}
	if p.Kind == "" {
		p.Kind = "topup"
	}
	return scanPlan(q.QueryRow(ctx,
		`INSERT INTO plans (code, name, description, badge, kind, price_cents, grant_cents, bonus_cents, duration_days, daily_grant_cents, features, active, recommended, sort)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING `+planCols,
		p.Code, p.Name, p.Description, p.Badge, p.Kind, p.PriceCents, p.GrantCents, p.BonusCents,
		p.DurationDays, p.DailyGrantCents, p.Features, p.Active, p.Recommended, p.Sort))
}

// UpdatePlan 全量回写（调用方先取出并修改字段）。
func UpdatePlan(ctx context.Context, q Q, p *Plan) error {
	_, err := q.Exec(ctx,
		`UPDATE plans SET code = $2, name = $3, description = $4, badge = $5, kind = $6, price_cents = $7,
		 grant_cents = $8, bonus_cents = $9, duration_days = $10, daily_grant_cents = $11, features = $12,
		 active = $13, recommended = $14, sort = $15, updated_at = now() WHERE id = $1`,
		p.ID, p.Code, p.Name, p.Description, p.Badge, p.Kind, p.PriceCents, p.GrantCents, p.BonusCents,
		p.DurationDays, p.DailyGrantCents, p.Features, p.Active, p.Recommended, p.Sort)
	return err
}

func ClearRecommendedPlans(ctx context.Context, q Q, exceptID uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE plans SET recommended = false, updated_at = now() WHERE recommended = true AND id <> $1`, exceptID)
	return err
}

func ListPlanUsage(ctx context.Context, q Q) (map[uuid.UUID]PlanUsage, error) {
	rows, err := q.Query(ctx, `SELECT p.id, count(DISTINCT o.id), count(DISTINCT s.id)
		FROM plans p
		LEFT JOIN orders o ON o.plan_id = p.id
		LEFT JOIN subscriptions s ON s.plan_id = p.id
		GROUP BY p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]PlanUsage)
	for rows.Next() {
		var id uuid.UUID
		var usage PlanUsage
		if err := rows.Scan(&id, &usage.OrderCount, &usage.SubscriptionCount); err != nil {
			return nil, err
		}
		out[id] = usage
	}
	return out, rows.Err()
}

func GetPlanUsage(ctx context.Context, q Q, id uuid.UUID) (PlanUsage, error) {
	var usage PlanUsage
	err := q.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM orders WHERE plan_id = $1),
		(SELECT count(*) FROM subscriptions WHERE plan_id = $1)`, id).
		Scan(&usage.OrderCount, &usage.SubscriptionCount)
	return usage, err
}

func DeletePlan(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM plans WHERE id = $1
		AND NOT EXISTS (SELECT 1 FROM orders WHERE plan_id = $1)
		AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = $1)`, id)
	return tag.RowsAffected() > 0, err
}

func ListPlans(ctx context.Context, q Q, activeOnly bool) ([]*Plan, error) {
	sql := `SELECT ` + planCols + ` FROM plans`
	if activeOnly {
		sql += ` WHERE active = true`
	}
	sql += ` ORDER BY sort ASC, created_at ASC, id ASC`
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Plan
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func applyPlanOrderedIDs(allIDs, orderedIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(orderedIDs) == 0 {
		return allIDs, nil
	}
	selected := make(map[uuid.UUID]bool, len(orderedIDs))
	for _, id := range orderedIDs {
		if selected[id] {
			return nil, fmt.Errorf("duplicate plan id %s", id)
		}
		selected[id] = true
	}
	selectedSlots := make([]int, 0, len(orderedIDs))
	for index, id := range allIDs {
		if selected[id] {
			selectedSlots = append(selectedSlots, index)
		}
	}
	if len(selectedSlots) != len(orderedIDs) {
		return nil, fmt.Errorf("one or more plan ids do not exist in this kind")
	}
	next := append([]uuid.UUID(nil), allIDs...)
	for index, slot := range selectedSlots {
		next[slot] = orderedIDs[index]
	}
	return next, nil
}

// ReorderPlans replaces the selected items in their current kind slots and
// then normalizes sort values. Plans outside the selection keep their relative
// positions, so filtered sorting is safe.
func ReorderPlans(ctx context.Context, q Q, kind string, orderedIDs []uuid.UUID) error {
	if kind == "" || len(orderedIDs) == 0 {
		return nil
	}
	rows, err := q.Query(ctx,
		`SELECT id FROM plans WHERE kind = $1 ORDER BY sort ASC, created_at ASC, id ASC FOR UPDATE`,
		kind)
	if err != nil {
		return err
	}
	allIDs := make([]uuid.UUID, 0, len(orderedIDs))
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		allIDs = append(allIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	next, err := applyPlanOrderedIDs(allIDs, orderedIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE plans AS plan
		SET sort = (ordered.position * 10)::integer, updated_at = now()
		FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
		WHERE plan.id = ordered.id`, next)
	return err
}

func GetPlansByIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*Plan, error) {
	out := map[uuid.UUID]*Plan{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+planCols+` FROM plans WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out[p.ID] = p
	}
	return out, rows.Err()
}
