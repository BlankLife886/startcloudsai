package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Commerce set statuses.
const (
	CommerceSetPlanned    = "planned"
	CommerceSetGenerating = "generating"
	CommerceSetDone       = "done"
	CommerceSetCanceled   = "canceled"
)

// How a generation attempt was approved.
const (
	CommerceApprovedByUser   = "user"
	CommerceApprovedByBudget = "budget"
)

// CommerceSetReview is the vision check of one finished image.
type CommerceSetReview struct {
	Pass      bool      `json:"pass"`
	Issues    []string  `json:"issues,omitempty"`
	CheckedAt time.Time `json:"checkedAt"`
	// Skipped means the image could not be checked (no output, model
	// unavailable); it is neither passed nor failed.
	Skipped bool `json:"skipped,omitempty"`
}

// CommerceSetAttempt is one task generating a shot; redos add attempts.
type CommerceSetAttempt struct {
	TaskID     uuid.UUID          `json:"taskId"`
	Via        string             `json:"via"`
	PriceCents int64              `json:"priceCents"`
	Note       string             `json:"note,omitempty"`
	CreatedAt  time.Time          `json:"createdAt"`
	Review     *CommerceSetReview `json:"review,omitempty"`
}

// CommerceSetShot is one planned image and its attempts.
type CommerceSetShot struct {
	ID          string               `json:"id"`
	TypeID      string               `json:"typeId"`
	Role        string               `json:"role"`
	Label       string               `json:"label"`
	AspectRatio string               `json:"aspectRatio"`
	Headline    string               `json:"headline,omitempty"`
	Subline     string               `json:"subline,omitempty"`
	Direction   string               `json:"direction,omitempty"`
	Attempts    []CommerceSetAttempt `json:"attempts,omitempty"`
}

// CommerceSet is one e-commerce image set planned in the assistant.
type CommerceSet struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	ConversationID *uuid.UUID
	RunID          *uuid.UUID
	Status         string
	Brief          json.RawMessage
	Summary        string
	Shots          []CommerceSetShot
	InputKeys      []string
	ModelID        string
	QuotedCents    int64
	ApprovedCents  int64
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

const commerceSetCols = `id, user_id, conversation_id, run_id, status, brief, summary, shots, input_keys, model_id,
	quoted_cents, approved_cents, created_at, updated_at`

func scanCommerceSet(row pgx.Row) (*CommerceSet, error) {
	var set CommerceSet
	var shots []byte
	if err := row.Scan(&set.ID, &set.UserID, &set.ConversationID, &set.RunID, &set.Status, &set.Brief, &set.Summary,
		&shots, &set.InputKeys, &set.ModelID, &set.QuotedCents, &set.ApprovedCents, &set.CreatedAt, &set.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(shots, &set.Shots); err != nil {
		return nil, err
	}
	return &set, nil
}

// InsertCommerceSet stores a newly planned set.
func InsertCommerceSet(ctx context.Context, q Q, set *CommerceSet) (*CommerceSet, error) {
	shots, err := json.Marshal(set.Shots)
	if err != nil {
		return nil, err
	}
	brief := set.Brief
	if len(brief) == 0 {
		brief = json.RawMessage(`{}`)
	}
	return scanCommerceSet(q.QueryRow(ctx, `INSERT INTO assistant_commerce_sets
		(user_id, conversation_id, run_id, status, brief, summary, shots, input_keys, model_id, quoted_cents)
		VALUES ($1, $2, $3, 'planned', $4, $5, $6, $7, $8, $9) RETURNING `+commerceSetCols,
		set.UserID, set.ConversationID, set.RunID, brief, set.Summary, shots, set.InputKeys, set.ModelID, set.QuotedCents))
}

// GetUserCommerceSet reads one of the user's sets; nil when not theirs.
func GetUserCommerceSet(ctx context.Context, q Q, userID, id uuid.UUID) (*CommerceSet, error) {
	set, err := scanCommerceSet(q.QueryRow(ctx, `SELECT `+commerceSetCols+`
		FROM assistant_commerce_sets WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(set, err)
}

// LockUserCommerceSet reads a set FOR UPDATE inside tx.
func LockUserCommerceSet(ctx context.Context, tx pgx.Tx, userID, id uuid.UUID) (*CommerceSet, error) {
	set, err := scanCommerceSet(tx.QueryRow(ctx, `SELECT `+commerceSetCols+`
		FROM assistant_commerce_sets WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID))
	return nilOnNoRows(set, err)
}

// SaveCommerceSet writes back the mutable fields.
func SaveCommerceSet(ctx context.Context, q Q, set *CommerceSet) error {
	shots, err := json.Marshal(set.Shots)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE assistant_commerce_sets
		SET status = $2, shots = $3, quoted_cents = $4, approved_cents = $5, updated_at = now()
		WHERE id = $1`, set.ID, set.Status, shots, set.QuotedCents, set.ApprovedCents)
	return err
}

// LatestOpenCommerceSet returns the conversation's most recent set that is
// still being planned or generated, so follow-up turns ("开始生成吧") can act
// on it. Sets older than a day are left to the card.
func LatestOpenCommerceSet(ctx context.Context, q Q, userID, conversationID uuid.UUID, now time.Time) (*CommerceSet, error) {
	set, err := scanCommerceSet(q.QueryRow(ctx, `SELECT `+commerceSetCols+`
		FROM assistant_commerce_sets
		WHERE user_id = $1 AND conversation_id = $2 AND status IN ('planned', 'generating') AND created_at > $3
		ORDER BY created_at DESC LIMIT 1`, userID, conversationID, now.Add(-24*time.Hour)))
	return nilOnNoRows(set, err)
}
