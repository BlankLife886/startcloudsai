// 社区运营接口（v3 增补）：提示词库、画廊分类、策展、画廊设置、
// 创作者聚合、违规下架/解禁。
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// promptCoverMaxBytes 提示词封面上限 8MB，与后台选择器保持一致。
const promptCoverMaxBytes = 8 * 1024 * 1024

var promptDayLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func promptTodayRange(now time.Time) (time.Time, time.Time) {
	local := now.In(promptDayLocation)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, promptDayLocation)
	return start.UTC(), start.AddDate(0, 0, 1).UTC()
}

func normalizePromptQueryTags(values []string) []string {
	tags := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		tag := strings.TrimSpace(value)
		if tag == "" {
			continue
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	return tags
}

// ---------- 提示词库（公开） ----------

func (s *Server) publicPrompts(c *gin.Context) {
	taskType := c.Query("type")
	if taskType != "" && !store.Contains(store.PromptTaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	order := c.DefaultQuery("sort", "recommended")
	if order != "recommended" && order != "latest" && order != "favorites" && order != "likes" && order != "usage" {
		fail(c, apperr.E("validation_error", "无效的提示词排序", 422))
		return
	}
	scope := c.Query("scope")
	if scope != "" && scope != "favorites" && scope != "today" {
		fail(c, apperr.E("validation_error", "无效的提示词范围", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	user, err := s.currentUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	tags := normalizePromptQueryTags(c.QueryArray("tag"))
	if len(tags) > 20 {
		fail(c, apperr.E("validation_error", "tag: 最多允许 20 项", 422))
		return
	}
	filter := store.PromptFilter{
		TaskType: taskType, Category: c.Query("category"), Search: strings.TrimSpace(c.Query("search")),
		Tags: tags, Order: order, ActiveOnly: true,
	}
	if scope == "favorites" {
		if user == nil {
			fail(c, apperr.E("auth_required", "请先登录后查看收藏", 401))
			return
		}
		filter.FavoritedBy = user.ID
	}
	if scope == "today" {
		filter.NewOnly = true
	}
	rows, err := store.ListPromptEntries(c.Request.Context(), s.St.Pool, filter, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	categoryCounts, err := store.CountPromptEntriesByCategory(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountPromptEntries(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	promptTags, err := store.ListPromptTags(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	states := map[uuid.UUID]store.PromptEngagementState{}
	if user != nil {
		states, err = store.PromptEngagementStates(c.Request.Context(), s.St.Pool, user.ID, ids)
		if err != nil {
			fail(c, err)
			return
		}
	}
	page := buildPage(rows, limit, func(p *store.PromptEntry) gin.H {
		d := promptDict(p, false)
		state := states[p.ID]
		d["liked"] = state.Liked
		d["favorited"] = state.Favorited
		return d
	})
	page["categoryCounts"] = categoryCounts
	page["tags"] = promptTags
	page["total"] = total
	ok(c, page)
}

type promptEngagementIn struct {
	Action string `json:"action"`
	Active *bool  `json:"active"`
}

func (s *Server) promptEngagement(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	promptID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body promptEngagementIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Action != "like" && body.Action != "favorite" && body.Action != "use" {
		fail(c, apperr.E("validation_error", "action: 仅支持 like / favorite / use", 422))
		return
	}
	entry, err := store.GetPromptEntry(c.Request.Context(), s.St.Pool, promptID)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil || !entry.Active {
		fail(c, apperr.E("not_found", "提示词不存在", 404))
		return
	}
	tx, err := s.St.Pool.Begin(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(c.Request.Context())
	var likes, favorites, uses int
	active := true
	if body.Action == "use" {
		likes, favorites, uses, err = store.RecordPromptUse(c.Request.Context(), tx, user.ID, promptID)
	} else {
		active = body.Active == nil || *body.Active
		likes, favorites, uses, err = store.SetPromptReaction(c.Request.Context(), tx, user.ID, promptID, body.Action, active)
	}
	if err != nil {
		fail(c, err)
		return
	}
	if err := tx.Commit(c.Request.Context()); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{
		"action": body.Action, "active": active,
		"likeCount": likes, "favoriteCount": favorites, "useCount": uses,
	})
}

// ---------- 提示词库（管理） ----------

func (s *Server) adminListPrompts(c *gin.Context, _ *store.User) {
	taskType := c.Query("type")
	if taskType != "" && !store.Contains(store.PromptTaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	status := c.Query("status")
	if status != "" && status != "enabled" && status != "disabled" && status != "missing-cover" {
		fail(c, apperr.E("validation_error", "无效的状态筛选", 422))
		return
	}
	order := c.DefaultQuery("sort", "manual")
	if order != "manual" && order != "recommended" && order != "latest" && order != "favorites" && order != "likes" && order != "usage" {
		fail(c, apperr.E("validation_error", "无效的提示词排序", 422))
		return
	}
	source := c.Query("source")
	if source != "" && source != "synced" && source != "local" {
		fail(c, apperr.E("validation_error", "无效的来源筛选", 422))
		return
	}
	tags := normalizePromptQueryTags(c.QueryArray("tag"))
	if len(tags) > 20 {
		fail(c, apperr.E("validation_error", "tag: 最多允许 20 项", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	filter := store.PromptFilter{
		TaskType: taskType,
		Category: c.Query("category"),
		Search:   c.Query("search"),
		Status:   status,
		Source:   source,
		Tags:     tags,
		Order:    order,
	}
	rows, err := store.ListPromptEntries(c.Request.Context(), s.St.Pool, filter, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountPromptEntries(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	scopeFilter := filter
	scopeFilter.Search = ""
	scopeTotal, err := store.CountPromptEntries(c.Request.Context(), s.St.Pool, scopeFilter)
	if err != nil {
		fail(c, err)
		return
	}
	categoryCounts, err := store.CountPromptEntriesByCategory(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	tagScope := filter
	tagScope.Tags = nil
	promptTags, err := store.ListPromptTags(c.Request.Context(), s.St.Pool, tagScope)
	if err != nil {
		fail(c, err)
		return
	}
	page := buildPage(rows, limit, func(p *store.PromptEntry) gin.H {
		return promptDict(p, true)
	})
	page["total"] = total
	page["scopeTotal"] = scopeTotal
	page["categoryCounts"] = categoryCounts
	page["tags"] = promptTags
	ok(c, page)
}

type promptIn struct {
	Title         string   `json:"title"`
	Prompt        string   `json:"prompt"`
	TaskType      string   `json:"taskType"`
	Category      *string  `json:"category"`
	Tags          []string `json:"tags"`
	Sort          *int     `json:"sort"`
	LikeCount     *int     `json:"likeCount"`
	FavoriteCount *int     `json:"favoriteCount"`
	UseCount      *int     `json:"useCount"`
	Active        *bool    `json:"active"`
}

func promptMetricValue(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func validatePromptFields(title, prompt, taskType string, category *string, tags []string) error {
	if title == "" || len([]rune(title)) > 200 {
		return apperr.E("validation_error", "title: 长度须在 1-200 之间", 422)
	}
	if prompt == "" || len([]rune(prompt)) > 10000 {
		return apperr.E("validation_error", "prompt: 长度须在 1-10000 之间", 422)
	}
	if !store.Contains(store.PromptTaskTypes, taskType) {
		return apperr.E("validation_error", "taskType: 无效的任务类型", 422)
	}
	if category != nil && len([]rune(*category)) > 64 {
		return apperr.E("validation_error", "category: 长度不能超过 64", 422)
	}
	if len(tags) > 20 {
		return apperr.E("validation_error", "tags: 数量不能超过 20", 422)
	}
	for _, tag := range tags {
		if tag == "" || len([]rune(tag)) > 64 {
			return apperr.E("validation_error", "tags: 每项长度须在 1-64 之间", 422)
		}
	}
	return nil
}

func (s *Server) adminCreatePrompt(c *gin.Context, _ *store.User) {
	var body promptIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := validatePromptFields(body.Title, body.Prompt, body.TaskType, body.Category, body.Tags); err != nil {
		fail(c, err)
		return
	}
	if err := validatePromptCategoryReference(c.Request.Context(), s.St.Pool, body.Category); err != nil {
		fail(c, err)
		return
	}
	sortVal := 0
	if body.Sort != nil {
		sortVal = *body.Sort
	} else {
		maxSort, err := store.MaxPromptSort(c.Request.Context(), s.St.Pool)
		if err != nil {
			fail(c, err)
			return
		}
		sortVal = maxSort + 10
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	if (body.LikeCount != nil && *body.LikeCount < 0) ||
		(body.FavoriteCount != nil && *body.FavoriteCount < 0) ||
		(body.UseCount != nil && *body.UseCount < 0) {
		fail(c, apperr.E("validation_error", "热度数据不能小于 0", 422))
		return
	}
	entry, err := store.InsertPromptEntry(c.Request.Context(), s.St.Pool, &store.PromptEntry{
		Title: body.Title, Prompt: body.Prompt, TaskType: body.TaskType, Category: body.Category,
		Tags: body.Tags, Sort: sortVal, LikeCount: promptMetricValue(body.LikeCount),
		FavoriteCount: promptMetricValue(body.FavoriteCount), UseCount: promptMetricValue(body.UseCount), Active: active,
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, promptDict(entry, true))
}

type galleryPromptIn struct {
	Title      string   `json:"title"`
	Prompt     string   `json:"prompt"`
	TaskType   string   `json:"taskType"`
	Category   *string  `json:"category"`
	Tags       []string `json:"tags"`
	Active     *bool    `json:"active"`
	MediaIndex int      `json:"mediaIndex"`
}

// adminCreatePromptFromSubmission converts an approved gallery image into an
// independent prompt entry. Its cover is copied so later gallery changes do
// not break the prompt library.
func (s *Server) adminCreatePromptFromSubmission(c *gin.Context, _ *store.User) {
	submissionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body galleryPromptIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	submission, err := store.GetSubmission(ctx, s.St.Pool, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	if submission == nil {
		fail(c, apperr.E("not_found", "投稿不存在", 404))
		return
	}
	if submission.Status != "approved" {
		fail(c, apperr.E("submission_not_approved", "只有审核通过的图片才能加入提示词库", 409))
		return
	}
	if existing, getErr := store.GetPromptEntryByGallerySubmission(ctx, s.St.Pool, submissionID); getErr != nil {
		fail(c, getErr)
		return
	} else if existing != nil {
		fail(c, apperr.E("prompt_already_exists", "这张审核图片已经加入提示词库", 409))
		return
	}
	body.Title = strings.TrimSpace(body.Title)
	body.Prompt = strings.TrimSpace(body.Prompt)
	body.TaskType = strings.TrimSpace(body.TaskType)
	if err := validatePromptFields(body.Title, body.Prompt, body.TaskType, body.Category, body.Tags); err != nil {
		fail(c, err)
		return
	}
	if err := validatePromptCategoryReference(c.Request.Context(), s.St.Pool, body.Category); err != nil {
		fail(c, err)
		return
	}
	mediaKeys := submission.MediaKeys
	if len(mediaKeys) == 0 && submission.CoverKey != nil && *submission.CoverKey != "" {
		mediaKeys = []string{*submission.CoverKey}
	}
	if body.MediaIndex < 0 || body.MediaIndex >= len(mediaKeys) {
		body.MediaIndex = 0
	}
	sourceKey := ""
	if task, taskErr := store.GetTask(ctx, s.St.Pool, submission.TaskID); taskErr != nil {
		fail(c, taskErr)
		return
	} else if task != nil && body.MediaIndex < len(task.ThumbnailKeys) {
		sourceKey = task.ThumbnailKeys[body.MediaIndex]
	}
	if len(mediaKeys) > 0 {
		if sourceKey == "" {
			sourceKey = mediaKeys[body.MediaIndex]
		}
	}
	if body.MediaIndex == 0 && submission.CoverKey != nil && *submission.CoverKey != "" {
		sourceKey = *submission.CoverKey
	}
	if sourceKey == "" {
		fail(c, apperr.E("media_not_found", "投稿没有可用图片", 409))
		return
	}
	data, err := s.Storage.GetBytesLimit(ctx, sourceKey, promptCoverMaxBytes)
	if err != nil {
		fail(c, apperr.E("media_unavailable", "审核图片读取失败，请稍后重试", 502))
		return
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "审核图片格式不支持", 400))
		return
	}
	// 封面是纯展示素材：按后台图片配置压缩后落库，页面加载更快。
	data, ext, contentType = s.compressCoverImage(ctx, data, ext, contentType)
	coverWidth, coverHeight, err := media.Dimensions(data)
	if err != nil {
		fail(c, apperr.E("unsupported_file", "审核图片尺寸过大或内容无法读取", 400))
		return
	}
	maxSort, err := store.MaxPromptSort(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	entry := &store.PromptEntry{
		ID: uuid.New(), Title: body.Title, Prompt: body.Prompt, TaskType: body.TaskType,
		Category: body.Category, Tags: body.Tags, GallerySubmissionID: &submissionID,
		Sort: maxSort + 10, Active: active,
	}
	coverKey := fmt.Sprintf("prompt-covers/%s.%s", entry.ID, ext)
	if err := s.Storage.UploadBytes(ctx, coverKey, data, contentType); err != nil {
		fail(c, err)
		return
	}
	created, err := store.InsertPromptEntry(ctx, s.St.Pool, entry)
	if err != nil {
		_ = s.Storage.DeleteKeys(ctx, []string{coverKey})
		fail(c, err)
		return
	}
	if err := store.UpdatePromptCover(ctx, s.St.Pool, created.ID, coverKey, coverWidth, coverHeight); err != nil {
		_ = store.DeletePromptEntry(ctx, s.St.Pool, created.ID)
		_ = s.Storage.DeleteKeys(ctx, []string{coverKey})
		fail(c, err)
		return
	}
	created.CoverKey = &coverKey
	created.CoverWidth = &coverWidth
	created.CoverHeight = &coverHeight
	respondCreated(c, promptDict(created, true))
}

type reorderPromptsIn struct {
	IDs []string `json:"ids"`
}

type movePromptIn struct {
	Position int    `json:"position"`
	TaskType string `json:"taskType"`
	Category string `json:"category"`
	Status   string `json:"status"`
}

func validatePromptSortScope(taskType, status string) error {
	if taskType != "" && !store.Contains(store.PromptTaskTypes, taskType) {
		return apperr.E("validation_error", "taskType: 无效的任务类型", 422)
	}
	if status != "" && status != "enabled" && status != "disabled" && status != "missing-cover" {
		return apperr.E("validation_error", "status: 无效的状态筛选", 422)
	}
	return nil
}

func (s *Server) adminPromptPosition(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	taskType, status := c.Query("type"), c.Query("status")
	if err := validatePromptSortScope(taskType, status); err != nil {
		fail(c, err)
		return
	}
	position, count, found, err := store.PromptEntryPosition(c.Request.Context(), s.St.Pool, entryID, store.PromptFilter{
		TaskType: taskType, Category: c.Query("category"), Status: status,
	})
	if err != nil {
		fail(c, err)
		return
	}
	if !found {
		fail(c, apperr.E("not_found", "提示词不在当前排序范围内", 404))
		return
	}
	ok(c, gin.H{"position": position, "count": count})
}

func (s *Server) adminMovePrompt(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body movePromptIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Position < 1 {
		fail(c, apperr.E("validation_error", "position: 必须大于 0", 422))
		return
	}
	if err := validatePromptSortScope(body.TaskType, body.Status); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	tx, err := s.St.Pool.Begin(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx)
	count, found, err := store.MovePromptEntry(ctx, tx, entryID, body.Position, store.PromptFilter{
		TaskType: body.TaskType, Category: body.Category, Status: body.Status,
	})
	if err != nil {
		fail(c, err)
		return
	}
	if !found {
		fail(c, apperr.E("not_found", "提示词不在当前排序范围内", 404))
		return
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, err)
		return
	}
	position := body.Position
	if position > count {
		position = count
	}
	ok(c, gin.H{"position": position, "count": count})
}

func (s *Server) adminReorderPrompts(c *gin.Context, _ *store.User) {
	var body reorderPromptsIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 2000 {
		fail(c, apperr.E("validation_error", "ids: 数量须在 1-2000 之间", 422))
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
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error { return store.ReorderPromptEntries(ctx, tx, ids) }); err != nil {
		fail(c, apperr.E("prompt_reorder_failed", "提示词排序保存失败，请刷新后重试", 409))
		return
	}
	ok(c, gin.H{"updated": len(ids)})
}

type promptPatchIn struct {
	Title         Opt[string]   `json:"title"`
	Prompt        Opt[string]   `json:"prompt"`
	TaskType      Opt[string]   `json:"taskType"`
	Category      Opt[string]   `json:"category"`
	Tags          Opt[[]string] `json:"tags"`
	Sort          Opt[int]      `json:"sort"`
	LikeCount     Opt[int]      `json:"likeCount"`
	FavoriteCount Opt[int]      `json:"favoriteCount"`
	UseCount      Opt[int]      `json:"useCount"`
	Active        Opt[bool]     `json:"active"`
}

func (s *Server) adminPatchPrompt(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body promptPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	entry, err := store.GetPromptEntry(ctx, s.St.Pool, entryID)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil {
		fail(c, apperr.E("not_found", "提示词不存在", 404))
		return
	}
	if body.Title.Valid {
		entry.Title = body.Title.Value
	}
	if body.Prompt.Valid {
		entry.Prompt = body.Prompt.Value
	}
	if body.TaskType.Valid {
		entry.TaskType = body.TaskType.Value
	}
	if body.Category.Set {
		entry.Category = body.Category.Ptr()
	}
	if body.Tags.Valid {
		entry.Tags = body.Tags.Value
	}
	if body.Sort.Valid {
		entry.Sort = body.Sort.Value
	}
	if body.LikeCount.Valid {
		entry.LikeCount = body.LikeCount.Value
	}
	if body.FavoriteCount.Valid {
		entry.FavoriteCount = body.FavoriteCount.Value
	}
	if body.UseCount.Valid {
		entry.UseCount = body.UseCount.Value
	}
	if body.Active.Valid {
		entry.Active = body.Active.Value
	}
	if err := validatePromptFields(entry.Title, entry.Prompt, entry.TaskType, entry.Category, entry.Tags); err != nil {
		fail(c, err)
		return
	}
	if err := validatePromptCategoryReference(ctx, s.St.Pool, entry.Category); err != nil {
		fail(c, err)
		return
	}
	if entry.LikeCount < 0 || entry.FavoriteCount < 0 || entry.UseCount < 0 {
		fail(c, apperr.E("validation_error", "热度数据不能小于 0", 422))
		return
	}
	if err := store.UpdatePromptEntry(ctx, s.St.Pool, entry); err != nil {
		fail(c, err)
		return
	}
	ok(c, promptDict(entry, true))
}

func (s *Server) adminDeletePrompt(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	entry, err := store.GetPromptEntry(ctx, s.St.Pool, entryID)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil {
		fail(c, apperr.E("not_found", "提示词不存在", 404))
		return
	}
	if err := store.DeletePromptEntry(ctx, s.St.Pool, entryID); err != nil {
		fail(c, err)
		return
	}
	if entry.CoverKey != nil && *entry.CoverKey != "" {
		if derr := s.Storage.DeleteKeys(ctx, []string{*entry.CoverKey}); derr != nil {
			log.Printf("delete prompt cover %s: %v", *entry.CoverKey, derr)
		}
	}
	respondNoContent(c)
}

func (s *Server) adminUploadPromptCover(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	entry, err := store.GetPromptEntry(ctx, s.St.Pool, entryID)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil {
		fail(c, apperr.E("not_found", "提示词不存在", 404))
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		log.Printf("prompt cover multipart parse failed: path=%s content_length=%d body_limit=%d err=%v",
			c.Request.URL.Path, c.Request.ContentLength,
			requestBodyLimit(c.Request.URL.Path, s.Cfg.UploadMaxBytes), err)
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || errors.Is(err, multipart.ErrMessageTooLarge) {
			fail(c, apperr.E("upload_too_large", "封面不能超过 8MB", 413))
			return
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			fail(c, apperr.E("invalid_upload", "图片上传数据不完整，请重新选择后重试", 400))
			return
		}
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", 422))
		return
	}
	if fileHeader.Size > promptCoverMaxBytes {
		log.Printf("prompt cover file too large: path=%s file_size=%d max=%d",
			c.Request.URL.Path, fileHeader.Size, promptCoverMaxBytes)
		fail(c, apperr.E("upload_too_large", "封面不能超过 8MB", 413))
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, promptCoverMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	if int64(len(data)) > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "封面不能超过 8MB", 413))
		return
	}
	if len(data) == 0 {
		fail(c, apperr.E("unsupported_file", "文件为空", 400))
		return
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", 400))
		return
	}
	// 封面是纯展示素材：按后台图片配置压缩后落库。
	data, ext, contentType = s.compressCoverImage(ctx, data, ext, contentType)
	coverWidth, coverHeight, err := media.Dimensions(data)
	if err != nil {
		fail(c, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", 400))
		return
	}
	newKey := fmt.Sprintf("prompt-covers/%s.%s", entry.ID, ext)
	oldKey := ""
	if entry.CoverKey != nil {
		oldKey = *entry.CoverKey
	}
	// 先上传并更新数据库，避免新图上传失败时把仍在使用的旧封面删掉。
	if err := s.Storage.UploadBytes(ctx, newKey, data, contentType); err != nil {
		fail(c, err)
		return
	}
	if err := store.UpdatePromptCover(ctx, s.St.Pool, entry.ID, newKey, coverWidth, coverHeight); err != nil {
		if newKey != oldKey {
			_ = s.Storage.DeleteKeys(ctx, []string{newKey})
		}
		fail(c, err)
		return
	}
	if oldKey != "" && oldKey != newKey && !strings.HasPrefix(oldKey, "http://") && !strings.HasPrefix(oldKey, "https://") {
		if derr := s.Storage.DeleteKeys(ctx, []string{oldKey}); derr != nil {
			log.Printf("delete old prompt cover %s: %v", oldKey, derr)
		}
	}
	ok(c, gin.H{
		"coverUrl":    "/api/v1/files/" + newKey,
		"coverWidth":  coverWidth,
		"coverHeight": coverHeight,
	})
}

// ---------- 画廊分类（管理） ----------

func (s *Server) adminGalleryCategories(c *gin.Context, _ *store.User) {
	rows, err := store.ListGalleryCategories(c.Request.Context(), s.St.Pool, false)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, cat := range rows {
		items = append(items, galleryCategoryDict(cat))
	}
	ok(c, gin.H{"items": items})
}

type galleryCategoryIn struct {
	Name   string `json:"name"`
	Sort   *int   `json:"sort"`
	Active *bool  `json:"active"`
}

func (s *Server) adminCreateGalleryCategory(c *gin.Context, _ *store.User) {
	var body galleryCategoryIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Name == "" || len([]rune(body.Name)) > 64 {
		fail(c, apperr.E("validation_error", "name: 长度须在 1-64 之间", 422))
		return
	}
	sortVal := 0
	if body.Sort != nil {
		sortVal = *body.Sort
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	category, err := store.InsertGalleryCategory(c.Request.Context(), s.St.Pool, body.Name, sortVal, active)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, galleryCategoryDict(category))
}

type galleryCategoryPatchIn struct {
	Name   Opt[string] `json:"name"`
	Sort   Opt[int]    `json:"sort"`
	Active Opt[bool]   `json:"active"`
}

func (s *Server) adminPatchGalleryCategory(c *gin.Context, _ *store.User) {
	categoryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body galleryCategoryPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Name.Valid && (body.Name.Value == "" || len([]rune(body.Name.Value)) > 64) {
		fail(c, apperr.E("validation_error", "name: 长度须在 1-64 之间", 422))
		return
	}
	ctx := c.Request.Context()
	category, err := store.GetGalleryCategory(ctx, s.St.Pool, categoryID)
	if err != nil {
		fail(c, err)
		return
	}
	if category == nil {
		fail(c, apperr.E("not_found", "分类不存在", 404))
		return
	}
	if body.Name.Valid {
		category.Name = body.Name.Value
	}
	if body.Sort.Valid {
		category.Sort = body.Sort.Value
	}
	if body.Active.Valid {
		category.Active = body.Active.Value
	}
	if err := store.UpdateGalleryCategory(ctx, s.St.Pool, category); err != nil {
		fail(c, err)
		return
	}
	ok(c, galleryCategoryDict(category))
}

func (s *Server) adminDeleteGalleryCategory(c *gin.Context, _ *store.User) {
	categoryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	category, err := store.GetGalleryCategory(ctx, s.St.Pool, categoryID)
	if err != nil {
		fail(c, err)
		return
	}
	if category == nil {
		fail(c, apperr.E("not_found", "分类不存在", 404))
		return
	}
	if err := store.DeleteGalleryCategory(ctx, s.St.Pool, categoryID); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}

// ---------- 策展 ----------

type curateIn struct {
	Featured Opt[bool]     `json:"featured"`
	Category Opt[string]   `json:"categoryId"`
	Sort     Opt[int]      `json:"sort"`
	Tags     Opt[[]string] `json:"tags"`
}

func normalizeSubmissionTags(tags []string) ([]string, error) {
	if len(tags) > 20 {
		return nil, apperr.E("validation_error", "tags: 数量不能超过 20", 422)
	}
	out := make([]string, 0, len(tags))
	seen := make(map[string]bool, len(tags))
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if tag == "" || len([]rune(tag)) > 32 {
			return nil, apperr.E("validation_error", "tags: 每项长度须在 1-32 之间", 422)
		}
		key := strings.ToLower(tag)
		if !seen[key] {
			seen[key] = true
			out = append(out, tag)
		}
	}
	return out, nil
}

func (s *Server) resolveGalleryCategory(ctx context.Context, body Opt[string]) (*uuid.UUID, error) {
	if !body.Valid {
		return nil, nil
	}
	parsed, err := uuid.Parse(body.Value)
	if err != nil {
		return nil, apperr.E("validation_error", "categoryId: 无效的 UUID", 422)
	}
	category, err := store.GetGalleryCategory(ctx, s.St.Pool, parsed)
	if err != nil {
		return nil, err
	}
	if category == nil {
		return nil, apperr.E("validation_error", "categoryId: 分类不存在", 422)
	}
	return &parsed, nil
}

func (s *Server) adminCurateSubmission(c *gin.Context, _ *store.User) {
	submissionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body curateIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	submission, err := store.GetSubmission(ctx, s.St.Pool, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	if submission == nil {
		fail(c, apperr.E("not_found", "投稿不存在", 404))
		return
	}
	categoryID, err := s.resolveGalleryCategory(ctx, body.Category)
	if err != nil {
		fail(c, err)
		return
	}
	var tags []string
	if body.Tags.Set {
		tags, err = normalizeSubmissionTags(body.Tags.Value)
		if err != nil {
			fail(c, err)
			return
		}
	}
	if err := store.CurateSubmission(ctx, s.St.Pool, submissionID,
		body.Featured.Ptr(), body.Category.Set, categoryID, body.Sort.Ptr(), body.Tags.Set, tags); err != nil {
		fail(c, err)
		return
	}
	updated, err := store.GetSubmission(ctx, s.St.Pool, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, submissionDict(updated, nil))
}

type batchCurateIn struct {
	IDs      []string      `json:"ids"`
	Featured Opt[bool]     `json:"featured"`
	Category Opt[string]   `json:"categoryId"`
	Tags     Opt[[]string] `json:"tags"`
	TagMode  string        `json:"tagMode"`
}

func mergeSubmissionTags(current, changed []string, mode string) []string {
	if mode == "replace" {
		return changed
	}
	changedSet := make(map[string]bool, len(changed))
	for _, tag := range changed {
		changedSet[strings.ToLower(tag)] = true
	}
	out := make([]string, 0, len(current)+len(changed))
	seen := map[string]bool{}
	for _, tag := range current {
		key := strings.ToLower(tag)
		if mode == "remove" && changedSet[key] {
			continue
		}
		if !seen[key] {
			seen[key] = true
			out = append(out, tag)
		}
	}
	if mode == "add" {
		for _, tag := range changed {
			key := strings.ToLower(tag)
			if !seen[key] {
				seen[key] = true
				out = append(out, tag)
			}
		}
	}
	return out
}

func parseSubmissionIDs(raw []string) ([]uuid.UUID, error) {
	if len(raw) == 0 || len(raw) > 100 {
		return nil, apperr.E("validation_error", "ids: 数量须在 1-100 之间", 422)
	}
	ids := make([]uuid.UUID, 0, len(raw))
	seen := map[uuid.UUID]bool{}
	for _, value := range raw {
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, apperr.E("validation_error", "ids: 包含无效的 UUID", 422)
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (s *Server) adminBatchCurateSubmissions(c *gin.Context, _ *store.User) {
	var body batchCurateIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ids, err := parseSubmissionIDs(body.IDs)
	if err != nil {
		fail(c, err)
		return
	}
	if !body.Featured.Set && !body.Category.Set && !body.Tags.Set {
		fail(c, apperr.E("validation_error", "至少选择一项要更新的内容", 422))
		return
	}
	mode := body.TagMode
	if mode == "" {
		mode = "replace"
	}
	if mode != "replace" && mode != "add" && mode != "remove" {
		fail(c, apperr.E("validation_error", "tagMode: 仅支持 replace、add、remove", 422))
		return
	}
	ctx := c.Request.Context()
	categoryID, err := s.resolveGalleryCategory(ctx, body.Category)
	if err != nil {
		fail(c, err)
		return
	}
	var changedTags []string
	if body.Tags.Set {
		changedTags, err = normalizeSubmissionTags(body.Tags.Value)
		if err != nil {
			fail(c, err)
			return
		}
	}
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		for _, id := range ids {
			submission, err := store.GetSubmission(ctx, tx, id)
			if err != nil {
				return err
			}
			if submission == nil {
				return apperr.E("not_found", "投稿不存在", 404)
			}
			var tags []string
			if body.Tags.Set {
				tags = mergeSubmissionTags(submission.Tags, changedTags, mode)
				if len(tags) > 20 {
					return apperr.E("validation_error", "tags: 合并后数量不能超过 20", 422)
				}
			}
			if err := store.CurateSubmission(ctx, tx, id, body.Featured.Ptr(), body.Category.Set,
				categoryID, nil, body.Tags.Set, tags); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"updated": len(ids)})
}

type reorderSubmissionsIn struct {
	IDs []string `json:"ids"`
}

func (s *Server) adminReorderSubmissions(c *gin.Context, _ *store.User) {
	var body reorderSubmissionsIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ids, err := parseSubmissionIDs(body.IDs)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		for index, id := range ids {
			submission, err := store.GetSubmission(ctx, tx, id)
			if err != nil {
				return err
			}
			if submission == nil {
				return apperr.E("not_found", "投稿不存在", 404)
			}
			sort := (index + 1) * 10
			if err := store.CurateSubmission(ctx, tx, id, nil, false, nil, &sort, false, nil); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"updated": len(ids)})
}

// ---------- 画廊设置 ----------

func (s *Server) gallerySettingsOut(c *gin.Context) (gin.H, error) {
	ctx := c.Request.Context()
	enabled, err := settings.GetBool(ctx, s.St.Pool, "submission_enabled")
	if err != nil {
		return nil, err
	}
	autoApprove, err := settings.GetBool(ctx, s.St.Pool, "auto_approve")
	if err != nil {
		return nil, err
	}
	dailyLimit, err := settings.GetInt(ctx, s.St.Pool, "daily_limit")
	if err != nil {
		return nil, err
	}
	return gin.H{"submissionEnabled": enabled, "autoApprove": autoApprove, "dailyLimit": dailyLimit}, nil
}

func (s *Server) adminGetGallerySettings(c *gin.Context, _ *store.User) {
	out, err := s.gallerySettingsOut(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

type gallerySettingsIn struct {
	SubmissionEnabled Opt[bool]  `json:"submissionEnabled"`
	AutoApprove       Opt[bool]  `json:"autoApprove"`
	DailyLimit        Opt[int64] `json:"dailyLimit"`
}

func (s *Server) adminPutGallerySettings(c *gin.Context, _ *store.User) {
	var body gallerySettingsIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.DailyLimit.Valid && body.DailyLimit.Value < 0 {
		fail(c, apperr.E("validation_error", "dailyLimit: 须为非负整数", 422))
		return
	}
	updates := map[string]json.RawMessage{}
	if body.SubmissionEnabled.Valid {
		updates["submission_enabled"], _ = json.Marshal(body.SubmissionEnabled.Value)
	}
	if body.AutoApprove.Valid {
		updates["auto_approve"], _ = json.Marshal(body.AutoApprove.Value)
	}
	if body.DailyLimit.Valid {
		updates["daily_limit"], _ = json.Marshal(body.DailyLimit.Value)
	}
	ctx := c.Request.Context()
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		for key, value := range updates {
			if terr := settings.Set(ctx, tx, key, value); terr != nil {
				return terr
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	out, err := s.gallerySettingsOut(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

// ---------- 创作者聚合 ----------

func (s *Server) adminGalleryAuthors(c *gin.Context, _ *store.User) {
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListGalleryAuthors(c.Request.Context(), s.St.Pool, c.Query("search"), limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(a *store.GalleryAuthor) gin.H {
		return gin.H{
			"userId":      a.UserID.String(),
			"email":       a.Email,
			"username":    a.Username,
			"avatarUrl":   a.AvatarURL,
			"submissions": a.Submissions,
			"approved":    a.Approved,
			"removed":     a.Removed,
			"bannedUntil": iso(a.BannedUntil),
		}
	}))
}

// ---------- 违规下架 / 解禁 ----------

type violationIn struct {
	Reason      string `json:"reason"`
	BanDays     *int   `json:"banDays"`
	DeleteMedia bool   `json:"deleteMedia"`
}

func (s *Server) adminSubmissionViolation(c *gin.Context, admin *store.User) {
	submissionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body violationIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Reason == "" || len([]rune(body.Reason)) > 500 {
		fail(c, apperr.E("validation_error", "reason: 长度须在 1-500 之间", 422))
		return
	}
	banDays := 0
	if body.BanDays != nil {
		banDays = *body.BanDays
	}
	if banDays < 0 || banDays > 365 {
		fail(c, apperr.E("validation_error", "banDays: 须在 0-365 之间", 422))
		return
	}
	ctx := c.Request.Context()
	submission, err := store.GetSubmission(ctx, s.St.Pool, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	if submission == nil {
		fail(c, apperr.E("not_found", "投稿不存在", 404))
		return
	}
	now := time.Now().UTC()
	var bannedUntil *time.Time
	if banDays > 0 {
		until := now.AddDate(0, 0, banDays)
		bannedUntil = &until
	}
	title := ""
	if submission.Title != nil {
		title = *submission.Title
	}
	notifyBody := fmt.Sprintf("你的投稿「%s」因违规已被下架。原因：%s", title, body.Reason)
	if bannedUntil != nil {
		notifyBody += fmt.Sprintf("；投稿功能已被禁用至 %s", isoValue(*bannedUntil))
	}

	reason := body.Reason
	var removed bool
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		var terr error
		removed, terr = store.MarkSubmissionRemoved(ctx, tx, submission.ID, &reason, admin.ID, now)
		if terr != nil {
			return terr
		}
		if bannedUntil != nil {
			if terr = store.UpdateSubmissionBan(ctx, tx, submission.UserID, bannedUntil); terr != nil {
				return terr
			}
		}
		if removed {
			return store.InsertNotification(ctx, tx, &submission.UserID, "system", "投稿违规处理", &notifyBody)
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}

	// 删除 R2 媒体对象（共用 key，任务产物同时失效——旧版语义，不动 tasks.output_keys 记录）
	deletedMedia := false
	if body.DeleteMedia {
		keys := map[string]bool{}
		for _, k := range submission.MediaKeys {
			keys[k] = true
		}
		if submission.CoverKey != nil && *submission.CoverKey != "" {
			keys[*submission.CoverKey] = true
		}
		list := make([]string, 0, len(keys))
		for k := range keys {
			list = append(list, k)
		}
		if len(list) > 0 {
			if derr := s.Storage.DeleteKeys(ctx, list); derr != nil {
				log.Printf("violation delete media for submission %s: %v", submission.ID, derr)
			} else {
				deletedMedia = true
			}
		}
	}

	submission.Status = "removed"
	submission.RejectReason = &reason
	submission.ReviewedBy = &admin.ID
	submission.ReviewedAt = &now
	out := submissionDict(submission, nil)
	out["bannedUntil"] = iso(bannedUntil)
	out["deletedMedia"] = deletedMedia
	respondCreated(c, out)
}

func (s *Server) adminUnbanGalleryUser(c *gin.Context, _ *store.User) {
	userID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByID(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil {
		fail(c, apperr.E("not_found", "用户不存在", 404))
		return
	}
	if err := store.UpdateSubmissionBan(ctx, s.St.Pool, userID, nil); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}
