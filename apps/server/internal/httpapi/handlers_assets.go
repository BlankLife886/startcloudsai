package httpapi

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const maxUserAssets = 200

const maxUserAssetImageBytes = 10 << 20

type createUserAssetIn struct {
	Title          string          `json:"title"`
	FileKey        string          `json:"fileKey"`
	ThumbnailKey   string          `json:"thumbnailKey"`
	ContentType    string          `json:"contentType"`
	GroupID        string          `json:"groupId"`
	Tags           []string        `json:"tags"`
	SourceType     string          `json:"sourceType"`
	SourceID       string          `json:"sourceId"`
	SourceMetadata json.RawMessage `json:"sourceMetadata"`
	ParentAssetID  string          `json:"parentAssetId"`
}

type updateUserAssetIn struct {
	Title   Opt[string]   `json:"title"`
	GroupID Opt[string]   `json:"groupId"`
	Tags    Opt[[]string] `json:"tags"`
}

type batchUserAssetsIn struct {
	Action     string      `json:"action"`
	IDs        []string    `json:"ids"`
	GroupID    Opt[string] `json:"groupId"`
	AddTags    []string    `json:"addTags"`
	RemoveTags []string    `json:"removeTags"`
}

type createUserAssetGroupIn struct {
	Name string `json:"name"`
	Sort *int   `json:"sort"`
}

type updateUserAssetGroupIn struct {
	Name Opt[string] `json:"name"`
	Sort Opt[int]    `json:"sort"`
}

func userAssetDict(asset *store.UserAsset) gin.H {
	out := gin.H{
		"id": asset.ID.String(), "title": asset.Title,
		"url":          "/api/v1/files/" + asset.FileKey,
		"thumbnailUrl": "/api/v1/files/" + asset.ThumbnailKey,
		"contentType":  asset.ContentType, "sizeBytes": asset.SizeBytes,
		"createdAt":      isoValue(asset.CreatedAt),
		"updatedAt":      isoValue(asset.UpdatedAt),
		"groupId":        nil,
		"tags":           asset.Tags,
		"contentHash":    asset.ContentHash,
		"sourceType":     asset.SourceType,
		"sourceId":       asset.SourceID,
		"sourceMetadata": asset.SourceMetadata,
		"parentAssetId":  nil,
		"deletedAt":      isoPointer(asset.DeletedAt),
	}
	if asset.GroupID != nil {
		out["groupId"] = asset.GroupID.String()
	}
	if asset.ParentAssetID != nil {
		out["parentAssetId"] = asset.ParentAssetID.String()
	}
	return out
}

func normalizeAssetTags(values []string) ([]string, error) {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		if utf8.RuneCountInString(value) > 32 {
			return nil, apperr.E("validation_error", "标签不能超过 32 个字符", 422)
		}
		seen[value] = true
		out = append(out, value)
		if len(out) > 30 {
			return nil, apperr.E("validation_error", "每个素材最多 30 个标签", 422)
		}
	}
	return out, nil
}

func userAssetGroupDict(group *store.UserAssetGroup) gin.H {
	return gin.H{
		"id": group.ID.String(), "name": group.Name, "sort": group.Sort,
		"assetCount": group.AssetCount,
		"createdAt":  isoValue(group.CreatedAt),
		"updatedAt":  isoValue(group.UpdatedAt),
	}
}

func (s *Server) resolveOwnedAssetGroup(c *gin.Context, q store.Q, userID uuid.UUID, raw string) (*uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, apperr.E("validation_error", "groupId 无效", 422)
	}
	group, err := store.GetUserAssetGroupForShare(c.Request.Context(), q, userID, id)
	if err != nil {
		return nil, err
	}
	if group == nil {
		return nil, apperr.E("validation_error", "分组不存在", 422)
	}
	return &id, nil
}

func (s *Server) myAssets(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}

	var groupFilter *uuid.UUID
	switch raw := strings.TrimSpace(c.Query("groupId")); {
	case raw == "", strings.EqualFold(raw, "all"):
		// 全部
	case strings.EqualFold(raw, "ungrouped"):
		nilID := uuid.Nil
		groupFilter = &nilID
	default:
		id, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "groupId 无效", 422))
			return
		}
		groupFilter = &id
	}

	tags, err := normalizeAssetTags(strings.Split(c.Query("tags"), ","))
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListUserAssetsDAM(c.Request.Context(), s.St.Pool, user.ID, store.UserAssetListOptions{
		Limit: limit, Cursor: cursor, GroupFilter: groupFilter, Query: c.Query("q"), Tags: tags,
		Trash: strings.EqualFold(c.Query("trash"), "true"),
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, userAssetDict))
}

func (s *Server) createUserAsset(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body createUserAssetIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	body.FileKey = strings.TrimSpace(body.FileKey)
	body.ThumbnailKey = strings.TrimSpace(body.ThumbnailKey)
	if body.Title == "" || utf8.RuneCountInString(body.Title) > 120 {
		fail(c, apperr.E("validation_error", "title: 长度须在 1-120 之间", 422))
		return
	}
	prefix := "uploads/" + user.ID.String() + "/"
	if !strings.HasPrefix(body.FileKey, prefix+"original/") || !strings.HasPrefix(body.ThumbnailKey, prefix+"thumb/") {
		fail(c, apperr.E("validation_error", "素材只能引用自己的上传文件", 422))
		return
	}
	ctx := c.Request.Context()
	size, contentType, contentHash, err := s.inspectOwnedUserUploadImageWithHash(ctx, user.ID, body.FileKey, maxUserAssetImageBytes)
	if err != nil || size <= 0 {
		fail(c, apperr.E("validation_error", "素材文件不存在、不是有效图片或超过 10MB", 422))
		return
	}
	if _, _, err := s.inspectOwnedUserUploadImage(ctx, user.ID, body.ThumbnailKey, maxUserAssetImageBytes); err != nil {
		fail(c, apperr.E("validation_error", "素材缩略图不存在或不是有效图片", 422))
		return
	}
	var asset *store.UserAsset
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserAssetCreation(ctx, tx, user.ID); err != nil {
			return err
		}
		groupID, err := s.resolveOwnedAssetGroup(c, tx, user.ID, body.GroupID)
		if err != nil {
			return err
		}
		tags, err := normalizeAssetTags(body.Tags)
		if err != nil {
			return err
		}
		sourceType := strings.TrimSpace(body.SourceType)
		if sourceType == "" {
			sourceType = "upload"
		}
		if utf8.RuneCountInString(sourceType) > 40 {
			return apperr.E("validation_error", "sourceType 无效", 422)
		}
		var sourceID *string
		if value := strings.TrimSpace(body.SourceID); value != "" {
			sourceID = &value
		}
		sourceMetadata := body.SourceMetadata
		if len(sourceMetadata) == 0 {
			sourceMetadata = json.RawMessage(`{}`)
		}
		var metadataObject map[string]any
		if len(sourceMetadata) > 32<<10 || json.Unmarshal(sourceMetadata, &metadataObject) != nil {
			return apperr.E("validation_error", "sourceMetadata 必须是 JSON 对象且不能超过 32KB", 422)
		}
		var parentAssetID *uuid.UUID
		if raw := strings.TrimSpace(body.ParentAssetID); raw != "" {
			id, parseErr := uuid.Parse(raw)
			if parseErr != nil {
				return apperr.E("validation_error", "parentAssetId 无效", 422)
			}
			parent, getErr := store.GetUserAsset(ctx, tx, user.ID, id)
			if getErr != nil {
				return getErr
			}
			if parent == nil {
				return apperr.E("validation_error", "父素材不存在", 422)
			}
			parentAssetID = &id
		}
		duplicate, err := store.GetUserAssetByContentHash(ctx, tx, user.ID, contentHash)
		if err != nil {
			return err
		}
		if duplicate != nil {
			return apperr.E("asset_duplicate_content", "相同图片已存在于资产库", 409)
		}
		count, err := store.CountUserAssets(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if count >= maxUserAssets {
			return apperr.E("asset_limit_reached", "素材库最多保存 200 项", 409)
		}
		asset, err = store.InsertUserAssetDAM(ctx, tx, user.ID, body.Title,
			body.FileKey, body.ThumbnailKey, contentType, size, groupID, tags, contentHash, sourceType, sourceID, sourceMetadata, parentAssetID)
		if err != nil {
			return err
		}
		return store.AddUserUploadReferences(ctx, tx, user.ID, store.UploadReferenceUserAsset, asset.ID,
			[]string{asset.FileKey, asset.ThumbnailKey})
	})
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("asset_exists", "该素材已经添加", 409))
			return
		}
		fail(c, err)
		return
	}
	respondCreated(c, userAssetDict(asset))
}

func (s *Server) updateUserAsset(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body updateUserAssetIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if !body.Title.Set && !body.GroupID.Set && !body.Tags.Set {
		fail(c, apperr.E("validation_error", "至少提供 title、groupId 或 tags", 422))
		return
	}
	ctx := c.Request.Context()
	var updated *store.UserAsset
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		asset, err := store.GetUserAssetForUpdate(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if asset == nil {
			return apperr.E("not_found", "素材不存在", 404)
		}

		title := asset.Title
		if body.Title.Set {
			if !body.Title.Valid {
				return apperr.E("validation_error", "title 不能为空", 422)
			}
			title = strings.TrimSpace(body.Title.Value)
			if title == "" || utf8.RuneCountInString(title) > 120 {
				return apperr.E("validation_error", "title: 长度须在 1-120 之间", 422)
			}
		}

		groupID := asset.GroupID
		if body.GroupID.Set {
			if !body.GroupID.Valid || strings.TrimSpace(body.GroupID.Value) == "" {
				groupID = nil
			} else {
				resolved, resolveErr := s.resolveOwnedAssetGroup(c, tx, user.ID, body.GroupID.Value)
				if resolveErr != nil {
					return resolveErr
				}
				groupID = resolved
			}
		}
		tags := asset.Tags
		if body.Tags.Set {
			if !body.Tags.Valid {
				return apperr.E("validation_error", "tags 不能为空", 422)
			}
			tags, err = normalizeAssetTags(body.Tags.Value)
			if err != nil {
				return err
			}
		}

		updated, err = store.UpdateUserAsset(ctx, tx, user.ID, id, title, groupID, tags)
		if err != nil {
			return err
		}
		if updated == nil {
			return apperr.E("not_found", "素材不存在", 404)
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, userAssetDict(updated))
}

func (s *Server) deleteUserAsset(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		asset, err := store.GetUserAssetForUpdate(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if asset == nil {
			return apperr.E("not_found", "素材不存在", 404)
		}
		productCount, err := store.CountEcommerceProductsUsingAsset(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if productCount > 0 {
			return apperr.E("asset_in_use", "该素材仍被商品引用，请先移除商品关联", 409)
		}
		return store.DeleteUserAsset(ctx, tx, user.ID, id)
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}

func (s *Server) restoreUserAsset(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	asset, err := store.RestoreUserAsset(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if asset == nil {
		fail(c, apperr.E("not_found", "回收站中没有该素材", 404))
		return
	}
	ok(c, userAssetDict(asset))
}

func (s *Server) permanentlyDeleteUserAsset(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		asset, err := store.GetUserAssetForUpdate(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if asset == nil || asset.DeletedAt == nil {
			return apperr.E("not_found", "回收站中没有该素材", 404)
		}
		if err := store.DeleteUserUploadReferences(ctx, tx, store.UploadReferenceUserAsset, asset.ID); err != nil {
			return err
		}
		if err := store.EnqueueObjectCleanup(ctx, tx, []string{asset.FileKey, asset.ThumbnailKey}); err != nil {
			return err
		}
		return store.PermanentlyDeleteUserAsset(ctx, tx, user.ID, id)
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}

func (s *Server) batchUserAssets(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body batchUserAssetsIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 200 {
		fail(c, apperr.E("validation_error", "ids 数量须在 1-200 之间", 422))
		return
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	seen := make(map[uuid.UUID]bool, len(body.IDs))
	for _, raw := range body.IDs {
		id, parseErr := uuid.Parse(strings.TrimSpace(raw))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "ids 包含无效 ID", 422))
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	ctx := c.Request.Context()
	var affected int64
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		items, err := store.GetUserAssetsByIDs(ctx, tx, user.ID, ids)
		if err != nil {
			return err
		}
		if body.Action != "restore" && int64(len(items)) != int64(len(ids)) {
			return apperr.E("not_found", "部分素材不存在或已在回收站", 404)
		}
		switch body.Action {
		case "update":
			var groupID *uuid.UUID
			if body.GroupID.Set {
				if body.GroupID.Valid && strings.TrimSpace(body.GroupID.Value) != "" {
					groupID, err = s.resolveOwnedAssetGroup(c, tx, user.ID, body.GroupID.Value)
					if err != nil {
						return err
					}
				}
			}
			addTags, err := normalizeAssetTags(body.AddTags)
			if err != nil {
				return err
			}
			removeTags, err := normalizeAssetTags(body.RemoveTags)
			if err != nil {
				return err
			}
			affected, err = store.BatchUpdateUserAssets(ctx, tx, user.ID, ids, body.GroupID.Set, groupID, addTags, removeTags)
			return err
		case "trash":
			for _, item := range items {
				count, err := store.CountEcommerceProductsUsingAsset(ctx, tx, user.ID, item.ID)
				if err != nil {
					return err
				}
				if count > 0 {
					return apperr.E("asset_in_use", "选中的素材仍被商品引用", 409)
				}
			}
			affected, err = store.BatchTrashUserAssets(ctx, tx, user.ID, ids)
			return err
		case "restore":
			affected, err = store.BatchRestoreUserAssets(ctx, tx, user.ID, ids)
			return err
		default:
			return apperr.E("validation_error", "action 必须是 update、trash 或 restore", 422)
		}
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"affected": affected})
}

func (s *Server) myAssetGroups(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	groups, err := store.ListUserAssetGroups(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ungrouped, err := store.CountUserAssetsUngrouped(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountUserAssets(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(groups))
	for _, group := range groups {
		items = append(items, userAssetGroupDict(group))
	}
	ok(c, gin.H{
		"items":           items,
		"ungroupedCount":  ungrouped,
		"totalAssetCount": total,
	})
}

func (s *Server) createUserAssetGroup(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body createUserAssetGroupIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	name := store.NormalizeAssetGroupName(body.Name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		fail(c, apperr.E("validation_error", "name: 长度须在 1-64 之间", 422))
		return
	}
	ctx := c.Request.Context()
	var group *store.UserAssetGroup
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserAssetGroupCreation(ctx, tx, user.ID); err != nil {
			return err
		}
		count, err := store.CountUserAssetGroups(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if count >= store.MaxUserAssetGroups {
			return apperr.E("asset_group_limit_reached", "最多创建 50 个分组", 409)
		}
		sort := int(count)
		if body.Sort != nil {
			sort = *body.Sort
		}
		group, err = store.InsertUserAssetGroup(ctx, tx, user.ID, name, sort)
		return err
	})
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("asset_group_exists", "分组名称已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	group.AssetCount = 0
	respondCreated(c, userAssetGroupDict(group))
}

func (s *Server) updateUserAssetGroup(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body updateUserAssetGroupIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if !body.Name.Set && !body.Sort.Set {
		fail(c, apperr.E("validation_error", "至少提供 name 或 sort", 422))
		return
	}
	ctx := c.Request.Context()
	var updated *store.UserAssetGroup
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		group, err := store.GetUserAssetGroupForUpdate(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if group == nil {
			return apperr.E("not_found", "分组不存在", 404)
		}
		name := group.Name
		if body.Name.Set {
			if !body.Name.Valid {
				return apperr.E("validation_error", "name 不能为空", 422)
			}
			name = store.NormalizeAssetGroupName(body.Name.Value)
			if name == "" || utf8.RuneCountInString(name) > 64 {
				return apperr.E("validation_error", "name: 长度须在 1-64 之间", 422)
			}
		}
		sort := group.Sort
		if body.Sort.Set {
			if !body.Sort.Valid {
				return apperr.E("validation_error", "sort 不能为空", 422)
			}
			sort = body.Sort.Value
		}
		updated, err = store.UpdateUserAssetGroup(ctx, tx, user.ID, id, name, sort)
		if err != nil {
			return err
		}
		if updated == nil {
			return apperr.E("not_found", "分组不存在", 404)
		}
		return nil
	})
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("asset_group_exists", "分组名称已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	countRows, err := store.ListUserAssetGroups(c.Request.Context(), s.St.Pool, user.ID)
	if err == nil {
		for _, item := range countRows {
			if item.ID == updated.ID {
				updated.AssetCount = item.AssetCount
				break
			}
		}
	}
	ok(c, userAssetGroupDict(updated))
}

func (s *Server) deleteUserAssetGroup(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	group, err := store.GetUserAssetGroup(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if group == nil {
		fail(c, apperr.E("not_found", "分组不存在", 404))
		return
	}
	if err := store.DeleteUserAssetGroup(c.Request.Context(), s.St.Pool, user.ID, id); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}
