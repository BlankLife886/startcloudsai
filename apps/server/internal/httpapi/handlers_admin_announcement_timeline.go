package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const announcementTimelineLimit = 200

func actorIDOf(user *store.User) *uuid.UUID {
	if user == nil {
		return nil
	}
	id := user.ID
	return &id
}

func actorNameOf(user *store.User) string {
	if user == nil {
		return ""
	}
	if name := strings.TrimSpace(user.Username); name != "" {
		return name
	}
	return user.Email
}

// recordAnnouncementPatch 把一次编辑拆成时间线记录：启停单独一条，其余字段合成一条「编辑」。
func recordAnnouncementPatch(ctx context.Context, tx pgx.Tx, before, after *store.Announcement, actorID *uuid.UUID, actorName string) error {
	var changes []string
	if before.Title != after.Title {
		changes = append(changes, "标题")
	}
	if ptrString(before.Body) != ptrString(after.Body) {
		changes = append(changes, "正文")
	}
	if !sameTime(before.StartsAt, after.StartsAt) || !sameTime(before.EndsAt, after.EndsAt) {
		changes = append(changes, "展示时间")
	}
	if !sameJSON(before.Config, after.Config) {
		changes = append(changes, "展示设置")
	}
	if len(changes) > 0 {
		if err := store.InsertAnnouncementEvent(ctx, tx, after.ID, after.Title, "updated", changes, actorID, actorName); err != nil {
			return err
		}
	}
	if before.Active != after.Active {
		action := "disabled"
		if after.Active {
			action = "enabled"
		}
		return store.InsertAnnouncementEvent(ctx, tx, after.ID, after.Title, action, nil, actorID, actorName)
	}
	return nil
}

// sameJSON 按语义比较：jsonb 读回来的键顺序、空白与 Go 序列化结果不同。
func sameJSON(a, b []byte) bool {
	var left, right any
	if json.Unmarshal(a, &left) != nil || json.Unmarshal(b, &right) != nil {
		return bytes.Equal(a, b)
	}
	return reflect.DeepEqual(left, right)
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// adminAnnouncementEvents 公告时间线；带 announcementId 时只看这一条，否则看全部（含已删除）。
func (s *Server) adminAnnouncementEvents(c *gin.Context, _ *store.User) {
	var announcementID *uuid.UUID
	if raw := c.Query("announcementId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			fail(c, apperr.E("validation_error", "announcementId: 格式不正确", 422))
			return
		}
		announcementID = &id
	}
	events, err := store.ListAnnouncementEvents(c.Request.Context(), s.St.Pool, announcementID, announcementTimelineLimit)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(events))
	for _, e := range events {
		items = append(items, gin.H{
			"id":             e.ID,
			"announcementId": e.AnnouncementID,
			"title":          e.Title,
			"action":         e.Action,
			"changes":        e.Changes,
			"actorName":      e.ActorName,
			"createdAt":      e.CreatedAt,
		})
	}
	ok(c, gin.H{"items": items})
}
