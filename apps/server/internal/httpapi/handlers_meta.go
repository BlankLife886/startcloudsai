package httpapi

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) pricing(c *gin.Context) {
	ctx := c.Request.Context()
	_, raw, err := settings.TaskPrices(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if raw == nil {
		raw = json.RawMessage(`{}`)
	}
	freeDaily, err := settings.GetInt(ctx, s.St.Pool, "free_daily_cents")
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"taskPrices": raw, "freeDailyCents": freeDaily})
}

func (s *Server) metaChangelog(c *gin.Context) {
	rows, err := store.ListChangelog(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, entry := range rows {
		items = append(items, changelogDict(entry))
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) metaAnnouncements(c *gin.Context) {
	now := time.Now().UTC()
	rows, err := store.ListAnnouncements(c.Request.Context(), s.St.Pool, &now)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, a := range rows {
		items = append(items, announcementDict(a))
	}
	ok(c, gin.H{"items": items})
}

// health H3：db + redis 连通性检查，任一失败返回 503（compose healthcheck 在用）。
func (s *Server) health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	dbStatus, redisStatus := "ok", "ok"
	if err := s.St.Pool.Ping(ctx); err != nil {
		dbStatus = "error"
	}
	if err := s.Queue.Ping(); err != nil {
		redisStatus = "error"
	}
	status := "ok"
	if dbStatus != "ok" || redisStatus != "ok" {
		status = "degraded"
		c.JSON(503, gin.H{"success": false, "code": "unhealthy",
			"error": "服务依赖不可用", "data": gin.H{"status": status, "db": dbStatus, "redis": redisStatus}})
		return
	}
	ok(c, gin.H{"status": status, "db": dbStatus, "redis": redisStatus})
}
