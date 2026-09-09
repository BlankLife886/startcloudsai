package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type PromptArchiveItem struct {
	ID            uuid.UUID  `json:"id"`
	Title         string     `json:"title"`
	Prompt        string     `json:"prompt"`
	TaskType      string     `json:"taskType"`
	Category      string     `json:"category"`
	Tags          []string   `json:"tags"`
	CoverKey      string     `json:"coverKey"`
	Sort          int        `json:"sort"`
	Active        bool       `json:"active"`
	SourceID      string     `json:"sourceId"`
	SourceItemKey string     `json:"sourceItemKey"`
	CreatedAt     time.Time  `json:"createdAt"`
	NewUntil      *time.Time `json:"newUntil,omitempty"`
}

func ListPromptArchiveItems(ctx context.Context, q Q) ([]*PromptArchiveItem, error) {
	rows, err := q.Query(ctx, `SELECT id, title, prompt, task_type, COALESCE(category, 'other'),
		tags, COALESCE(cover_key, ''), sort, active, source_id, source_item_key, created_at, new_until
		FROM prompt_library ORDER BY sort ASC, created_at ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*PromptArchiveItem, 0)
	for rows.Next() {
		var item PromptArchiveItem
		if err := rows.Scan(&item.ID, &item.Title, &item.Prompt, &item.TaskType, &item.Category,
			&item.Tags, &item.CoverKey, &item.Sort, &item.Active, &item.SourceID,
			&item.SourceItemKey, &item.CreatedAt, &item.NewUntil); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}
