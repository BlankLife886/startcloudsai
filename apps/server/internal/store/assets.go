package store

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const userAssetCols = `id, user_id, group_id, title, file_key, thumbnail_key, content_type, size_bytes,
	tags, content_hash, source_type, source_id, source_metadata, parent_asset_id, deleted_at, updated_at, created_at`
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
		&asset.ContentType, &asset.SizeBytes, &asset.Tags, &asset.ContentHash, &asset.SourceType, &asset.SourceID,
		&asset.SourceMetadata, &asset.ParentAssetID, &asset.DeletedAt, &asset.UpdatedAt, &asset.CreatedAt)
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
	return InsertUserAssetDAM(ctx, q, userID, title, fileKey, thumbnailKey, contentType, sizeBytes, groupID, nil, "", "upload", nil, json.RawMessage(`{}`), nil)
}

func InsertUserAssetDAM(ctx context.Context, q Q, userID uuid.UUID, title, fileKey, thumbnailKey, contentType string, sizeBytes int64, groupID *uuid.UUID, tags []string, contentHash, sourceType string, sourceID *string, sourceMetadata json.RawMessage, parentAssetID *uuid.UUID) (*UserAsset, error) {
	if tags == nil {
		tags = []string{}
	}
	if len(sourceMetadata) == 0 {
		sourceMetadata = json.RawMessage(`{}`)
	}
	return scanUserAsset(q.QueryRow(ctx,
		`INSERT INTO user_assets (user_id, group_id, title, file_key, thumbnail_key, content_type, size_bytes, tags, content_hash, source_type, source_id, source_metadata, parent_asset_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10, $11, $12, $13) RETURNING `+userAssetCols,
		userID, groupID, title, fileKey, thumbnailKey, contentType, sizeBytes, tags, contentHash, sourceType, sourceID, sourceMetadata, parentAssetID))
}

type UserAssetListOptions struct {
	Limit       int
	Cursor      *Cursor
	GroupFilter *uuid.UUID
	Query       string
	Tags        []string
	Trash       bool
}

// ListUserAssets 支持 groupFilter：
//   - nil：全部
//   - &uuid.Nil：未分组（group_id IS NULL）
//   - 其他 uuid：指定分组
func ListUserAssets(ctx context.Context, q Q, userID uuid.UUID, limit int, cursor *Cursor, groupFilter *uuid.UUID) ([]*UserAsset, error) {
	return ListUserAssetsDAM(ctx, q, userID, UserAssetListOptions{Limit: limit, Cursor: cursor, GroupFilter: groupFilter})
}

func ListUserAssetsDAM(ctx context.Context, q Q, userID uuid.UUID, options UserAssetListOptions) ([]*UserAsset, error) {
	limit, cursor, groupFilter := options.Limit, options.Cursor, options.GroupFilter
	args := []any{userID}
	where := `user_id = $1`
	if options.Trash {
		where += ` AND deleted_at IS NOT NULL`
	} else {
		where += ` AND deleted_at IS NULL`
	}
	if groupFilter != nil {
		if *groupFilter == uuid.Nil {
			where += ` AND group_id IS NULL`
		} else {
			args = append(args, *groupFilter)
			where += ` AND group_id = $` + strconv.Itoa(len(args))
		}
	}
	if query := strings.TrimSpace(options.Query); query != "" {
		args = append(args, "%"+query+"%")
		placeholder := `$` + strconv.Itoa(len(args))
		where += ` AND (title ILIKE ` + placeholder + ` OR source_type ILIKE ` + placeholder +
			` OR array_to_string(tags, ' ') ILIKE ` + placeholder +
			` OR EXISTS (SELECT 1 FROM user_asset_groups g WHERE g.id = user_assets.group_id AND g.user_id = user_assets.user_id AND g.name ILIKE ` + placeholder + `))`
	}
	if len(options.Tags) > 0 {
		args = append(args, options.Tags)
		where += ` AND tags @> $` + strconv.Itoa(len(args)) + `::text[]`
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
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`, userID, id))
	return nilOnNoRows(asset, err)
}

func GetUserAssetByFileKey(ctx context.Context, q Q, userID uuid.UUID, fileKey string) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND file_key = $2 AND deleted_at IS NULL`,
		userID, fileKey))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return asset, err
}

func GetUserAssetByContentHash(ctx context.Context, q Q, userID uuid.UUID, contentHash string) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND content_hash = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
		userID, contentHash))
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
		`SELECT `+userAssetCols+` FROM user_assets WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`+lockClause, userID, ids)
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

func UpdateUserAsset(ctx context.Context, q Q, userID, id uuid.UUID, title string, groupID *uuid.UUID, tags []string) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx,
		`UPDATE user_assets SET title = $3, group_id = $4, tags = $5, updated_at = now()
		 WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
		 RETURNING `+userAssetCols,
		userID, id, title, groupID, tags))
	return nilOnNoRows(asset, err)
}

func DeleteUserAsset(ctx context.Context, q Q, userID, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE user_assets SET deleted_at = now(), updated_at = now() WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`, userID, id)
	return err
}

func RestoreUserAsset(ctx context.Context, q Q, userID, id uuid.UUID) (*UserAsset, error) {
	asset, err := scanUserAsset(q.QueryRow(ctx, `UPDATE user_assets SET deleted_at = NULL, updated_at = now()
		WHERE user_id = $1 AND id = $2 AND deleted_at IS NOT NULL RETURNING `+userAssetCols, userID, id))
	return nilOnNoRows(asset, err)
}

func PermanentlyDeleteUserAsset(ctx context.Context, q Q, userID, id uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1 AND id = $2`, userID, id)
	return err
}

func BatchUpdateUserAssets(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID, groupSet bool, groupID *uuid.UUID, addTags, removeTags []string) (int64, error) {
	command, err := q.Exec(ctx, `UPDATE user_assets SET group_id = CASE WHEN $3 THEN $4 ELSE group_id END,
		tags = ARRAY(SELECT DISTINCT value FROM unnest(tags || $5::text[]) value WHERE NOT (value = ANY($6::text[]))),
		updated_at = now()
		WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`, userID, ids, groupSet, groupID, addTags, removeTags)
	return command.RowsAffected(), err
}

func BatchTrashUserAssets(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID) (int64, error) {
	command, err := q.Exec(ctx, `UPDATE user_assets SET deleted_at = now(), updated_at = now()
		WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`, userID, ids)
	return command.RowsAffected(), err
}

func BatchRestoreUserAssets(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID) (int64, error) {
	command, err := q.Exec(ctx, `UPDATE user_assets SET deleted_at = NULL, updated_at = now()
		WHERE user_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NOT NULL`, userID, ids)
	return command.RowsAffected(), err
}

func ListExpiredTrashedUserAssets(ctx context.Context, q Q, before time.Time, limit int) ([]*UserAsset, error) {
	rows, err := q.Query(ctx, `SELECT `+userAssetCols+` FROM user_assets WHERE deleted_at < $1 ORDER BY deleted_at ASC LIMIT $2`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*UserAsset, 0, limit)
	for rows.Next() {
		item, scanErr := scanUserAsset(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CountUserAssets(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM user_assets WHERE user_id = $1 AND deleted_at IS NULL`, userID).Scan(&count)
	return count, err
}

func CountUserAssetsUngrouped(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM user_assets WHERE user_id = $1 AND group_id IS NULL AND deleted_at IS NULL`, userID).Scan(&count)
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
		        COALESCE((SELECT count(*) FROM user_assets a WHERE a.user_id = g.user_id AND a.group_id = g.id AND a.deleted_at IS NULL), 0) AS asset_count
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
