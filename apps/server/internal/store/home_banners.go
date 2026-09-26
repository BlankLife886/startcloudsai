package store

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

type HomeBanner struct {
	ID         uuid.UUID  `json:"id"`
	Title      string     `json:"title"`
	Subtitle   string     `json:"subtitle"`
	ImageURL   string     `json:"imageUrl"`
	LinkURL    string     `json:"linkUrl"`
	ButtonText string     `json:"buttonText"`
	NewTab     bool       `json:"newTab"`
	Active     bool       `json:"active"`
	SortOrder  int        `json:"sortOrder"`
	DurationMS int        `json:"durationMs"`
	StartsAt   *time.Time `json:"startsAt"`
	EndsAt     *time.Time `json:"endsAt"`
	CreatedAt  time.Time  `json:"createdAt"`
}

const homeBannerCols = `id,title,subtitle,image_url,link_url,button_text,new_tab,active,sort_order,duration_ms,starts_at,ends_at,created_at`

func scanHomeBanner(row pgx.Row) (*HomeBanner, error) {
	var b HomeBanner
	err := row.Scan(&b.ID, &b.Title, &b.Subtitle, &b.ImageURL, &b.LinkURL, &b.ButtonText, &b.NewTab, &b.Active, &b.SortOrder, &b.DurationMS, &b.StartsAt, &b.EndsAt, &b.CreatedAt)
	return &b, err
}

func ListHomeBanners(ctx context.Context, q Q, public bool) ([]*HomeBanner, error) {
	sql := `SELECT ` + homeBannerCols + ` FROM home_banners`
	if public {
		sql += ` WHERE active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`
	}
	sql += ` ORDER BY sort_order ASC, created_at DESC, id ASC`
	rows, err := q.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*HomeBanner, 0)
	for rows.Next() {
		b, err := scanHomeBanner(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func SaveHomeBanner(ctx context.Context, q Q, b *HomeBanner, create bool) (*HomeBanner, error) {
	args := []any{b.ID, b.Title, b.Subtitle, b.ImageURL, b.LinkURL, b.ButtonText, b.NewTab, b.Active, b.SortOrder, b.DurationMS, b.StartsAt, b.EndsAt}
	if create {
		return scanHomeBanner(q.QueryRow(ctx, `INSERT INTO home_banners (id,title,subtitle,image_url,link_url,button_text,new_tab,active,sort_order,duration_ms,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+homeBannerCols, args...))
	}
	return scanHomeBanner(q.QueryRow(ctx, `UPDATE home_banners SET title=$2,subtitle=$3,image_url=$4,link_url=$5,button_text=$6,new_tab=$7,active=$8,sort_order=$9,duration_ms=$10,starts_at=$11,ends_at=$12 WHERE id=$1 RETURNING `+homeBannerCols, args...))
}
