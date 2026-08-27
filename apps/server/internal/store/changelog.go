package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const changelogCols = `id, version, date, tag, title, summary, items, highlight, sort, created_at, source_key`

func scanChangelog(row pgx.Row) (*ChangelogEntry, error) {
	var c ChangelogEntry
	err := row.Scan(&c.ID, &c.Version, &c.Date, &c.Tag, &c.Title, &c.Summary, &c.Items, &c.Highlight, &c.Sort, &c.CreatedAt, &c.SourceKey)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func InsertChangelog(ctx context.Context, q Q, c *ChangelogEntry) (*ChangelogEntry, error) {
	if c.Items == nil {
		c.Items = []string{}
	}
	return scanChangelog(q.QueryRow(ctx,
		`INSERT INTO changelog_entries (version, date, tag, title, summary, items, highlight, sort)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+changelogCols,
		c.Version, c.Date, c.Tag, c.Title, c.Summary, c.Items, c.Highlight, c.Sort))
}

func GetChangelog(ctx context.Context, q Q, id uuid.UUID) (*ChangelogEntry, error) {
	c, err := scanChangelog(q.QueryRow(ctx, `SELECT `+changelogCols+` FROM changelog_entries WHERE id = $1`, id))
	return nilOnNoRows(c, err)
}

func GetChangelogByIdentity(ctx context.Context, q Q, version string, date time.Time, title string) (*ChangelogEntry, error) {
	c, err := scanChangelog(q.QueryRow(ctx,
		`SELECT `+changelogCols+` FROM changelog_entries
		 WHERE version = $1 AND date = $2 AND title = $3
		 ORDER BY created_at DESC LIMIT 1`, version, date, title))
	return nilOnNoRows(c, err)
}

func UpdateChangelog(ctx context.Context, q Q, c *ChangelogEntry) error {
	_, err := q.Exec(ctx,
		`UPDATE changelog_entries SET version = $2, date = $3, tag = $4, title = $5, summary = $6,
		 items = $7, highlight = $8, sort = $9 WHERE id = $1`,
		c.ID, c.Version, c.Date, c.Tag, c.Title, c.Summary, c.Items, c.Highlight, c.Sort)
	return err
}

func DeleteChangelog(ctx context.Context, q Q, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM changelog_entries WHERE id = $1`, id)
	return err
}

func ListChangelog(ctx context.Context, q Q) ([]*ChangelogEntry, error) {
	rows, err := q.Query(ctx,
		`SELECT `+changelogCols+` FROM changelog_entries ORDER BY date DESC, sort DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ChangelogEntry
	for rows.Next() {
		c, err := scanChangelog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// LatestChangelog 最近发布的一条，供用户端判断是否需要刷新。
func LatestChangelog(ctx context.Context, q Q) (*ChangelogEntry, error) {
	c, err := scanChangelog(q.QueryRow(ctx,
		`SELECT `+changelogCols+` FROM changelog_entries
		 ORDER BY created_at DESC, date DESC, sort DESC LIMIT 1`))
	return nilOnNoRows(c, err)
}

func ClearOtherChangelogHighlights(ctx context.Context, q Q, keepID uuid.UUID) error {
	_, err := q.Exec(ctx,
		`UPDATE changelog_entries SET highlight = false WHERE id <> $1 AND highlight = true`, keepID)
	return err
}
