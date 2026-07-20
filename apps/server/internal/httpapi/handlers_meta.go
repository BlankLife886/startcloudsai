package httpapi

import (
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

func (s *Server) health(c *gin.Context) {
	ok(c, gin.H{"status": "ok"})
}
