package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const ecommerceAssetReviewCols = `id,user_id,task_id,status,checklist,note,channel,reviewed_at,created_at,updated_at`

func scanEcommerceAssetReview(row pgx.Row) (*EcommerceAssetReview, error) {
	review := &EcommerceAssetReview{}
	var checklist []byte
	err := row.Scan(
		&review.ID,
		&review.UserID,
		&review.TaskID,
		&review.Status,
		&checklist,
		&review.Note,
		&review.Channel,
		&review.ReviewedAt,
		&review.CreatedAt,
		&review.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	review.Checklist = scanJSONMap(checklist)
	return review, nil
}

func ListEcommerceAssetReviews(ctx context.Context, q Q, userID uuid.UUID, status string, limit int) ([]*EcommerceAssetReview, error) {
	var rows pgx.Rows
	var err error
	if status == "" {
		rows, err = q.Query(ctx, `SELECT `+ecommerceAssetReviewCols+` FROM ecommerce_asset_reviews WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2`, userID, limit)
	} else {
		rows, err = q.Query(ctx, `SELECT `+ecommerceAssetReviewCols+` FROM ecommerce_asset_reviews WHERE user_id=$1 AND status=$2 ORDER BY updated_at DESC,id DESC LIMIT $3`, userID, status, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]*EcommerceAssetReview, 0)
	for rows.Next() {
		review, err := scanEcommerceAssetReview(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, review)
	}
	return result, rows.Err()
}

func UpsertEcommerceAssetReview(ctx context.Context, q Q, review *EcommerceAssetReview) error {
	if review.ID == uuid.Nil {
		review.ID = uuid.New()
	}
	var checklist []byte
	err := q.QueryRow(ctx, `
		INSERT INTO ecommerce_asset_reviews
			(id,user_id,task_id,status,checklist,note,channel,reviewed_at)
		VALUES
			($1,$2,$3,$4,$5,$6,$7,CASE WHEN $4='pending' THEN NULL ELSE now() END)
		ON CONFLICT (user_id,task_id) DO UPDATE SET
			status=EXCLUDED.status,
			checklist=EXCLUDED.checklist,
			note=EXCLUDED.note,
			channel=EXCLUDED.channel,
			reviewed_at=CASE WHEN EXCLUDED.status='pending' THEN NULL ELSE now() END,
			updated_at=now()
		RETURNING `+ecommerceAssetReviewCols,
		review.ID,
		review.UserID,
		review.TaskID,
		review.Status,
		jsonMap(review.Checklist),
		review.Note,
		review.Channel,
	).Scan(
		&review.ID,
		&review.UserID,
		&review.TaskID,
		&review.Status,
		&checklist,
		&review.Note,
		&review.Channel,
		&review.ReviewedAt,
		&review.CreatedAt,
		&review.UpdatedAt,
	)
	if err != nil {
		return err
	}
	review.Checklist = scanJSONMap(checklist)
	return nil
}
