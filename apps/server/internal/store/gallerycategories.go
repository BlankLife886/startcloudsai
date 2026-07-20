package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const galleryCategoryCols = `id, name, sort, active, created_at`

func scanGalleryCategory(row pgx.Row) (*GalleryCategory, error) {
	var c GalleryCategory
	if err := row.Scan(&c.ID, &c.Name, &c.Sort, &c.Active, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

func InsertGalleryCategory(ctx context.Context, q Q, name string, sort int, active bool) (*GalleryCategory, error) {
	return scanGalleryCategory(q.QueryRow(ctx,
		`INSERT INTO gallery_categories (name, sort, active) VALUES ($1, $2, $3) RETURNING `+galleryCategoryCols,
		name, sort, active))
}

func GetGalleryCategory(ctx context.Context, q Q, id uuid.UUID) (*GalleryCategory, error) {
	c, err := scanGalleryCategory(q.QueryRow(ctx,
		`SELECT `+galleryCategoryCols+` FROM gallery_categories WHERE id = $1`, id))
	return nilOnNoRows(c, err)
}

// ListGalleryCategories activeOnly=true 仅返回启用分类；按 sort、created_at 升序。
func ListGalleryCategories(ctx context.Context, q Q, activeOnly bool) ([]*GalleryCategory, error) {
	sql := `SELECT ` + galleryCategoryCols + ` FROM gallery_categories`
	if activeOnly {
		sql += ` WHERE active`
	}
	sql += ` ORDER BY sort ASC, created_at ASC`
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*GalleryCategory
	for rows.Next() {
		c, err := scanGalleryCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func UpdateGalleryCategory(ctx context.Context, q Q, c *GalleryCategory) error {
	_, err := q.Exec(ctx,
		`UPDATE gallery_categories SET name = $2, sort = $3, active = $4 WHERE id = $1`,
		c.ID, c.Name, c.Sort, c.Active)
	return err
}

// DeleteGalleryCategory 删除分类；投稿的 category_id 由外键 ON DELETE SET NULL 置空。
func DeleteGalleryCategory(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM gallery_categories WHERE id = $1`, id)
	return err
}
