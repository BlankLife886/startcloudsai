package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var emptyCanvasDocument = json.RawMessage(`{"version":2,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`)

type canvasProjectCreateIn struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	Document json.RawMessage `json:"document"`
}

type canvasProjectPatchIn struct {
	Title    *string         `json:"title"`
	Document json.RawMessage `json:"document"`
	Revision *int64          `json:"revision"`
}

func validateCanvasTitle(value string) (string, error) {
	title := strings.TrimSpace(value)
	if title == "" {
		return "", apperr.E("validation_error", "title: 画布名称不能为空", 422)
	}
	if utf8.RuneCountInString(title) > 120 {
		return "", apperr.E("validation_error", "title: 画布名称不能超过 120 个字符", 422)
	}
	return title, nil
}

func validateCanvasDocument(raw json.RawMessage) (json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return append(json.RawMessage(nil), emptyCanvasDocument...), nil
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil || document == nil {
		return nil, apperr.E("validation_error", "document: 必须是有效的 JSON 对象", 422)
	}
	version, versionOK := document["version"].(float64)
	if !versionOK || (version != 1 && version != 2 && version != 3) {
		return nil, apperr.E("validation_error", "document.version: 当前仅支持版本 1、2 或 3", 422)
	}
	nodes, nodesOK := document["nodes"].([]any)
	if !nodesOK {
		return nil, apperr.E("validation_error", "document.nodes: 必须是数组", 422)
	}
	if len(nodes) > 5000 {
		return nil, apperr.E("validation_error", "document.nodes: 最多允许 5000 个节点", 422)
	}
	connectionField := "edges"
	if version == 3 {
		connectionField = "connections"
	}
	edges, edgesOK := document[connectionField].([]any)
	if !edgesOK {
		return nil, apperr.E("validation_error", "document."+connectionField+": 必须是数组", 422)
	}
	if len(edges) > 10000 {
		return nil, apperr.E("validation_error", "document."+connectionField+": 最多允许 10000 条连线", 422)
	}
	if viewport, exists := document["viewport"]; exists {
		if _, ok := viewport.(map[string]any); !ok {
			return nil, apperr.E("validation_error", "document.viewport: 必须是对象", 422)
		}
	}
	return raw, nil
}

func canvasProjectJSON(item *store.CanvasProject) gin.H {
	return gin.H{
		"id": item.ID.String(), "title": item.Title, "document": item.Document,
		"revision":  item.Revision,
		"createdAt": isoValue(item.CreatedAt), "updatedAt": isoValue(item.UpdatedAt),
		"sizeBytes": len(item.Document),
	}
}

func (s *Server) listCanvasProjects(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListUserCanvasProjects(c.Request.Context(), s.St.Pool, user.ID, 100)
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(items))
	for _, item := range items {
		out = append(out, gin.H{
			"id": item.ID.String(), "title": item.Title, "revision": item.Revision,
			"createdAt": isoValue(item.CreatedAt), "updatedAt": isoValue(item.UpdatedAt), "sizeBytes": item.SizeBytes,
		})
	}
	ok(c, gin.H{"items": out})
}

func (s *Server) createCanvasProject(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var in canvasProjectCreateIn
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, apperr.E("validation_error", "请求格式无效", 422))
		return
	}
	title, err := validateCanvasTitle(in.Title)
	if err != nil {
		fail(c, err)
		return
	}
	document, err := validateCanvasDocument(in.Document)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	if err := checkCanvasDocumentSize(document, settings.ResolveCanvasProjectMaxBytes(ctx, s.St.Pool)); err != nil {
		fail(c, err)
		return
	}
	var requestedID *uuid.UUID
	if strings.TrimSpace(in.ID) != "" {
		id, parseErr := uuid.Parse(strings.TrimSpace(in.ID))
		if parseErr != nil {
			fail(c, apperr.E("validation_error", "id: 必须是有效的 UUID", 422))
			return
		}
		requestedID = &id
	}
	var item *store.CanvasProject
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		// 计数与插入在同一事务里按用户串行，避免并发新建突破项目数上限。
		if err := store.LockUserCanvasProjectCreation(ctx, tx, user.ID); err != nil {
			return err
		}
		quota, err := s.canvasProjectQuota(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if quota.Used >= quota.Limit {
			return apperr.E("canvas_project_limit",
				fmt.Sprintf("已达到 %d 个画布项目上限，请删除不再使用的项目后再新建", quota.Limit), 409)
		}
		item, err = store.InsertCanvasProjectWithID(ctx, tx, user.ID, requestedID, title, document)
		return err
	})
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("id_conflict", "画布项目 ID 已被占用", 409))
		return
	}
	respondCreated(c, canvasProjectJSON(item))
}

func (s *Server) getCanvasProject(c *gin.Context) {
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
	item, err := store.GetUserCanvasProject(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "画布项目不存在", 404))
		return
	}
	ok(c, canvasProjectJSON(item))
}

func (s *Server) patchCanvasProject(c *gin.Context) {
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
	current, err := store.GetUserCanvasProject(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if current == nil {
		fail(c, apperr.E("not_found", "画布项目不存在", 404))
		return
	}
	var in canvasProjectPatchIn
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, apperr.E("validation_error", "请求格式无效", 422))
		return
	}
	if in.Revision == nil || *in.Revision < 1 {
		fail(c, apperr.E("validation_error", "revision: 必须提供当前版本号", 422))
		return
	}
	title := current.Title
	if in.Title != nil {
		title, err = validateCanvasTitle(*in.Title)
		if err != nil {
			fail(c, err)
			return
		}
	}
	document := current.Document
	if len(bytes.TrimSpace(in.Document)) > 0 {
		document, err = validateCanvasDocument(in.Document)
		if err != nil {
			fail(c, err)
			return
		}
		if err := checkCanvasDocumentSize(document, settings.ResolveCanvasProjectMaxBytes(c.Request.Context(), s.St.Pool)); err != nil {
			fail(c, err)
			return
		}
	}
	item, err := store.UpdateUserCanvasProject(c.Request.Context(), s.St.Pool, user.ID, id, title, document, *in.Revision)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("revision_conflict", "画布已在其他位置更新，请刷新后重试", 409))
		return
	}
	ok(c, canvasProjectJSON(item))
}

func (s *Server) deleteCanvasProject(c *gin.Context) {
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
	deleted, err := store.DeleteUserCanvasProject(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("not_found", "画布项目不存在", 404))
		return
	}
	respondNoContent(c)
}

// canvasProjectQuota 按后台设置（基础项目数、单项目大小）与用户订阅加成计算画布项目配额。
func (s *Server) canvasProjectQuota(ctx context.Context, q store.Q, userID uuid.UUID) (store.CanvasProjectQuota, error) {
	return store.GetUserCanvasProjectQuota(ctx, q, userID,
		settings.ResolveCanvasProjectMaxCount(ctx, q), settings.ResolveCanvasProjectMaxBytes(ctx, q))
}

func checkCanvasDocumentSize(document json.RawMessage, maxBytes int64) error {
	if maxBytes > 0 && int64(len(document)) > maxBytes {
		return apperr.E("canvas_document_too_large",
			fmt.Sprintf("画布项目 %s，超过单个项目 %s 的上限，请删除部分节点或拆分到新项目", formatCanvasBytes(int64(len(document))), formatCanvasBytes(maxBytes)), 413)
	}
	return nil
}

// formatCanvasBytes 不足 1MB 按 KB（向上取整），否则按 MB 保留一位小数。
func formatCanvasBytes(bytes int64) string {
	if bytes < 1<<20 {
		return fmt.Sprintf("%dKB", max(1, (bytes+1023)>>10))
	}
	return fmt.Sprintf("%.1fMB", float64(bytes)/(1<<20))
}

// myCanvasProjectQuota 返回当前用户的画布项目配额（已用/上限/单项目大小上限），供前端提示。
func (s *Server) myCanvasProjectQuota(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	quota, err := s.canvasProjectQuota(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, quota)
}
