package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CanvasWorkflowTemplate struct {
	ID            uuid.UUID       `json:"id"`
	Slug          string          `json:"slug"`
	Title         string          `json:"title"`
	Category      string          `json:"category"`
	CategoryLabel string          `json:"categoryLabel"`
	Industry      string          `json:"industry"`
	Summary       string          `json:"summary"`
	Platforms     json.RawMessage `json:"platforms"`
	Deliverables  json.RawMessage `json:"deliverables"`
	Accent        string          `json:"accent"`
	CoverKey      string          `json:"coverKey"`
	Document      json.RawMessage `json:"document,omitempty"`
	NodeCount     int             `json:"nodeCount"`
	Enabled       bool            `json:"enabled"`
	Sort          int             `json:"sort"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

const canvasWorkflowTemplateCols = `id, slug, title, category, category_label, industry, summary,
	platforms, deliverables, accent, cover_key, document, node_count, enabled, sort, created_at, updated_at`

const canvasWorkflowTemplateSummaryCols = `id, slug, title, category, category_label, industry, summary,
	platforms, deliverables, accent, cover_key, 'null'::jsonb, node_count, enabled, sort, created_at, updated_at`

func scanCanvasWorkflowTemplate(row pgx.Row) (*CanvasWorkflowTemplate, error) {
	var item CanvasWorkflowTemplate
	if err := row.Scan(&item.ID, &item.Slug, &item.Title, &item.Category, &item.CategoryLabel, &item.Industry,
		&item.Summary, &item.Platforms, &item.Deliverables, &item.Accent, &item.CoverKey, &item.Document, &item.NodeCount,
		&item.Enabled, &item.Sort, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func ListCanvasWorkflowTemplates(ctx context.Context, q Q, includeDisabled bool) ([]*CanvasWorkflowTemplate, error) {
	query := `SELECT ` + canvasWorkflowTemplateSummaryCols + ` FROM canvas_workflow_templates`
	if !includeDisabled {
		query += ` WHERE enabled = true`
	}
	query += ` ORDER BY sort ASC, created_at DESC`
	rows, err := q.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*CanvasWorkflowTemplate, 0)
	for rows.Next() {
		item, err := scanCanvasWorkflowTemplate(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetCanvasWorkflowTemplate(ctx context.Context, q Q, id uuid.UUID, publicOnly bool) (*CanvasWorkflowTemplate, error) {
	query := `SELECT ` + canvasWorkflowTemplateCols + ` FROM canvas_workflow_templates WHERE id = $1`
	if publicOnly {
		query += ` AND enabled = true`
	}
	item, err := scanCanvasWorkflowTemplate(q.QueryRow(ctx, query, id))
	return nilOnNoRows(item, err)
}

func CreateCanvasWorkflowTemplate(ctx context.Context, q Q, item *CanvasWorkflowTemplate) (*CanvasWorkflowTemplate, error) {
	return scanCanvasWorkflowTemplate(q.QueryRow(ctx, `INSERT INTO canvas_workflow_templates
		(slug, title, category, category_label, industry, summary, platforms, deliverables, accent, document, node_count, enabled, sort)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING `+canvasWorkflowTemplateCols,
		item.Slug, item.Title, item.Category, item.CategoryLabel, item.Industry, item.Summary,
		item.Platforms, item.Deliverables, item.Accent, item.Document, item.NodeCount, item.Enabled, item.Sort))
}

type CanvasWorkflowTemplatePatch struct {
	Slug          *string
	Title         *string
	Category      *string
	CategoryLabel *string
	Industry      *string
	Summary       *string
	Platforms     json.RawMessage
	Deliverables  json.RawMessage
	Accent        *string
	Document      json.RawMessage
	NodeCount     *int
	Enabled       *bool
	Sort          *int
}

func UpdateCanvasWorkflowTemplate(ctx context.Context, q Q, id uuid.UUID, patch CanvasWorkflowTemplatePatch) (*CanvasWorkflowTemplate, error) {
	return scanCanvasWorkflowTemplate(q.QueryRow(ctx, `UPDATE canvas_workflow_templates SET
		slug = COALESCE($2, slug), title = COALESCE($3, title), category = COALESCE($4, category),
		category_label = COALESCE($5, category_label), industry = COALESCE($6, industry), summary = COALESCE($7, summary),
		platforms = COALESCE($8::jsonb, platforms), deliverables = COALESCE($9::jsonb, deliverables), accent = COALESCE($10, accent),
		document = COALESCE($11::jsonb, document), node_count = COALESCE($12, node_count), enabled = COALESCE($13, enabled),
		sort = COALESCE($14, sort), updated_at = now()
		WHERE id = $1 RETURNING `+canvasWorkflowTemplateCols,
		id, patch.Slug, patch.Title, patch.Category, patch.CategoryLabel, patch.Industry, patch.Summary,
		patch.Platforms, patch.Deliverables, patch.Accent, patch.Document, patch.NodeCount, patch.Enabled, patch.Sort))
}

func UpdateCanvasWorkflowTemplateCover(ctx context.Context, q Q, id uuid.UUID, coverKey string) (*CanvasWorkflowTemplate, error) {
	return scanCanvasWorkflowTemplate(q.QueryRow(ctx, `UPDATE canvas_workflow_templates
		SET cover_key = $2, updated_at = now()
		WHERE id = $1 RETURNING `+canvasWorkflowTemplateCols, id, coverKey))
}

func DeleteCanvasWorkflowTemplate(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM canvas_workflow_templates WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

// ReorderCanvasWorkflowTemplates replaces the selected templates in their
// current sort slots and then normalizes sort values. Items outside the
// selection keep their relative positions, so category-filtered sorting is safe.
func ReorderCanvasWorkflowTemplates(ctx context.Context, q Q, orderedIDs []uuid.UUID) error {
	if len(orderedIDs) == 0 {
		return nil
	}
	rows, err := q.Query(ctx, `SELECT id FROM canvas_workflow_templates ORDER BY sort ASC, created_at DESC, id DESC FOR UPDATE`)
	if err != nil {
		return err
	}
	allIDs := make([]uuid.UUID, 0, len(orderedIDs))
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
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
			return fmt.Errorf("duplicate canvas template id %s", id)
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
		return fmt.Errorf("one or more canvas template ids do not exist")
	}
	next := append([]uuid.UUID(nil), allIDs...)
	for index, slot := range selectedSlots {
		next[slot] = orderedIDs[index]
	}
	_, err = q.Exec(ctx, `UPDATE canvas_workflow_templates AS template
		SET sort = (ordered.position * 10)::integer, updated_at = now()
		FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
		WHERE template.id = ordered.id`, next)
	return err
}
