package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const promptCategoryCols = `id, key, label, sort, active, builtin, created_at, updated_at`

func scanPromptCategory(row pgx.Row) (*PromptCategory, error) {
	var category PromptCategory
	if err := row.Scan(
		&category.ID,
		&category.Key,
		&category.Label,
		&category.Sort,
		&category.Active,
		&category.Builtin,
		&category.CreatedAt,
		&category.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &category, nil
}

func InsertPromptCategory(ctx context.Context, q Q, key, label string, sort int, active bool) (*PromptCategory, error) {
	return scanPromptCategory(q.QueryRow(ctx,
		`INSERT INTO prompt_categories (key, label, sort, active)
		 VALUES ($1, $2, $3, $4)
		 RETURNING `+promptCategoryCols,
		key, label, sort, active))
}

func GetPromptCategory(ctx context.Context, q Q, id uuid.UUID) (*PromptCategory, error) {
	category, err := scanPromptCategory(q.QueryRow(ctx,
		`SELECT `+promptCategoryCols+` FROM prompt_categories WHERE id = $1`, id))
	return nilOnNoRows(category, err)
}

func GetPromptCategoryByKey(ctx context.Context, q Q, key string) (*PromptCategory, error) {
	category, err := scanPromptCategory(q.QueryRow(ctx,
		`SELECT `+promptCategoryCols+` FROM prompt_categories WHERE key = $1`, key))
	return nilOnNoRows(category, err)
}

func ListPromptCategories(ctx context.Context, q Q, activeOnly bool) ([]*PromptCategory, error) {
	sql := `SELECT ` + promptCategoryCols + ` FROM prompt_categories`
	if activeOnly {
		sql += ` WHERE active`
	}
	sql += ` ORDER BY sort ASC, created_at ASC`
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := make([]*PromptCategory, 0)
	for rows.Next() {
		category, err := scanPromptCategory(rows)
		if err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func MaxPromptCategorySort(ctx context.Context, q Q) (int, error) {
	var maxSort int
	err := q.QueryRow(ctx, `SELECT COALESCE(MAX(sort), 0) FROM prompt_categories`).Scan(&maxSort)
	return maxSort, err
}

func UpdatePromptCategory(ctx context.Context, q Q, category *PromptCategory) error {
	_, err := q.Exec(ctx,
		`UPDATE prompt_categories
		 SET label = $2, sort = $3, active = $4, updated_at = now()
		 WHERE id = $1`,
		category.ID, category.Label, category.Sort, category.Active)
	return err
}

// DeletePromptCategory reassigns existing prompts before removing a custom category.
// The caller must provide a transaction so both writes commit atomically.
func DeletePromptCategory(ctx context.Context, q Q, id uuid.UUID, key string) error {
	if _, err := q.Exec(ctx,
		`UPDATE prompt_library SET category = 'other' WHERE category = $1`, key); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `DELETE FROM prompt_categories WHERE id = $1`, id)
	return err
}
