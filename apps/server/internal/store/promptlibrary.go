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
	// 提示词由运营 sort 升序排列；created_at/id 仅作为同 sort 下的稳定次序。
	// 旧游标仍只编码 created_at/id，通过游标 id 读取 sort，避免破坏现有 API 契约。
	if cursor != nil {
		args = append(args, cursor.ID)
		idPos := len(args)
		args = append(args, cursor.CreatedAt)
		timePos := len(args)
		sql += fmt.Sprintf(` AND (
			sort > (SELECT sort FROM prompt_library WHERE id = $%d)
			OR (sort = (SELECT sort FROM prompt_library WHERE id = $%d)
				AND (created_at < $%d OR (created_at = $%d AND id < $%d)))
		)`, idPos, idPos, timePos, timePos, idPos)
	}
	args = append(args, limit+1)
	sql += fmt.Sprintf(` ORDER BY sort ASC, created_at DESC, id DESC LIMIT $%d`, len(args))
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

// CountPromptEntriesByCategory 返回筛选范围内的全量分类计数，不受分页影响。
// Category 故意不参与条件，使前端切换分类时仍能展示完整分类导航。
func CountPromptEntriesByCategory(ctx context.Context, q Q, f PromptFilter) (map[string]int64, error) {
	sql := `SELECT COALESCE(NULLIF(category, ''), 'other'), count(*)
		FROM prompt_library WHERE true`
	args := []any{}
	if f.ActiveOnly {
		sql += ` AND active`
	}
	if f.TaskType != "" {
		args = append(args, f.TaskType)
		sql += fmt.Sprintf(` AND task_type = $%d`, len(args))
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		sql += fmt.Sprintf(` AND (title ILIKE $%d OR prompt ILIKE $%d)`, len(args), len(args))
	}
	sql += ` GROUP BY 1`

	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int64{"all": 0}
	for rows.Next() {
		var category string
		var count int64
		if err := rows.Scan(&category, &count); err != nil {
			return nil, err
		}
		counts[category] = count
		counts["all"] += count
	}
	return counts, rows.Err()
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
