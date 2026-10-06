package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// CompetitorRef is a competitor's style the assistant read from screenshots
// the user uploaded. ImageKeys are the screenshots; they are analysed, never
// handed to the image model.
type CompetitorRef struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	ConversationID *uuid.UUID
	ImageKeys      []string
	Style          json.RawMessage
	CreatedAt      time.Time
}

const competitorRefCols = `id, user_id, conversation_id, image_keys, style, created_at`

func scanCompetitorRef(row interface{ Scan(...any) error }) (*CompetitorRef, error) {
	var ref CompetitorRef
	if err := row.Scan(&ref.ID, &ref.UserID, &ref.ConversationID, &ref.ImageKeys, &ref.Style, &ref.CreatedAt); err != nil {
		return nil, err
	}
	return &ref, nil
}

func InsertCompetitorRef(ctx context.Context, q Q, ref *CompetitorRef) (*CompetitorRef, error) {
	if ref.ImageKeys == nil {
		ref.ImageKeys = []string{}
	}
	return scanCompetitorRef(q.QueryRow(ctx, `INSERT INTO assistant_competitor_refs (user_id, conversation_id, image_keys, style)
		VALUES ($1, $2, $3, $4) RETURNING `+competitorRefCols, ref.UserID, ref.ConversationID, ref.ImageKeys, ref.Style))
}

func GetUserCompetitorRef(ctx context.Context, q Q, userID, id uuid.UUID) (*CompetitorRef, error) {
	ref, err := scanCompetitorRef(q.QueryRow(ctx, `SELECT `+competitorRefCols+`
		FROM assistant_competitor_refs WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(ref, err)
}

// LatestCompetitorRef is the conversation's most recent competitor analysis.
func LatestCompetitorRef(ctx context.Context, q Q, userID, conversationID uuid.UUID) (*CompetitorRef, error) {
	ref, err := scanCompetitorRef(q.QueryRow(ctx, `SELECT `+competitorRefCols+`
		FROM assistant_competitor_refs WHERE user_id = $1 AND conversation_id = $2
		ORDER BY created_at DESC LIMIT 1`, userID, conversationID))
	return nilOnNoRows(ref, err)
}

// ConversationCompetitorKeys lists every competitor screenshot analysed in a
// conversation; they must never be used as product references there.
func ConversationCompetitorKeys(ctx context.Context, q Q, userID, conversationID uuid.UUID) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT unnest(image_keys) FROM assistant_competitor_refs
		WHERE user_id = $1 AND conversation_id = $2`, userID, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}
