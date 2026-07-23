package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// presignSafe 保留旧调用签名，但返回站内文件地址。公开画廊的文件权限仍由
// getFile 中的 IsPublicGalleryKey 校验，客户端无需直接访问对象存储。
func (s *Server) presignSafe(c *gin.Context, key *string) *string {
	if key == nil || *key == "" {
		return nil
	}
	u := "/api/files/" + strings.TrimLeft(strings.TrimSpace(*key), "/")
	return &u
}

func (s *Server) mediaURLsFor(c *gin.Context, keys []string) []string {
	urls := make([]string, 0, len(keys))
	for _, k := range keys {
		key := k
		if u := s.presignSafe(c, &key); u != nil {
			urls = append(urls, *u)
		}
	}
	return urls
}

func (s *Server) publicGallery(c *gin.Context) {
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	filter := store.SubmissionFilter{Status: "approved"}
	if raw := c.Query("category"); raw != "" {
		categoryID, perr := uuid.Parse(raw)
		if perr != nil {
			fail(c, apperr.E("validation_error", "category: 无效的 UUID", 422))
			return
		}
		filter.CategoryID = &categoryID
	}
	if raw := c.Query("featured"); raw != "" {
		featured := raw == "1" || raw == "true"
		filter.Featured = &featured
	}
	ctx := c.Request.Context()
	rows, err := store.ListSubmissions(ctx, s.St.Pool, filter, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	userIDs := make([]uuid.UUID, 0, len(rows))
	for _, sub := range rows {
		userIDs = append(userIDs, sub.UserID)
	}
	users, err := store.GetUsersByIDs(ctx, s.St.Pool, userIDs)
	if err != nil {
		fail(c, err)
		return
	}
	categories, err := s.categoriesFor(ctx, rows)
	if err != nil {
		fail(c, err)
		return
	}

	ok(c, buildPage(rows, limit, func(sub *store.GallerySubmission) gin.H {
		author := users[sub.UserID]
		authorDict := gin.H{"id": nil, "username": nil, "avatarUrl": nil}
		if author != nil {
			authorDict = gin.H{"id": author.ID.String(), "username": author.Username, "avatarUrl": author.AvatarURL}
		}
		var categoryDict any
		if sub.CategoryID != nil {
			if cat := categories[*sub.CategoryID]; cat != nil {
				categoryDict = gin.H{"id": cat.ID.String(), "name": cat.Name}
			}
		}
		return gin.H{
			"id":        sub.ID.String(),
			"title":     sub.Title,
			"coverUrl":  s.presignSafe(c, sub.CoverKey),
			"mediaUrls": s.mediaURLsFor(c, sub.MediaKeys),
			"author":    authorDict,
			"featured":  sub.Featured,
			"category":  categoryDict,
			"tags":      nonNilStrings(sub.Tags),
			"createdAt": isoValue(sub.CreatedAt),
		}
	}))
}

// categoriesFor 批量取投稿引用的分类。
func (s *Server) categoriesFor(ctx context.Context, rows []*store.GallerySubmission) (map[uuid.UUID]*store.GalleryCategory, error) {
	out := map[uuid.UUID]*store.GalleryCategory{}
	for _, sub := range rows {
		if sub.CategoryID == nil {
			continue
		}
		if _, seen := out[*sub.CategoryID]; seen {
			continue
		}
		cat, err := store.GetGalleryCategory(ctx, s.St.Pool, *sub.CategoryID)
		if err != nil {
			return nil, err
		}
		out[*sub.CategoryID] = cat
	}
	return out, nil
}

// publicGalleryCategories 公开返回启用分类。
func (s *Server) publicGalleryCategories(c *gin.Context) {
	rows, err := store.ListGalleryCategories(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, cat := range rows {
		items = append(items, gin.H{"id": cat.ID.String(), "name": cat.Name, "sort": cat.Sort})
	}
	ok(c, gin.H{"items": items})
}

type gallerySubmitIn struct {
	TaskID     string  `json:"taskId"`
	Title      *string `json:"title"`
	CategoryID *string `json:"categoryId"`
}

func (s *Server) submitGallery(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body gallerySubmitIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	taskID, err := uuid.Parse(body.TaskID)
	if err != nil {
		fail(c, apperr.E("validation_error", "taskId: 无效的 UUID", 422))
		return
	}
	if body.Title != nil && len([]rune(*body.Title)) > 200 {
		fail(c, apperr.E("validation_error", "title: 长度不能超过 200", 422))
		return
	}
	ctx := c.Request.Context()
	now := time.Now().UTC()

	// 社区投稿门槛：禁投 → 总开关 → 每日限额
	if user.SubmissionBannedUntil != nil && user.SubmissionBannedUntil.After(now) {
		fail(c, apperr.E("submission_banned", "你已被禁止投稿，解禁时间："+isoValue(*user.SubmissionBannedUntil), 403))
		return
	}
	enabled, err := settings.GetBool(ctx, s.St.Pool, "submission_enabled")
	if err != nil {
		fail(c, err)
		return
	}
	if !enabled {
		fail(c, apperr.E("submission_disabled", "投稿功能已关闭", 403))
		return
	}
	dailyLimit, err := settings.GetInt(ctx, s.St.Pool, "daily_limit")
	if err != nil {
		fail(c, err)
		return
	}
	if dailyLimit > 0 {
		todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		count, cerr := store.CountSubmissionsByUserSince(ctx, s.St.Pool, user.ID, todayStart)
		if cerr != nil {
			fail(c, cerr)
			return
		}
		if count >= dailyLimit {
			fail(c, apperr.E("submission_daily_limit", "今日投稿数已达上限", 429))
			return
		}
	}

	var categoryID *uuid.UUID
	if body.CategoryID != nil && *body.CategoryID != "" {
		parsed, perr := uuid.Parse(*body.CategoryID)
		if perr != nil {
			fail(c, apperr.E("validation_error", "categoryId: 无效的 UUID", 422))
			return
		}
		category, gerr := store.GetGalleryCategory(ctx, s.St.Pool, parsed)
		if gerr != nil {
			fail(c, gerr)
			return
		}
		if category == nil || !category.Active {
			fail(c, apperr.E("validation_error", "categoryId: 分类不存在或未启用", 422))
			return
		}
		categoryID = &parsed
	}

	task, err := store.GetUserTask(ctx, s.St.Pool, user.ID, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if task == nil {
		fail(c, apperr.E("task_not_found", "任务不存在", 404))
		return
	}
	if task.Status != "succeeded" || len(task.OutputKeys) == 0 {
		fail(c, apperr.E("submission_not_allowed", "仅有产物的成功任务可以投稿", 400))
		return
	}
	existing, err := store.GetSubmissionByTaskID(ctx, s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("submission_not_allowed", "该任务已投稿过", 409))
		return
	}
	status := "pending"
	autoApprove, err := settings.GetBool(ctx, s.St.Pool, "auto_approve")
	if err != nil {
		fail(c, err)
		return
	}
	if autoApprove {
		status = "approved"
	}
	coverKey := task.OutputKeys[0]
	if len(task.ThumbnailKeys) > 0 {
		coverKey = task.ThumbnailKeys[0]
	}
	submission, err := store.InsertSubmission(ctx, s.St.Pool, user.ID, taskID, body.Title, &coverKey, task.OutputKeys, categoryID, status)
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("submission_not_allowed", "该任务已投稿过", 409))
			return
		}
		fail(c, err)
		return
	}
	ok(c, submissionDict(submission, nil))
}

func (s *Server) mySubmissions(c *gin.Context) {
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
	rows, err := store.ListSubmissions(c.Request.Context(), s.St.Pool, store.SubmissionFilter{UserID: &user.ID}, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(sub *store.GallerySubmission) gin.H {
		d := submissionDict(sub, s.mediaURLsFor(c, sub.MediaKeys))
		d["coverUrl"] = s.presignSafe(c, sub.CoverKey)
		return d
	}))
}

func (s *Server) deleteSubmission(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	submissionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	submission, err := store.GetUserSubmission(ctx, s.St.Pool, user.ID, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	if submission == nil {
		fail(c, apperr.E("not_found", "投稿不存在", 404))
		return
	}
	if err := store.DeleteSubmission(ctx, s.St.Pool, submission.ID); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}
