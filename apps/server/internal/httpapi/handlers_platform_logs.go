package httpapi

import (
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func platformLogRange(value string, now time.Time) (*time.Time, error) {
	var since time.Time
	switch strings.TrimSpace(value) {
	case "", "24h":
		since = now.Add(-24 * time.Hour)
	case "7d":
		since = now.AddDate(0, 0, -7)
	case "30d":
		since = now.AddDate(0, 0, -30)
	case "all":
		return nil, nil
	default:
		return nil, apperr.E("validation_error", "range: 仅支持 24h、7d、30d 或 all", 422)
	}
	return &since, nil
}

func optionalUUIDQuery(c *gin.Context, key string) (*uuid.UUID, error) {
	value := strings.TrimSpace(c.Query(key))
	if value == "" {
		return nil, nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return nil, apperr.E("validation_error", key+": 格式不正确", 422)
	}
	return &id, nil
}

func (s *Server) adminPlatformLogs(c *gin.Context, _ *store.User) {
	category := strings.TrimSpace(c.Query("category"))
	if category != "" && !store.Contains(store.PlatformLogCategories, category) {
		fail(c, apperr.E("validation_error", "category: 分类无效", 422))
		return
	}
	level := strings.TrimSpace(c.Query("level"))
	if level != "" && !store.Contains(store.PlatformLogLevels, level) {
		fail(c, apperr.E("validation_error", "level: 等级无效", 422))
		return
	}
	since, err := platformLogRange(c.Query("range"), time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	taskID, err := optionalUUIDQuery(c, "taskId")
	if err != nil {
		fail(c, err)
		return
	}
	userID, err := optionalUUIDQuery(c, "userId")
	if err != nil {
		fail(c, err)
		return
	}
	limit := 100
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, parseErr := strconv.Atoi(value)
		if parseErr != nil || parsed < 1 || parsed > 200 {
			fail(c, apperr.E("validation_error", "limit: 须在 1-200 之间", 422))
			return
		}
		limit = parsed
	}
	var beforeID int64
	if value := strings.TrimSpace(c.Query("cursor")); value != "" {
		beforeID, err = strconv.ParseInt(value, 10, 64)
		if err != nil || beforeID <= 0 {
			fail(c, apperr.E("validation_error", "cursor: 格式不正确", 422))
			return
		}
	}
	items, err := store.ListPlatformLogs(c.Request.Context(), s.St.Pool, store.PlatformLogFilter{
		Category: category, Level: level, Service: strings.TrimSpace(c.Query("service")), Route: strings.TrimSpace(c.Query("route")),
		Search: strings.TrimSpace(c.Query("search")), TaskID: taskID, UserID: userID,
		RequestID: strings.TrimSpace(c.Query("requestId")), Since: since, BeforeID: beforeID, Limit: limit,
	})
	if err != nil {
		fail(c, err)
		return
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	nextCursor := ""
	if hasMore && len(items) > 0 {
		nextCursor = strconv.FormatInt(items[len(items)-1].ID, 10)
	}
	ok(c, gin.H{"items": items, "hasMore": hasMore, "nextCursor": nextCursor})
}

func (s *Server) adminPlatformLogStats(c *gin.Context, _ *store.User) {
	since, err := platformLogRange(c.Query("range"), time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	stats, err := store.GetPlatformLogStats(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	bucketUnit := "hour"
	if value := strings.TrimSpace(c.Query("range")); value == "7d" || value == "30d" || value == "all" {
		bucketUnit = "day"
	}
	overview, err := store.GetPlatformLogOverview(c.Request.Context(), s.St.Pool, since, bucketUnit)
	if err != nil {
		fail(c, err)
		return
	}
	config := s.Logs.Current(c.Request.Context())
	maxBytes := config.MaxMB << 20
	usagePercent := float64(0)
	if maxBytes > 0 {
		usagePercent = min(100, float64(stats.LogicalBytes)*100/float64(maxBytes))
	}
	ok(c, gin.H{
		"config": config, "capacity": stats, "maxBytes": maxBytes, "usagePercent": usagePercent,
		"overview": overview,
	})
}

func (s *Server) adminDeletePlatformLogs(c *gin.Context, _ *store.User) {
	category := strings.TrimSpace(c.Query("category"))
	if category != "" && !store.Contains(store.PlatformLogCategories, category) {
		fail(c, apperr.E("validation_error", "category: 分类无效", 422))
		return
	}
	var before *time.Time
	if value := strings.TrimSpace(c.Query("before")); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			fail(c, apperr.E("validation_error", "before: 时间格式不正确", 422))
			return
		}
		before = &parsed
	}
	if category == "" && before == nil && c.Query("all") != "true" {
		fail(c, apperr.E("validation_error", "清空全部日志必须明确指定 all=true", 422))
		return
	}
	deleted, err := store.DeletePlatformLogs(c.Request.Context(), s.St.Pool, category, before)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"deleted": deleted})
}

func (s *Server) adminCleanupPlatformLogs(c *gin.Context, _ *store.User) {
	config := s.Logs.Current(c.Request.Context())
	deleted, err := store.CleanupPlatformLogs(
		c.Request.Context(), s.St.Pool,
		time.Now().UTC().AddDate(0, 0, -int(config.RetentionDays)), config.MaxMB<<20,
	)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"deleted": deleted})
}
