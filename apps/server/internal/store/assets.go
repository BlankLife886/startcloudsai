package store

import (
	"context"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const userAssetCols = `id, user_id, title, file_key, thumbnail_key, content_type, size_bytes, created_at`

func scanUserAsset(row pgx.Row) (*UserAsset, error) {
	var asset UserAsset
	err := row.Scan(&asset.ID, &asset.UserID, &asset.Title, &asset.FileKey, &asset.ThumbnailKey,
		&asset.ContentType, &asset.SizeBytes, &asset.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func InsertUserAsset(ctx context.Context, q Q, userID uuid.UUID, title, fileKey, thumbnailKey, contentType string, sizeBytes int64) (*UserAsset, error) {
	return scanUserAsset(q.QueryRow(ctx,
		`INSERT INTO user_assets (user_id, title, file_key, thumbnail_key, content_type, size_bytes)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+userAssetCols,
		userID, title, fileKey, thumbnailKey, contentType, sizeBytes))
}

func ListUserAssets(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor) ([]*UserAsset, error) {
	args := []any{userID}
	where := `user_id = $1`
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		where += ` AND (created_at, id) < ($2, $3)`
	}
	args = append(args, limit+1)
	rows, err := q.Query(ctx, `SELECT `+userAssetCols+` FROM user_assets WHERE `+where+
		` ORDER BY created_at DESC, id DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserAsset, 0, limit+1)
	for rows.Next() {
		asset, scanErr := scanUserAsset(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, asset)
	}
	return items, rows.Err()
}

func GetUserAsset(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND id = $2`, userID, id))
	return nilOnNoRows(asset, err)
}

func DeleteUserAsset(ctx context.Context, q Q, userID, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1 AND id = $2`, userID, id)
	return err
}

func CountUserAssets(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM user_assets WHERE user_id = $1`, userID).Scan(&count)
	return count, err
}
