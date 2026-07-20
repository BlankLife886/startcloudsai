package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const planCols = `id, code, name, price_cents, grant_cents, bonus_cents, features, active, sort, created_at`

func scanPlan(row pgx.Row) (*Plan, error) {
	var p Plan
	err := row.Scan(&p.ID, &p.Code, &p.Name, &p.PriceCents, &p.GrantCents, &p.BonusCents, &p.Features, &p.Active, &p.Sort, &p.CreatedAt)
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
	return scanPlan(q.QueryRow(ctx,
		`INSERT INTO plans (code, name, price_cents, grant_cents, bonus_cents, features, active, sort)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+planCols,
		p.Code, p.Name, p.PriceCents, p.GrantCents, p.BonusCents, p.Features, p.Active, p.Sort))
}

// UpdatePlan 全量回写（调用方先取出并修改字段）。
func UpdatePlan(ctx context.Context, q Q, p *Plan) error {
	_, err := q.Exec(ctx,
		`UPDATE plans SET code = $2, name = $3, price_cents = $4, grant_cents = $5, bonus_cents = $6,
		 features = $7, active = $8, sort = $9 WHERE id = $1`,
		p.ID, p.Code, p.Name, p.PriceCents, p.GrantCents, p.BonusCents, p.Features, p.Active, p.Sort)
	return err
}

func ListPlans(ctx context.Context, q Q, activeOnly bool) ([]*Plan, error) {
	sql := `SELECT ` + planCols + ` FROM plans`
	if activeOnly {
		sql += ` WHERE active = true`
	}
	sql += ` ORDER BY sort, created_at`
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
