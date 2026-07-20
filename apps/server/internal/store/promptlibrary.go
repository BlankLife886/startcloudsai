package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const promptCols = `id, title, prompt, task_type, category, tags, cover_key, sort, active, created_at`

func scanPromptEntry(row pgx.Row) (*PromptEntry, error) {
	var p PromptEntry
	err := row.Scan(&p.ID, &p.Title, &p.Prompt, &p.TaskType, &p.Category, &p.Tags,
		&p.CoverKey, &p.Sort, &p.Active, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func InsertPromptEntry(ctx context.Context, q Q, p *PromptEntry) (*PromptEntry, error) {
	if p.Tags == nil {
		p.Tags = []string{}
	}
	return scanPromptEntry(q.QueryRow(ctx,
		`INSERT INTO prompt_library (title, prompt, task_type, category, tags, sort, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+promptCols,
		p.Title, p.Prompt, p.TaskType, p.Category, p.Tags, p.Sort, p.Active))
}

func GetPromptEntry(ctx context.Context, q Q, id uuid.UUID) (*PromptEntry, error) {
	p, err := scanPromptEntry(q.QueryRow(ctx,
		`SELECT `+promptCols+` FROM prompt_library WHERE id = $1`, id))
	return nilOnNoRows(p, err)
}

// PromptFilter 提示词库列表筛选；ActiveOnly 用于公开接口。
type PromptFilter struct {
	TaskType   string
	Category   string
	Search     string
	ActiveOnly bool
}

// ListPromptEntries 提示词分页（limit+1 行）。
func ListPromptEntries(ctx context.Context, q Q, f PromptFilter, limit int, cursor *Cursor) ([]*PromptEntry, error) {
	sql := `SELECT ` + promptCols + ` FROM prompt_library WHERE true`
	args := []any{}
	if f.ActiveOnly {
		sql += ` AND active`
	}
	if f.TaskType != "" {
		args = append(args, f.TaskType)
		sql += fmt.Sprintf(` AND task_type = $%d`, len(args))
	}
	if f.Category != "" {
		args = append(args, f.Category)
		sql += fmt.Sprintf(` AND category = $%d`, len(args))
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		sql += fmt.Sprintf(` AND (title ILIKE $%d OR prompt ILIKE $%d)`, len(args), len(args))
	}
	sql, args = appendCursor(sql, args, cursor, limit)
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*PromptEntry
	for rows.Next() {
		p, err := scanPromptEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func UpdatePromptEntry(ctx context.Context, q Q, p *PromptEntry) error {
	if p.Tags == nil {
		p.Tags = []string{}
	}
	_, err := q.Exec(ctx,
		`UPDATE prompt_library SET title = $2, prompt = $3, task_type = $4, category = $5,
			tags = $6, sort = $7, active = $8 WHERE id = $1`,
		p.ID, p.Title, p.Prompt, p.TaskType, p.Category, p.Tags, p.Sort, p.Active)
	return err
}

func UpdatePromptCoverKey(ctx context.Context, q Q, id uuid.UUID, coverKey string) error {
	_, err := q.Exec(ctx, `UPDATE prompt_library SET cover_key = $2 WHERE id = $1`, id, coverKey)
	return err
}

func DeletePromptEntry(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM prompt_library WHERE id = $1`, id)
	return err
}
