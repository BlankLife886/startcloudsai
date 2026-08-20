package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const canvasWorkflowTemplateSeedVersion = 1

//go:embed canvas_workflow_template_defaults.json
var canvasWorkflowTemplateDefaultsJSON []byte

type defaultCanvasWorkflowTemplate struct {
	Slug          string          `json:"slug"`
	Title         string          `json:"title"`
	Category      string          `json:"category"`
	CategoryLabel string          `json:"categoryLabel"`
	Industry      string          `json:"industry"`
	Summary       string          `json:"summary"`
	Platforms     json.RawMessage `json:"platforms"`
	Deliverables  json.RawMessage `json:"deliverables"`
	Accent        string          `json:"accent"`
	Document      json.RawMessage `json:"document"`
	NodeCount     int             `json:"nodeCount"`
	Enabled       bool            `json:"enabled"`
	Sort          int             `json:"sort"`
}

// SeedDefaultCanvasWorkflowTemplates imports the built-in template library once.
// The version marker prevents deleted or edited templates from being restored on restart.
func SeedDefaultCanvasWorkflowTemplates(ctx context.Context, st *Store) (int, error) {
	var defaults []defaultCanvasWorkflowTemplate
	if err := json.Unmarshal(canvasWorkflowTemplateDefaultsJSON, &defaults); err != nil {
		return 0, fmt.Errorf("decode default canvas workflow templates: %w", err)
	}
	if len(defaults) != 41 {
		return 0, fmt.Errorf("decode default canvas workflow templates: got %d entries, want 41", len(defaults))
	}

	inserted := 0
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		marker, err := tx.Exec(ctx, `INSERT INTO canvas_workflow_template_seed_versions (version)
			VALUES ($1) ON CONFLICT (version) DO NOTHING`, canvasWorkflowTemplateSeedVersion)
		if err != nil {
			return err
		}
		if marker.RowsAffected() == 0 {
			return nil
		}

		for _, item := range defaults {
			tag, err := tx.Exec(ctx, `INSERT INTO canvas_workflow_templates
				(slug, title, category, category_label, industry, summary, platforms, deliverables,
				 accent, document, node_count, enabled, sort)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
				ON CONFLICT (slug) DO NOTHING`,
				item.Slug, item.Title, item.Category, item.CategoryLabel, item.Industry, item.Summary,
				item.Platforms, item.Deliverables, item.Accent, item.Document, item.NodeCount, item.Enabled, item.Sort)
			if err != nil {
				return err
			}
			inserted += int(tag.RowsAffected())
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("seed default canvas workflow templates: %w", err)
	}
	return inserted, nil
}
