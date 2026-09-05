package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const changelogSeedVersion = 3

//go:embed changelog_defaults.json
var changelogDefaultsJSON []byte

type defaultChangelogEntry struct {
	SourceKey string   `json:"sourceKey"`
	Version   string   `json:"version"`
	Date      string   `json:"date"`
	Tag       string   `json:"tag"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary"`
	Items     []string `json:"items"`
	Highlight bool     `json:"highlight"`
	Sort      int      `json:"sort"`
}

// SeedDefaultChangelogEntries imports the historical /updates log once.
// The version marker prevents deleted or edited entries from being restored on restart.
func SeedDefaultChangelogEntries(ctx context.Context, st *Store) (int, error) {
	var defaults []defaultChangelogEntry
	if err := json.Unmarshal(changelogDefaultsJSON, &defaults); err != nil {
		return 0, fmt.Errorf("decode default changelog entries: %w", err)
	}
	if len(defaults) != 96 {
		return 0, fmt.Errorf("decode default changelog entries: got %d entries, want 96", len(defaults))
	}

	inserted := 0
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		var existing int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM changelog_entries`).Scan(&existing); err != nil {
			return err
		}
		marker, err := tx.Exec(ctx, `INSERT INTO changelog_seed_versions (version)
			VALUES ($1) ON CONFLICT (version) DO NOTHING`, changelogSeedVersion)
		if err != nil {
			return err
		}
		if marker.RowsAffected() == 0 && existing > 0 {
			return nil
		}

		for _, item := range defaults {
			date, err := time.Parse("2006-01-02", item.Date)
			if err != nil {
				return fmt.Errorf("changelog %s date: %w", item.SourceKey, err)
			}
			if item.Items == nil {
				item.Items = []string{}
			}
			var summary *string
			if trimmed := strings.TrimSpace(item.Summary); trimmed != "" {
				summary = &trimmed
			}
			publishedDay := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0,
				time.FixedZone("Asia/Shanghai", 8*60*60))
			createdAt := publishedDay.UTC().Add(time.Duration(item.Sort) * time.Millisecond)
			tag, err := tx.Exec(ctx, `INSERT INTO changelog_entries
				(source_key, version, date, tag, title, summary, items, highlight, sort, created_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
				ON CONFLICT (source_key) DO NOTHING`,
				item.SourceKey, item.Version, date, item.Tag, item.Title, summary, item.Items,
				item.Highlight, item.Sort, createdAt)
			if err != nil {
				return err
			}
			inserted += int(tag.RowsAffected())
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("seed default changelog entries: %w", err)
	}
	return inserted, nil
}
