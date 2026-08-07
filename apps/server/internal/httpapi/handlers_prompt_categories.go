package httpapi

import (
	"context"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var promptCategoryKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var reservedPromptCategoryKeys = map[string]struct{}{
	"all": {}, "today": {}, "latest": {}, "favorites": {}, "my-favorites": {},
}

func promptCategoryDict(category *store.PromptCategory, count int64, includeAdmin bool) gin.H {
	item := gin.H{
		"id":    category.ID.String(),
		"key":   category.Key,
		"label": category.Label,
		"sort":  category.Sort,
		"count": count,
	}
	if includeAdmin {
		item["active"] = category.Active
		item["builtin"] = category.Builtin
		item["createdAt"] = isoValue(category.CreatedAt)
		item["updatedAt"] = isoValue(category.UpdatedAt)
	}
	return item
}

func (s *Server) publicPromptCategories(c *gin.Context) {
	taskType := c.Query("type")
	if taskType != "" && !store.Contains(store.TaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	rows, err := store.ListPromptCategories(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	counts, err := store.CountPromptEntriesByCategory(c.Request.Context(), s.St.Pool, store.PromptFilter{
		TaskType: taskType, ActiveOnly: true,
	})
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, category := range rows {
		items = append(items, promptCategoryDict(category, counts[category.Key], false))
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) adminPromptCategories(c *gin.Context, _ *store.User) {
	rows, err := store.ListPromptCategories(c.Request.Context(), s.St.Pool, false)
	if err != nil {
		fail(c, err)
		return
	}
	counts, err := store.CountPromptEntriesByCategory(c.Request.Context(), s.St.Pool, store.PromptFilter{})
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, category := range rows {
		items = append(items, promptCategoryDict(category, counts[category.Key], true))
	}
	ok(c, gin.H{"items": items})
}

type promptCategoryIn struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Sort   *int   `json:"sort"`
	Active *bool  `json:"active"`
}

func normalizePromptCategoryInput(key, label string) (string, string, error) {
	key = strings.ToLower(strings.TrimSpace(key))
	label = strings.TrimSpace(label)
	if !promptCategoryKeyPattern.MatchString(key) {
		return "", "", apperr.E("validation_error", "key: 仅支持小写英文字母、数字、连字符和下划线，且必须以字母开头", 422)
	}
	if _, reserved := reservedPromptCategoryKeys[key]; reserved {
		return "", "", apperr.E("validation_error", "key: 该标识为系统筛选保留字", 422)
	}
	if label == "" || len([]rune(label)) > 64 {
		return "", "", apperr.E("validation_error", "label: 长度须在 1-64 之间", 422)
	}
	return key, label, nil
}

func (s *Server) adminCreatePromptCategory(c *gin.Context, _ *store.User) {
	var body promptCategoryIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	key, label, err := normalizePromptCategoryInput(body.Key, body.Label)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	existing, err := store.GetPromptCategoryByKey(ctx, s.St.Pool, key)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("validation_error", "key: 分类标识已存在", 422))
		return
	}
	sortValue := 0
	if body.Sort != nil {
		sortValue = *body.Sort
	} else {
		maxSort, err := store.MaxPromptCategorySort(ctx, s.St.Pool)
		if err != nil {
			fail(c, err)
			return
		}
		sortValue = maxSort + 10
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	category, err := store.InsertPromptCategory(ctx, s.St.Pool, key, label, sortValue, active)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, promptCategoryDict(category, 0, true))
}

type promptCategoryPatchIn struct {
	Label  Opt[string] `json:"label"`
	Sort   Opt[int]    `json:"sort"`
	Active Opt[bool]   `json:"active"`
}

func (s *Server) adminPatchPromptCategory(c *gin.Context, _ *store.User) {
	categoryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body promptCategoryPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Label.Valid {
		body.Label.Value = strings.TrimSpace(body.Label.Value)
		if body.Label.Value == "" || len([]rune(body.Label.Value)) > 64 {
			fail(c, apperr.E("validation_error", "label: 长度须在 1-64 之间", 422))
			return
		}
	}
	ctx := c.Request.Context()
	category, err := store.GetPromptCategory(ctx, s.St.Pool, categoryID)
	if err != nil {
		fail(c, err)
		return
	}
	if category == nil {
		fail(c, apperr.E("not_found", "提示词分类不存在", 404))
		return
	}
	if body.Label.Valid {
		category.Label = body.Label.Value
	}
	if body.Sort.Valid {
		category.Sort = body.Sort.Value
	}
	if body.Active.Valid {
		category.Active = body.Active.Value
	}
	if err := store.UpdatePromptCategory(ctx, s.St.Pool, category); err != nil {
		fail(c, err)
		return
	}
	counts, err := store.CountPromptEntriesByCategory(ctx, s.St.Pool, store.PromptFilter{})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, promptCategoryDict(category, counts[category.Key], true))
}

func (s *Server) adminDeletePromptCategory(c *gin.Context, _ *store.User) {
	categoryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	category, err := store.GetPromptCategory(ctx, s.St.Pool, categoryID)
	if err != nil {
		fail(c, err)
		return
	}
	if category == nil {
		fail(c, apperr.E("not_found", "提示词分类不存在", 404))
		return
	}
	if category.Builtin {
		fail(c, apperr.E("builtin_category_protected", "内置分类不可删除，可以停用或改名", 409))
		return
	}
	tx, err := s.St.Pool.Begin(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if err := store.DeletePromptCategory(ctx, tx, categoryID, category.Key); err != nil {
		fail(c, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}

func validatePromptCategoryReference(ctx context.Context, q store.Q, category *string) error {
	if category == nil || strings.TrimSpace(*category) == "" {
		return nil
	}
	key := strings.TrimSpace(*category)
	configured, err := store.GetPromptCategoryByKey(ctx, q, key)
	if err != nil {
		return err
	}
	if configured == nil {
		return apperr.E("validation_error", "category: 分类不存在", 422)
	}
	*category = key
	return nil
}
