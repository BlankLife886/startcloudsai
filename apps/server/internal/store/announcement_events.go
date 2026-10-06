package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// AnnouncementEvent 公告时间线上的一条操作记录。
type AnnouncementEvent struct {
	ID             uuid.UUID
	AnnouncementID uuid.UUID
	Title          string
	Action         string
	Changes        []string
	ActorID        *uuid.UUID
	ActorName      string
	CreatedAt      time.Time
}

func InsertAnnouncementEvent(ctx context.Context, q Q, announcementID uuid.UUID, title, action string, changes []string, actorID *uuid.UUID, actorName string) error {
	if changes == nil {
		changes = []string{}
	}
	_, err := q.Exec(ctx, `
		INSERT INTO announcement_events (announcement_id, title, action, changes, actor_id, actor_name)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		announcementID, title, action, changes, actorID, actorName)
	return err
}

// ListAnnouncementEvents announcementID 为 nil 时返回全部公告（含已删除）的最近记录。
func ListAnnouncementEvents(ctx context.Context, q Q, announcementID *uuid.UUID, limit int) ([]*AnnouncementEvent, error) {
	rows, err := q.Query(ctx, `
		SELECT e.id, e.announcement_id, e.title, e.action, e.changes, e.actor_id, e.actor_name, e.created_at
		FROM announcement_events e
		WHERE $1::uuid IS NULL OR e.announcement_id = $1
		ORDER BY e.created_at DESC, e.id DESC
		LIMIT $2`, announcementID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AnnouncementEvent
	for rows.Next() {
		var e AnnouncementEvent
		if err := rows.Scan(&e.ID, &e.AnnouncementID, &e.Title, &e.Action, &e.Changes, &e.ActorID, &e.ActorName, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &e)
	}
	return out, rows.Err()
}
