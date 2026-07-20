// 提示词库数据源（v4）：源 CRUD 与手动同步。
package httpapi

import (
	"errors"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/promptsync"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func promptSourceDict(s *store.PromptSource) gin.H {
	return gin.H{
		"id":                  s.ID,
		"name":                s.Name,
		"url":                 s.SourceURL,
		"format":              s.Format,
		"taskType":            s.TaskType,
		"defaultTags":         nonNilStrings(s.DefaultTags),
		"enabled":             s.Enabled,
		"autoSyncEnabled":     s.AutoSyncEnabled,
		"syncIntervalMinutes": s.SyncIntervalMinutes,
		"nextSyncAt":          iso(s.NextSyncAt),
		"itemCount":           s.ItemCount,
		"lastSyncedAt":        iso(s.LastSyncedAt),
		"lastSyncDurationMs":  s.LastSyncDurationMs,
		"lastError":           s.LastError,
		"createdAt":           isoValue(s.CreatedAt),
	}
}

func validPromptSourceURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != ""
}

func clampSyncInterval(minutes int) int {
	if minutes < 15 {
		return 15
	}
	if minutes > 10080 {
		return 10080
	}
	return minutes
}

func validatePromptSourceFields(s *store.PromptSource) error {
	if s.Name == "" || len([]rune(s.Name)) > 100 {
		return apperr.E("validation_error", "name: 长度须在 1-100 之间", 422)
	}
	if !validPromptSourceURL(s.SourceURL) {
		return apperr.E("validation_error", "sourceUrl: 请输入有效的 HTTPS 地址", 422)
	}
	if !store.Contains(store.PromptSourceFormats, s.Format) {
		return apperr.E("validation_error", "format: 须为 json / markdown / html", 422)
	}
	if !store.Contains(store.TaskTypes, s.TaskType) {
		return apperr.E("validation_error", "taskType: 无效的任务类型", 422)
	}
	if len(s.DefaultTags) > 12 {
		return apperr.E("validation_error", "defaultTags: 数量不能超过 12", 422)
	}
	for _, tag := range s.DefaultTags {
		if tag == "" || len([]rune(tag)) > 32 {
			return apperr.E("validation_error", "defaultTags: 每项长度须在 1-32 之间", 422)
		}
	}
	return nil
}

func (s *Server) adminListPromptSources(c *gin.Context, _ *store.User) {
	rows, err := store.ListPromptSources(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, src := range rows {
		items = append(items, promptSourceDict(src))
	}
	ok(c, gin.H{"items": items})
}

type promptSourceIn struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	SourceURL           string   `json:"sourceUrl"`
	Format              string   `json:"format"`
	TaskType            string   `json:"taskType"`
	DefaultTags         []string `json:"defaultTags"`
	SyncIntervalMinutes *int     `json:"syncIntervalMinutes"`
	Enabled             *bool    `json:"enabled"`
	AutoSyncEnabled     *bool    `json:"autoSyncEnabled"`
}

func (s *Server) adminCreatePromptSource(c *gin.Context, _ *store.User) {
	var body promptSourceIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	src := &store.PromptSource{
		ID:                  strings.TrimSpace(body.ID),
		Name:                strings.TrimSpace(body.Name),
		SourceURL:           strings.TrimSpace(body.SourceURL),
		Format:              strings.TrimSpace(body.Format),
		TaskType:            body.TaskType,
		DefaultTags:         body.DefaultTags,
		Enabled:             true,
		AutoSyncEnabled:     true,
		SyncIntervalMinutes: 360,
	}
	if src.ID == "" {
		src.ID = uuid.NewString()
	}
	if src.TaskType == "" {
		src.TaskType = "t2i"
	}
	if body.SyncIntervalMinutes != nil {
		src.SyncIntervalMinutes = clampSyncInterval(*body.SyncIntervalMinutes)
	}
	if body.Enabled != nil {
		src.Enabled = *body.Enabled
	}
	if body.AutoSyncEnabled != nil {
		src.AutoSyncEnabled = *body.AutoSyncEnabled
	}
	if len([]rune(src.ID)) > 80 {
		fail(c, apperr.E("validation_error", "id: 长度不能超过 80", 422))
		return
	}
	if err := validatePromptSourceFields(src); err != nil {
		fail(c, err)
		return
	}
	created, err := store.InsertPromptSource(c.Request.Context(), s.St.Pool, src)
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("validation_error", "id: 数据源已存在", 422))
			return
		}
		fail(c, err)
		return
	}
	ok(c, promptSourceDict(created))
}

type promptSourcePatchIn struct {
	Name                Opt[string]   `json:"name"`
	SourceURL           Opt[string]   `json:"sourceUrl"`
	Format              Opt[string]   `json:"format"`
	TaskType            Opt[string]   `json:"taskType"`
	DefaultTags         Opt[[]string] `json:"defaultTags"`
	SyncIntervalMinutes Opt[int]      `json:"syncIntervalMinutes"`
	Enabled             Opt[bool]     `json:"enabled"`
	AutoSyncEnabled     Opt[bool]     `json:"autoSyncEnabled"`
}

func (s *Server) adminPatchPromptSource(c *gin.Context, _ *store.User) {
	var body promptSourcePatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	src, err := store.GetPromptSource(ctx, s.St.Pool, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	if src == nil {
		fail(c, apperr.E("not_found", "数据源不存在", 404))
		return
	}
	if body.Name.Valid {
		src.Name = strings.TrimSpace(body.Name.Value)
	}
	if body.SourceURL.Valid {
		src.SourceURL = strings.TrimSpace(body.SourceURL.Value)
	}
	if body.Format.Valid {
		src.Format = strings.TrimSpace(body.Format.Value)
	}
	if body.TaskType.Valid {
		src.TaskType = body.TaskType.Value
	}
	if body.DefaultTags.Valid {
		src.DefaultTags = body.DefaultTags.Value
	}
	if body.SyncIntervalMinutes.Valid {
		src.SyncIntervalMinutes = clampSyncInterval(body.SyncIntervalMinutes.Value)
	}
	if body.Enabled.Valid {
		src.Enabled = body.Enabled.Value
	}
	if body.AutoSyncEnabled.Valid {
		src.AutoSyncEnabled = body.AutoSyncEnabled.Value
	}
	if err := validatePromptSourceFields(src); err != nil {
		fail(c, err)
		return
	}
	if err := store.UpdatePromptSource(ctx, s.St.Pool, src); err != nil {
		fail(c, err)
		return
	}
	updated, err := store.GetPromptSource(ctx, s.St.Pool, src.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, promptSourceDict(updated))
}

func (s *Server) adminDeletePromptSource(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	src, err := store.GetPromptSource(ctx, s.St.Pool, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	if src == nil {
		fail(c, apperr.E("not_found", "数据源不存在", 404))
		return
	}
	purge := c.Query("purgeItems") == "1" || c.Query("purgeItems") == "true"
	if err := store.DeletePromptSource(ctx, s.St.Pool, src.ID, purge); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}

func (s *Server) adminSyncPromptSource(c *gin.Context, _ *store.User) {
	result, err := s.PromptSync.SyncSource(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, promptsync.ErrSyncBusy) {
			fail(c, apperr.E("rate_limited", "该源正在同步中，请稍后再试", 429))
			return
		}
		fail(c, apperr.E("internal_error", "同步失败："+err.Error(), 500))
		return
	}
	if result == nil {
		fail(c, apperr.E("not_found", "数据源不存在", 404))
		return
	}
	ok(c, result)
}
