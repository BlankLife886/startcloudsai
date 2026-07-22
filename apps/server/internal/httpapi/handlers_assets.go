package httpapi

import (
	"log"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const maxUserAssets = 200

type createUserAssetIn struct {
	Title        string `json:"title"`
	FileKey      string `json:"fileKey"`
	ThumbnailKey string `json:"thumbnailKey"`
	ContentType  string `json:"contentType"`
}

func userAssetDict(asset *store.UserAsset) gin.H {
	return gin.H{
		"id": asset.ID.String(), "title": asset.Title,
		"url":          "/api/files/" + asset.FileKey,
		"thumbnailUrl": "/api/files/" + asset.ThumbnailKey,
		"contentType":  asset.ContentType, "sizeBytes": asset.SizeBytes,
		"createdAt": isoValue(asset.CreatedAt),
	}
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
	rows, err := store.ListUserAssets(c.Request.Context(), s.St.Pool, user.ID, limit, cursor)
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
	count, err := store.CountUserAssets(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if count >= maxUserAssets {
		fail(c, apperr.E("asset_limit_reached", "素材库最多保存 200 项", 409))
		return
	}
	size, err := s.Storage.ObjectSize(c.Request.Context(), body.FileKey)
	if err != nil || size <= 0 || size > 10<<20 {
		fail(c, apperr.E("validation_error", "素材文件不存在或超过 10MB", 422))
		return
	}
	if _, err := s.Storage.ObjectSize(c.Request.Context(), body.ThumbnailKey); err != nil {
		fail(c, apperr.E("validation_error", "素材缩略图不存在", 422))
		return
	}
	contentType := strings.TrimSpace(body.ContentType)
	if contentType == "" || !strings.HasPrefix(contentType, "image/") {
		contentType = "image/jpeg"
	}
	asset, err := store.InsertUserAsset(c.Request.Context(), s.St.Pool, user.ID, body.Title,
		body.FileKey, body.ThumbnailKey, contentType, size)
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("asset_exists", "该素材已经添加", 409))
			return
		}
		fail(c, err)
		return
	}
	ok(c, userAssetDict(asset))
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
	asset, err := store.GetUserAsset(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if asset == nil {
		fail(c, apperr.E("not_found", "素材不存在", 404))
		return
	}
	if err := store.DeleteUserAsset(c.Request.Context(), s.St.Pool, user.ID, id); err != nil {
		fail(c, err)
		return
	}
	if err := s.Storage.DeleteKeys(c.Request.Context(), []string{asset.FileKey, asset.ThumbnailKey}); err != nil {
		log.Printf("delete user asset files %s failed: %v", asset.ID, err)
	}
	ok(c, gin.H{"deleted": true})
}
