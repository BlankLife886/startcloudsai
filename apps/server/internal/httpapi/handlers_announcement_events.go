package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/announcementstream"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) announcementSnapshot(ctx context.Context) ([]byte, error) {
	now := time.Now().UTC()
	rows, err := store.ListAnnouncements(ctx, s.St.Pool, &now)
	if err != nil {
		return nil, err
	}
	items := make([]gin.H, 0, len(rows))
	for _, announcement := range rows {
		items = append(items, announcementDict(announcement))
	}
	return json.Marshal(gin.H{"items": items})
}

func (s *Server) publishAnnouncementUpdate(ctx context.Context) {
	if s.AnnouncementStream == nil {
		return
	}
	publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 500*time.Millisecond)
	defer cancel()
	if err := s.AnnouncementStream.Notify(publishCtx); err != nil {
		log.Printf("announcement broadcast delayed; persisted state will be refreshed: %v", err)
	}
}

func (s *Server) adminPushAnnouncement(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	announcement, err := store.PushActiveAnnouncement(ctx, s.St.Pool, id, uuid.New(), time.Now().UTC())
	if errors.Is(err, pgx.ErrNoRows) {
		existing, getErr := store.GetAnnouncement(ctx, s.St.Pool, id)
		if getErr != nil {
			fail(c, getErr)
		} else if existing == nil {
			fail(c, apperr.E("not_found", "公告不存在", http.StatusNotFound))
		} else {
			fail(c, apperr.E("validation_error", "仅可立即推送已上架且在展示时间范围内的公告，请先调整公告状态或时间", http.StatusUnprocessableEntity))
		}
		return
	}
	if err != nil {
		fail(c, err)
		return
	}
	s.publishAnnouncementUpdate(ctx)
	ok(c, announcementDict(announcement))
}

func writeAnnouncementSnapshot(c *gin.Context, snapshot announcementstream.Snapshot) bool {
	if _, err := fmt.Fprintf(c.Writer, "id: %s\nevent: announcements\ndata: %s\n\n", snapshot.ID, snapshot.Data); err != nil {
		return false
	}
	c.Writer.Flush()
	return true
}

func (s *Server) announcementEvents(c *gin.Context) {
	if s.AnnouncementStream == nil {
		fail(c, apperr.E("announcement_stream_unavailable", "公告实时连接暂时不可用，请稍后重试", http.StatusServiceUnavailable))
		return
	}
	snapshot, changes, unsubscribe, err := s.AnnouncementStream.Subscribe(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	defer unsubscribe()
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if !writeAnnouncementSnapshot(c, snapshot) {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case next, ok := <-changes:
			if !ok || !writeAnnouncementSnapshot(c, next) {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		}
	}
}
