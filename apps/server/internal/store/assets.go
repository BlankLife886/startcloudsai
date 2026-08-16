package store

import (
	"context"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const userAssetCols = `id, user_id, group_id, title, file_key, thumbnail_key, content_type, size_bytes, created_at`
const userAssetGroupCols = `id, user_id, name, sort, created_at, updated_at`

const MaxUserAssetGroups = 50

func LockUserAssetCreation(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 3))`, userID.String())
	return err
}

func LockUserAssetGroupCreation(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 4))`, userID.String())
	return err
}

func scanUserAsset(row pgx.Row) (*UserAsset, error) {
	var asset UserAsset
	err := row.Scan(&asset.ID, &asset.UserID, &asset.GroupID, &asset.Title, &asset.FileKey, &asset.ThumbnailKey,
		&asset.ContentType, &asset.SizeBytes, &asset.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func scanUserAssetGroup(row pgx.Row) (*UserAssetGroup, error) {
	var group UserAssetGroup
	err := row.Scan(&group.ID, &group.UserID, &group.Name, &group.Sort, &group.CreatedAt, &group.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &group, nil
}

func InsertUserAsset(ctx context.Context, q Q, userID uuid.UUID, title, fileKey, thumbnailKey, contentType string, sizeBytes int64, groupID *uuid.UUID) (*UserAsset, error) {
	return scanUserAsset(q.QueryRow(ctx,
		`INSERT INTO user_assets (user_id, group_id, title, file_key, thumbnail_key, content_type, size_bytes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+userAssetCols,
		userID, groupID, title, fileKey, thumbnailKey, contentType, sizeBytes))
}

// ListUserAssets 支持 groupFilter：
//   - nil：全部
//   - &uuid.Nil：未分组（group_id IS NULL）
//   - 其他 uuid：指定分组
func ListUserAssets(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor, groupFilter *uuid.UUID) ([]*UserAsset, error) {
	args := []any{userID}
	where := `user_id = $1`
	if groupFilter != nil {
		if *groupFilter == uuid.Nil {
			where += ` AND group_id IS NULL`
		} else {
			args = append(args, *groupFilter)
			where += ` AND group_id = $` + strconv.Itoa(len(args))
		}
	}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		where += ` AND (created_at, id) < ($` + strconv.Itoa(len(args)-1) + `, $` + strconv.Itoa(len(args)) + `)`
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

func GetUserAssetByFileKey(ctx context.Context, q Q, userID uuid.UUID, fileKey string) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND file_key = $2`,
		userID, fileKey))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return asset, err
}

func GetUserAssetForUpdate(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, id))
	return nilOnNoRows(asset, err)
}

func GetUserAssetsByIDs(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID) ([]*UserAsset, error) {
	return getUserAssetsByIDs(ctx, q, userID, ids, "")
}

// GetUserAssetsByIDsForShare keeps referenced assets alive while a product
// transaction validates and stores their IDs.
func GetUserAssetsByIDsForShare(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID) ([]*UserAsset, error) {
	return getUserAssetsByIDs(ctx, q, userID, ids, " FOR SHARE")
}

func getUserAssetsByIDs(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID, lockClause string) ([]*UserAsset, error) {
	if len(ids) == 0 {
		return []*UserAsset{}, nil
	}
	rows, err := q.Query(ctx,
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND id = ANY($2::uuid[])`+lockClause, userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserAsset, 0, len(ids))
	for rows.Next() {
		asset, scanErr := scanUserAsset(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, asset)
	}
	return items, rows.Err()
}

func UpdateUserAsset(ctx context.Context, q Q, userID, id uuid.UUID, title string, groupID *uuid.UUID) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`UPDATE user_assets SET title = $3, group_id = $4
		 WHERE user_id = $1 AND id = $2
		 RETURNING `+userAssetCols,
		userID, id, title, groupID))
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

func CountUserAssetsUngrouped(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM user_assets WHERE user_id = $1 AND group_id IS NULL`, userID).Scan(&count)
	return count, err
}

func CountUserAssetGroups(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM user_asset_groups WHERE user_id = $1`, userID).Scan(&count)
	return count, err
}

func InsertUserAssetGroup(ctx context.Context, q Q, userID uuid.UUID, name string, sort int) (*UserAssetGroup, error) {
	return scanUserAssetGroup(q.QueryRow(ctx,
		`INSERT INTO user_asset_groups (user_id, name, sort)
		 VALUES ($1, $2, $3) RETURNING `+userAssetGroupCols,
		userID, name, sort))
}

func ListUserAssetGroups(ctx context.Context, q Q, userID uuid.UUID) ([]*UserAssetGroup, error) {
	rows, err := q.Query(ctx,
		`SELECT g.id, g.user_id, g.name, g.sort, g.created_at, g.updated_at,
		        COALESCE((SELECT count(*) FROM user_assets a WHERE a.user_id = g.user_id AND a.group_id = g.id), 0) AS asset_count
		 FROM user_asset_groups g
		 WHERE g.user_id = $1
		 ORDER BY g.sort ASC, g.created_at ASC, g.id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserAssetGroup, 0, 16)
	for rows.Next() {
		var group UserAssetGroup
		if scanErr := rows.Scan(&group.ID, &group.UserID, &group.Name, &group.Sort, &group.CreatedAt, &group.UpdatedAt, &group.AssetCount); scanErr != nil {
			return nil, scanErr
		}
		items = append(items, &group)
	}
	return items, rows.Err()
}

func GetUserAssetGroup(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAssetGroup, error) {
	group, err := scanUserAssetGroup(q.QueryRow(ctx,
		`SELECT `+userAssetGroupCols+` FROM user_asset_groups WHERE user_id = $1 AND id = $2`, userID, id))
	return nilOnNoRows(group, err)
}

func GetUserAssetGroupForUpdate(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAssetGroup, error) {
	group, err := scanUserAssetGroup(q.QueryRow(ctx,
		`SELECT `+userAssetGroupCols+` FROM user_asset_groups WHERE user_id = $1 AND id = $2 FOR UPDATE`, userID, id))
	return nilOnNoRows(group, err)
}

func GetUserAssetGroupForShare(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAssetGroup, error) {
	group, err := scanUserAssetGroup(q.QueryRow(ctx,
		`SELECT `+userAssetGroupCols+` FROM user_asset_groups WHERE user_id = $1 AND id = $2 FOR SHARE`, userID, id))
	return nilOnNoRows(group, err)
}

func UpdateUserAssetGroup(ctx context.Context, q Q, userID, id uuid.UUID, name string, sort int) (*UserAssetGroup, error) {
	group, err := scanUserAssetGroup(q.QueryRow(ctx,
		`UPDATE user_asset_groups SET name = $3, sort = $4, updated_at = now()
		 WHERE user_id = $1 AND id = $2
		 RETURNING `+userAssetGroupCols,
		userID, id, name, sort))
	return nilOnNoRows(group, err)
}

func DeleteUserAssetGroup(ctx context.Context, q Q, userID, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM user_asset_groups WHERE user_id = $1 AND id = $2`, userID, id)
	return err
}

func NormalizeAssetGroupName(raw string) string {
	return strings.TrimSpace(raw)
}
