package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CanvasProject struct {
	ID        uuid.UUID       `json:"id"`
	UserID    uuid.UUID       `json:"userId"`
	Title     string          `json:"title"`
	Document  json.RawMessage `json:"document"`
	Revision  int64           `json:"revision"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type CanvasProjectSummary struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	Revision  int64     `json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const canvasProjectCols = `id, user_id, title, document, revision, created_at, updated_at`

func scanCanvasProject(row pgx.Row) (*CanvasProject, error) {
	var item CanvasProject
	if err := row.Scan(&item.ID, &item.UserID, &item.Title, &item.Document, &item.Revision, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func InsertCanvasProject(ctx context.Context, q Q, userID uuid.UUID, title string, document json.RawMessage) (*CanvasProject, error) {
	return InsertCanvasProjectWithID(ctx, q, userID, nil, title, document)
}

func InsertCanvasProjectWithID(ctx context.Context, q Q, userID uuid.UUID, id *uuid.UUID, title string, document json.RawMessage) (*CanvasProject, error) {
	if id == nil {
		return scanCanvasProject(q.QueryRow(ctx,
			`INSERT INTO canvas_projects (user_id, title, document) VALUES ($1, $2, $3) RETURNING `+canvasProjectCols,
			userID, title, document))
	}
	item, err := scanCanvasProject(q.QueryRow(ctx,
		`INSERT INTO canvas_projects (id, user_id, title, document) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, document = EXCLUDED.document,
		 revision = canvas_projects.revision + 1, updated_at = now()
		 WHERE canvas_projects.user_id = EXCLUDED.user_id RETURNING `+canvasProjectCols,
		*id, userID, title, document))
	return nilOnNoRows(item, err)
}

func GetUserCanvasProject(ctx context.Context, q Q, userID, id uuid.UUID) (*CanvasProject, error) {
	item, err := scanCanvasProject(q.QueryRow(ctx,
		`SELECT `+canvasProjectCols+` FROM canvas_projects WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(item, err)
}

func ListUserCanvasProjects(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]*CanvasProjectSummary, error) {
	rows, err := q.Query(ctx, `SELECT id, title, revision, created_at, updated_at
		FROM canvas_projects WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*CanvasProjectSummary, 0)
	for rows.Next() {
		var item CanvasProjectSummary
		if err := rows.Scan(&item.ID, &item.Title, &item.Revision, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, &item)
	}
	return items, rows.Err()
}

func UpdateUserCanvasProject(ctx context.Context, q Q, userID, id uuid.UUID, title string, document json.RawMessage, expectedRevision int64) (*CanvasProject, error) {
	item, err := scanCanvasProject(q.QueryRow(ctx, `UPDATE canvas_projects
		SET title = $3, document = $4, revision = revision + 1, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND revision = $5 RETURNING `+canvasProjectCols,
		id, userID, title, document, expectedRevision))
	return nilOnNoRows(item, err)
}

func DeleteUserCanvasProject(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM canvas_projects WHERE id = $1 AND user_id = $2`, id, userID)
	return tag.RowsAffected() > 0, err
}
