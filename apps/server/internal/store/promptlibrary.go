package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const promptCols = `id, title, prompt, task_type, category, tags, cover_key, gallery_submission_id,
	sort, like_count, favorite_count, use_count, active, created_at`

func scanPromptEntry(row pgx.Row) (*PromptEntry, error) {
	var p PromptEntry
	err := row.Scan(&p.ID, &p.Title, &p.Prompt, &p.TaskType, &p.Category, &p.Tags,
		&p.CoverKey, &p.GallerySubmissionID, &p.Sort, &p.LikeCount, &p.FavoriteCount,
		&p.UseCount, &p.Active, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func InsertPromptEntry(ctx context.Context, q Q, p *PromptEntry) (*PromptEntry, error) {
	if p.Tags == nil {
		p.Tags = []string{}
	}
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return scanPromptEntry(q.QueryRow(ctx,
		`INSERT INTO prompt_library (id, title, prompt, task_type, category, tags, gallery_submission_id,
			sort, like_count, favorite_count, use_count, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING `+promptCols,
		p.ID, p.Title, p.Prompt, p.TaskType, p.Category, p.Tags, p.GallerySubmissionID,
		p.Sort, p.LikeCount, p.FavoriteCount, p.UseCount, p.Active))
}

func GetPromptEntry(ctx context.Context, q Q, id uuid.UUID) (*PromptEntry, error) {
	p, err := scanPromptEntry(q.QueryRow(ctx,
		`SELECT `+promptCols+` FROM prompt_library WHERE id = $1`, id))
	return nilOnNoRows(p, err)
}

func GetPromptEntryByGallerySubmission(ctx context.Context, q Q, submissionID uuid.UUID) (*PromptEntry, error) {
	p, err := scanPromptEntry(q.QueryRow(ctx,
		`SELECT `+promptCols+` FROM prompt_library WHERE gallery_submission_id = $1`, submissionID))
	return nilOnNoRows(p, err)
}

// PromptFilter 提示词库列表筛选；ActiveOnly 用于公开接口。
type PromptFilter struct {
	TaskType      string
	Category      string
	Search        string
	Status        string
	Order         string
	ActiveOnly    bool
	FavoritedBy   uuid.UUID
	CreatedFrom   *time.Time
	CreatedBefore *time.Time
}

func appendPromptFilter(sql string, args []any, f PromptFilter) (string, []any) {
	if f.ActiveOnly || f.Status == "enabled" {
		sql += ` AND active`
	} else if f.Status == "disabled" {
		sql += ` AND NOT active`
	} else if f.Status == "missing-cover" {
		sql += ` AND (cover_key IS NULL OR cover_key = '')`
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
	if f.FavoritedBy != uuid.Nil {
		args = append(args, f.FavoritedBy)
		sql += fmt.Sprintf(` AND EXISTS (
			SELECT 1 FROM prompt_user_engagement pue
			WHERE pue.prompt_id = prompt_library.id AND pue.user_id = $%d AND pue.favorited
		)`, len(args))
	}
	if f.CreatedFrom != nil {
		args = append(args, *f.CreatedFrom)
		sql += fmt.Sprintf(` AND created_at >= $%d`, len(args))
	}
	if f.CreatedBefore != nil {
		args = append(args, *f.CreatedBefore)
		sql += fmt.Sprintf(` AND created_at < $%d`, len(args))
	}
	return sql, args
}

// ListPromptEntries 提示词分页（limit+1 行）。
func ListPromptEntries(ctx context.Context, q Q, f PromptFilter, limit int, cursor *Cursor) ([]*PromptEntry, error) {
	sql := `SELECT ` + promptCols + ` FROM prompt_library WHERE true`
	args := []any{}
	sql, args = appendPromptFilter(sql, args, f)
	order := f.Order
	if order == "" {
		order = "manual"
	}
	if cursor != nil {
		args = append(args, cursor.ID)
		idPos := len(args)
		args = append(args, cursor.CreatedAt)
		timePos := len(args)
		switch order {
		case "latest":
			sql += fmt.Sprintf(` AND (created_at < $%d OR (created_at = $%d AND id < $%d))`, timePos, timePos, idPos)
		case "favorites", "likes", "usage", "recommended":
			metric := promptOrderMetric(order)
			sql += fmt.Sprintf(` AND (
				%s < (SELECT %s FROM prompt_library WHERE id = $%d)
				OR (%s = (SELECT %s FROM prompt_library WHERE id = $%d)
					AND (created_at < $%d OR (created_at = $%d AND id < $%d)))
			)`, metric, metric, idPos, metric, metric, idPos, timePos, timePos, idPos)
		default:
			sql += fmt.Sprintf(` AND (
				sort > (SELECT sort FROM prompt_library WHERE id = $%d)
				OR (sort = (SELECT sort FROM prompt_library WHERE id = $%d)
					AND (created_at < $%d OR (created_at = $%d AND id < $%d)))
			)`, idPos, idPos, timePos, timePos, idPos)
		}
	}
	args = append(args, limit+1)
	switch order {
	case "latest":
		sql += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, len(args))
	case "favorites", "likes", "usage", "recommended":
		sql += fmt.Sprintf(` ORDER BY %s DESC, created_at DESC, id DESC LIMIT $%d`, promptOrderMetric(order), len(args))
	default:
		sql += fmt.Sprintf(` ORDER BY sort ASC, created_at DESC, id DESC LIMIT $%d`, len(args))
	}
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

func promptOrderMetric(order string) string {
	switch order {
	case "favorites":
		return "favorite_count"
	case "likes":
		return "like_count"
	case "usage":
		return "use_count"
	default:
		return `(favorite_count * 5 + like_count * 3 + use_count +
			GREATEST(0, 30 - (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::integer) * 10)`
	}
}

func CountPromptEntries(ctx context.Context, q Q, f PromptFilter) (int, error) {
	sql, args := appendPromptFilter(`SELECT count(*) FROM prompt_library WHERE true`, nil, f)
	var count int
	err := q.QueryRow(ctx, sql, args...).Scan(&count)
	return count, err
}

func PromptEntryPosition(ctx context.Context, q Q, id uuid.UUID, f PromptFilter) (position int, count int, found bool, err error) {
	inner, args := appendPromptFilter(`SELECT id,
		row_number() OVER (ORDER BY sort ASC, created_at DESC, id DESC) AS position,
		count(*) OVER () AS total
		FROM prompt_library WHERE true`, nil, f)
	args = append(args, id)
	sql := `SELECT position, total FROM (` + inner + fmt.Sprintf(`) ranked WHERE id = $%d`, len(args))
	err = q.QueryRow(ctx, sql, args...).Scan(&position, &count)
	if err == pgx.ErrNoRows {
		return 0, 0, false, nil
	}
	return position, count, err == nil, err
}

// CountPromptEntriesByCategory 返回筛选范围内的全量分类计数，不受分页影响。
// Category 故意不参与条件，使前端切换分类时仍能展示完整分类导航。
func CountPromptEntriesByCategory(ctx context.Context, q Q, f PromptFilter) (map[string]int64, error) {
	sql := `SELECT COALESCE(NULLIF(category, ''), 'other'), count(*)
		FROM prompt_library WHERE true`
	args := []any{}
	if f.ActiveOnly || f.Status == "enabled" {
		sql += ` AND active`
	} else if f.Status == "disabled" {
		sql += ` AND NOT active`
	} else if f.Status == "missing-cover" {
		sql += ` AND (cover_key IS NULL OR cover_key = '')`
	}
	if f.TaskType != "" {
		args = append(args, f.TaskType)
		sql += fmt.Sprintf(` AND task_type = $%d`, len(args))
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		sql += fmt.Sprintf(` AND (title ILIKE $%d OR prompt ILIKE $%d)`, len(args), len(args))
	}
	if f.FavoritedBy != uuid.Nil {
		args = append(args, f.FavoritedBy)
		sql += fmt.Sprintf(` AND EXISTS (
			SELECT 1 FROM prompt_user_engagement pue
			WHERE pue.prompt_id = prompt_library.id AND pue.user_id = $%d AND pue.favorited
		)`, len(args))
	}
	if f.CreatedFrom != nil {
		args = append(args, *f.CreatedFrom)
		sql += fmt.Sprintf(` AND created_at >= $%d`, len(args))
	}
	if f.CreatedBefore != nil {
		args = append(args, *f.CreatedBefore)
		sql += fmt.Sprintf(` AND created_at < $%d`, len(args))
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
			tags = $6, sort = $7, like_count = $8, favorite_count = $9, use_count = $10,
			active = $11 WHERE id = $1`,
		p.ID, p.Title, p.Prompt, p.TaskType, p.Category, p.Tags, p.Sort,
		p.LikeCount, p.FavoriteCount, p.UseCount, p.Active)
	return err
}

// ReorderPromptEntries replaces the selected entries in their current global
// slots and then normalizes all sort values. Entries outside the selection keep
// their relative positions, so filtered sorting is safe.
func ReorderPromptEntries(ctx context.Context, q Q, orderedIDs []uuid.UUID) error {
	if len(orderedIDs) == 0 {
		return nil
	}
	rows, err := q.Query(ctx, `SELECT id FROM prompt_library ORDER BY sort ASC, created_at DESC, id DESC FOR UPDATE`)
	if err != nil {
		return err
	}
	allIDs := make([]uuid.UUID, 0, len(orderedIDs))
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		allIDs = append(allIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	selected := make(map[uuid.UUID]bool, len(orderedIDs))
	for _, id := range orderedIDs {
		if selected[id] {
			return fmt.Errorf("duplicate prompt id %s", id)
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
		return fmt.Errorf("one or more prompt ids do not exist")
	}
	for index, slot := range selectedSlots {
		allIDs[slot] = orderedIDs[index]
	}
	_, err = q.Exec(ctx, `UPDATE prompt_library AS prompt
		SET sort = (ordered.position * 10)::integer
		FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
		WHERE prompt.id = ordered.id`, allIDs)
	return err
}

// MovePromptEntry moves one entry to a 1-based position inside a filtered
// scope. Entries outside the scope stay in their original relative slots.
func MovePromptEntry(ctx context.Context, q Q, id uuid.UUID, position int, f PromptFilter) (count int, found bool, err error) {
	sql, args := appendPromptFilter(`SELECT id FROM prompt_library WHERE true`, nil, f)
	sql += ` ORDER BY sort ASC, created_at DESC, id DESC FOR UPDATE`
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return 0, false, err
	}
	ids := make([]uuid.UUID, 0, 128)
	for rows.Next() {
		var current uuid.UUID
		if err := rows.Scan(&current); err != nil {
			rows.Close()
			return 0, false, err
		}
		ids = append(ids, current)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, false, err
	}
	rows.Close()

	currentIndex := -1
	for index, current := range ids {
		if current == id {
			currentIndex = index
			break
		}
	}
	if currentIndex < 0 {
		return len(ids), false, nil
	}
	if position < 1 {
		position = 1
	}
	if position > len(ids) {
		position = len(ids)
	}
	moving := ids[currentIndex]
	ids = append(ids[:currentIndex], ids[currentIndex+1:]...)
	targetIndex := position - 1
	ids = append(ids, uuid.Nil)
	copy(ids[targetIndex+1:], ids[targetIndex:])
	ids[targetIndex] = moving
	if err := ReorderPromptEntries(ctx, q, ids); err != nil {
		return len(ids), true, err
	}
	return len(ids), true, nil
}

func UpdatePromptCoverKey(ctx context.Context, q Q, id uuid.UUID, coverKey string) error {
	_, err := q.Exec(ctx, `UPDATE prompt_library SET cover_key = $2 WHERE id = $1`, id, coverKey)
	return err
}

func DeletePromptEntry(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM prompt_library WHERE id = $1`, id)
	return err
}
