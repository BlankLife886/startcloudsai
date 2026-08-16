package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const tryonCatalogMaxBytes = promptCoverMaxBytes

func ecommerceTryonCatalogDict(item *store.EcommerceTryonCatalogItem, includeAdmin bool) gin.H {
	out := gin.H{
		"id":       item.ID.String(),
		"kind":     item.Kind,
		"label":    item.Label,
		"imageUrl": "/api/v1/files/" + strings.TrimLeft(item.ImageKey, "/"),
		"apparel":  item.Apparel,
		"metadata": item.Metadata,
	}
	if includeAdmin {
		out["imageKey"] = item.ImageKey
		out["sort"] = item.Sort
		out["active"] = item.Active
		out["createdAt"] = isoValue(item.CreatedAt)
		out["updatedAt"] = isoValue(item.UpdatedAt)
	}
	return out
}

func parseTryonCatalogKind(raw string, required bool) (string, error) {
	kind := strings.TrimSpace(raw)
	if kind == "" {
		if required {
			return "", apperr.E("validation_error", "kind: 不能为空", 422)
		}
		return "", nil
	}
	if !store.Contains(store.EcommerceCatalogKinds, kind) {
		return "", apperr.E("validation_error", "kind: 仅支持 model / scene / garment / hand", 422)
	}
	return kind, nil
}

func parseTryonCatalogLabel(raw string) (string, error) {
	label := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(label)
	if n < 1 || n > 32 {
		return "", apperr.E("validation_error", "label: 长度须在 1-32 之间", 422)
	}
	return label, nil
}

func parseTryonCatalogApparel(kind, raw string) (string, error) {
	apparel := strings.TrimSpace(raw)
	if apparel == "" {
		return "", nil
	}
	if kind != "garment" {
		return "", apperr.E("validation_error", "apparel: 仅服装素材可设置品类", 422)
	}
	switch apparel {
	case "上装", "下装", "全身":
		return apparel, nil
	default:
		return "", apperr.E("validation_error", "apparel: 仅支持 上装 / 下装 / 全身", 422)
	}
}

func (s *Server) publicEcommerceCatalog(c *gin.Context) {
	kind, err := parseTryonCatalogKind(c.Query("kind"), false)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListEcommerceTryonCatalog(c.Request.Context(), s.St.Pool, kind, true)
	if err != nil {
		fail(c, err)
		return
	}
	models := make([]gin.H, 0)
	scenes := make([]gin.H, 0)
	garments := make([]gin.H, 0)
	hands := make([]gin.H, 0)
	for _, item := range rows {
		dict := ecommerceTryonCatalogDict(item, false)
		switch item.Kind {
		case "model":
			models = append(models, dict)
		case "scene":
			scenes = append(scenes, dict)
		case "garment":
			garments = append(garments, dict)
		case "hand":
			hands = append(hands, dict)
		}
	}
	ok(c, gin.H{"models": models, "scenes": scenes, "garments": garments, "hands": hands})
}

func (s *Server) publicTryonCatalog(c *gin.Context) {
	s.publicEcommerceCatalog(c)
}

func (s *Server) adminListTryonCatalog(c *gin.Context, _ *store.User) {
	kind, err := parseTryonCatalogKind(c.Query("kind"), false)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListEcommerceTryonCatalog(c.Request.Context(), s.St.Pool, kind, false)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, item := range rows {
		items = append(items, ecommerceTryonCatalogDict(item, true))
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) adminCreateTryonCatalog(c *gin.Context, _ *store.User) {
	kind, err := parseTryonCatalogKind(c.PostForm("kind"), true)
	if err != nil {
		fail(c, err)
		return
	}
	label, err := parseTryonCatalogLabel(c.PostForm("label"))
	if err != nil {
		fail(c, err)
		return
	}
	apparel, err := parseTryonCatalogApparel(kind, c.PostForm("apparel"))
	if err != nil {
		fail(c, err)
		return
	}
	active := true
	if raw := strings.TrimSpace(c.PostForm("active")); raw != "" {
		active = raw == "true" || raw == "1"
	}
	ctx := c.Request.Context()
	count, err := store.CountEcommerceTryonCatalogByKind(ctx, s.St.Pool, kind)
	if err != nil {
		fail(c, err)
		return
	}
	if count >= store.MaxEcommerceTryonCatalogPerKind {
		fail(c, apperr.E("validation_error", fmt.Sprintf("每种素材最多 %d 张", store.MaxEcommerceTryonCatalogPerKind), 422))
		return
	}
	sortVal, err := store.MaxEcommerceTryonCatalogSort(ctx, s.St.Pool, kind)
	if err != nil {
		fail(c, err)
		return
	}
	if raw := strings.TrimSpace(c.PostForm("sort")); raw != "" {
		parsed, parseErr := parseIntForm(raw)
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "sort: 须为整数", 422))
			return
		}
		sortVal = parsed
	} else {
		sortVal += 10
	}
	data, ext, contentType, err := s.readTryonCatalogImage(c)
	if err != nil {
		fail(c, err)
		return
	}
	item := &store.EcommerceTryonCatalogItem{
		ID:      uuid.New(),
		Kind:    kind,
		Label:   label,
		Apparel: apparel,
		Sort:    sortVal,
		Active:  active,
	}
	item.ImageKey = fmt.Sprintf("ecommerce-catalog/%s.%s", item.ID, ext)
	if err := s.Storage.UploadBytes(ctx, item.ImageKey, data, contentType); err != nil {
		fail(c, err)
		return
	}
	created, err := store.InsertEcommerceTryonCatalogItem(ctx, s.St.Pool, item)
	if err != nil {
		_ = s.Storage.DeleteKeys(ctx, []string{item.ImageKey})
		fail(c, err)
		return
	}
	respondCreated(c, ecommerceTryonCatalogDict(created, true))
}

type tryonCatalogPatchIn struct {
	Label   Opt[string] `json:"label"`
	Apparel Opt[string] `json:"apparel"`
	Sort    Opt[int]    `json:"sort"`
	Active  Opt[bool]   `json:"active"`
}

type reorderTryonCatalogIn struct {
	Kind string   `json:"kind"`
	IDs  []string `json:"ids"`
}

func (s *Server) adminReorderTryonCatalog(c *gin.Context, _ *store.User) {
	var body reorderTryonCatalogIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	kind, err := parseTryonCatalogKind(body.Kind, true)
	if err != nil {
		fail(c, err)
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > store.MaxEcommerceTryonCatalogPerKind {
		fail(c, apperr.E("validation_error", fmt.Sprintf("ids: 数量须在 1-%d 之间", store.MaxEcommerceTryonCatalogPerKind), 422))
		return
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	for _, raw := range body.IDs {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			fail(c, apperr.E("validation_error", "ids: 包含无效 UUID", 422))
			return
		}
		ids = append(ids, id)
	}
	ctx := c.Request.Context()
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		return store.ReorderEcommerceTryonCatalog(ctx, tx, kind, ids)
	}); err != nil {
		fail(c, apperr.E("catalog_reorder_failed", "素材排序保存失败，请刷新后重试", 409))
		return
	}
	ok(c, gin.H{"updated": len(ids), "kind": kind})
}

func (s *Server) adminPatchTryonCatalog(c *gin.Context, _ *store.User) {
	itemID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body tryonCatalogPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	item, err := store.GetEcommerceTryonCatalogItem(ctx, s.St.Pool, itemID)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "素材不存在", 404))
		return
	}
	if body.Label.Valid {
		label, labelErr := parseTryonCatalogLabel(body.Label.Value)
		if labelErr != nil {
			fail(c, labelErr)
			return
		}
		item.Label = label
	}
	if body.Apparel.Valid {
		apparel, apparelErr := parseTryonCatalogApparel(item.Kind, body.Apparel.Value)
		if apparelErr != nil {
			fail(c, apparelErr)
			return
		}
		item.Apparel = apparel
	}
	if body.Sort.Valid {
		item.Sort = body.Sort.Value
	}
	if body.Active.Valid {
		item.Active = body.Active.Value
	}
	if err := store.UpdateEcommerceTryonCatalogItem(ctx, s.St.Pool, item); err != nil {
		fail(c, err)
		return
	}
	ok(c, ecommerceTryonCatalogDict(item, true))
}

func (s *Server) adminUploadTryonCatalogImage(c *gin.Context, _ *store.User) {
	itemID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	item, err := store.GetEcommerceTryonCatalogItem(ctx, s.St.Pool, itemID)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "素材不存在", 404))
		return
	}
	data, ext, contentType, err := s.readTryonCatalogImage(c)
	if err != nil {
		fail(c, err)
		return
	}
	newKey := fmt.Sprintf("ecommerce-catalog/%s.%s", item.ID, ext)
	oldKey := item.ImageKey
	if err := s.Storage.UploadBytes(ctx, newKey, data, contentType); err != nil {
		fail(c, err)
		return
	}
	if err := store.UpdateEcommerceTryonCatalogImage(ctx, s.St.Pool, item.ID, newKey); err != nil {
		if newKey != oldKey {
			_ = s.Storage.DeleteKeys(ctx, []string{newKey})
		}
		fail(c, err)
		return
	}
	if oldKey != "" && oldKey != newKey {
		if derr := s.Storage.DeleteKeys(ctx, []string{oldKey}); derr != nil {
			log.Printf("delete old ecommerce catalog image %s: %v", oldKey, derr)
		}
	}
	item.ImageKey = newKey
	ok(c, ecommerceTryonCatalogDict(item, true))
}

func (s *Server) adminDeleteTryonCatalog(c *gin.Context, _ *store.User) {
	itemID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	item, err := store.GetEcommerceTryonCatalogItem(ctx, s.St.Pool, itemID)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "素材不存在", 404))
		return
	}
	if err := store.DeleteEcommerceTryonCatalogItem(ctx, s.St.Pool, itemID); err != nil {
		fail(c, err)
		return
	}
	if item.ImageKey != "" {
		if derr := s.Storage.DeleteKeys(ctx, []string{item.ImageKey}); derr != nil {
			log.Printf("delete ecommerce catalog image %s: %v", item.ImageKey, derr)
		}
	}
	respondNoContent(c)
}

func (s *Server) readTryonCatalogImage(c *gin.Context) ([]byte, string, string, error) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		log.Printf("ecommerce catalog multipart parse failed: path=%s content_length=%d body_limit=%d err=%v",
			c.Request.URL.Path, c.Request.ContentLength,
			requestBodyLimit(c.Request.URL.Path, s.Cfg.UploadMaxBytes), err)
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || errors.Is(err, multipart.ErrMessageTooLarge) {
			return nil, "", "", apperr.E("upload_too_large", "图片不能超过 8MB", 413)
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, "", "", apperr.E("invalid_upload", "图片上传数据不完整，请重新选择后重试", 400)
		}
		return nil, "", "", apperr.E("validation_error", "file: 缺少上传文件", 422)
	}
	if fileHeader.Size > tryonCatalogMaxBytes {
		return nil, "", "", apperr.E("upload_too_large", "图片不能超过 8MB", 413)
	}
	f, err := fileHeader.Open()
	if err != nil {
		return nil, "", "", err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, tryonCatalogMaxBytes+1))
	if err != nil {
		return nil, "", "", err
	}
	if int64(len(data)) > tryonCatalogMaxBytes {
		return nil, "", "", apperr.E("upload_too_large", "图片不能超过 8MB", 413)
	}
	if len(data) == 0 {
		return nil, "", "", apperr.E("unsupported_file", "文件为空", 400)
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		return nil, "", "", apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", 400)
	}
	return data, ext, contentType, nil
}

func parseIntForm(raw string) (int, error) {
	return strconv.Atoi(strings.TrimSpace(raw))
}
