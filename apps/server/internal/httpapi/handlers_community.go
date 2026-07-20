// 社区运营接口（v3 增补）：提示词库、画廊分类、策展、画廊设置、
// 创作者聚合、违规下架/解禁。
package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// promptCoverMaxBytes 提示词封面上限 5MB。
const promptCoverMaxBytes = 5 * 1024 * 1024

// ---------- 提示词库（公开） ----------

func (s *Server) publicPrompts(c *gin.Context) {
	taskType := c.Query("type")
	if taskType != "" && !store.Contains(store.TaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListPromptEntries(c.Request.Context(), s.St.Pool,
		store.PromptFilter{TaskType: taskType, Category: c.Query("category"), ActiveOnly: true}, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(p *store.PromptEntry) gin.H {
		return promptDict(p, false)
	}))
}

// ---------- 提示词库（管理） ----------

func (s *Server) adminListPrompts(c *gin.Context, _ *store.User) {
	taskType := c.Query("type")
	if taskType != "" && !store.Contains(store.TaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListPromptEntries(c.Request.Context(), s.St.Pool,
		store.PromptFilter{TaskType: taskType, Category: c.Query("category"), Search: c.Query("search")}, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(p *store.PromptEntry) gin.H {
		return promptDict(p, true)
	}))
}

type promptIn struct {
	Title    string   `json:"title"`
	Prompt   string   `json:"prompt"`
	TaskType string   `json:"taskType"`
	Category *string  `json:"category"`
	Tags     []string `json:"tags"`
	Sort     *int     `json:"sort"`
	Active   *bool    `json:"active"`
}

func validatePromptFields(title, prompt, taskType string, category *string, tags []string) error {
	if title == "" || len([]rune(title)) > 200 {
		return apperr.E("validation_error", "title: 长度须在 1-200 之间", 422)
	}
	if prompt == "" || len([]rune(prompt)) > 10000 {
		return apperr.E("validation_error", "prompt: 长度须在 1-10000 之间", 422)
	}
	if !store.Contains(store.TaskTypes, taskType) {
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
	sortVal := 0
	if body.Sort != nil {
		sortVal = *body.Sort
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	entry, err := store.InsertPromptEntry(c.Request.Context(), s.St.Pool, &store.PromptEntry{
		Title:    body.Title,
		Prompt:   body.Prompt,
		TaskType: body.TaskType,
		Category: body.Category,
		Tags:     body.Tags,
		Sort:     sortVal,
		Active:   active,
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, promptDict(entry, true))
}

type promptPatchIn struct {
	Title    Opt[string]   `json:"title"`
	Prompt   Opt[string]   `json:"prompt"`
	TaskType Opt[string]   `json:"taskType"`
	Category Opt[string]   `json:"category"`
	Tags     Opt[[]string] `json:"tags"`
	Sort     Opt[int]      `json:"sort"`
	Active   Opt[bool]     `json:"active"`
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
	if body.Active.Valid {
		entry.Active = body.Active.Value
	}
	if err := validatePromptFields(entry.Title, entry.Prompt, entry.TaskType, entry.Category, entry.Tags); err != nil {
		fail(c, err)
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
	ok(c, gin.H{})
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
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", 422))
		return
	}
	if fileHeader.Size > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "封面不能超过 5MB", 413))
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
		fail(c, apperr.E("upload_too_large", "封面不能超过 5MB", 413))
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
	newKey := fmt.Sprintf("prompt-covers/%s.%s", entry.ID, ext)
	// 覆盖旧封面：先删再传（扩展名可能变化，旧 key 不一定等于新 key）
	if entry.CoverKey != nil && *entry.CoverKey != "" {
		if derr := s.Storage.DeleteKeys(ctx, []string{*entry.CoverKey}); derr != nil {
			log.Printf("delete old prompt cover %s: %v", *entry.CoverKey, derr)
		}
	}
	if err := s.Storage.UploadBytes(ctx, newKey, data, contentType); err != nil {
		fail(c, err)
		return
	}
	if err := store.UpdatePromptCoverKey(ctx, s.St.Pool, entry.ID, newKey); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"coverUrl": "/api/files/" + newKey})
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
	ok(c, galleryCategoryDict(category))
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
	ok(c, gin.H{})
}

// ---------- 策展 ----------

type curateIn struct {
	Featured Opt[bool]   `json:"featured"`
	Category Opt[string] `json:"categoryId"`
	Sort     Opt[int]    `json:"sort"`
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
	var categoryID *uuid.UUID
	if body.Category.Valid {
		parsed, perr := uuid.Parse(body.Category.Value)
		if perr != nil {
			fail(c, apperr.E("validation_error", "categoryId: 无效的 UUID", 422))
			return
		}
		category, gerr := store.GetGalleryCategory(ctx, s.St.Pool, parsed)
		if gerr != nil {
			fail(c, gerr)
			return
		}
		if category == nil {
			fail(c, apperr.E("validation_error", "categoryId: 分类不存在", 422))
			return
		}
		categoryID = &parsed
	}
	if err := store.CurateSubmission(ctx, s.St.Pool, submissionID,
		body.Featured.Ptr(), body.Category.Set, categoryID, body.Sort.Ptr()); err != nil {
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
	ok(c, out)
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
	ok(c, gin.H{"userId": userID.String(), "bannedUntil": nil})
}
