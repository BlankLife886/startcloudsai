// cursor 分页：cursor = urlsafe_base64("<created_at_iso>|<id>")，按 (created_at, id) 倒序。
package httpapi

import (
	"encoding/base64"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func encodeCursor(createdAt time.Time, id uuid.UUID) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

var errBadCursor = apperr.E("validation_error", "无效的 cursor", 422)

func decodeCursor(cursor string) (*store.Cursor, error) {
	raw, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		if raw, err = base64.RawURLEncoding.DecodeString(cursor); err != nil {
			return nil, errBadCursor
		}
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return nil, errBadCursor
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, errBadCursor
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, errBadCursor
	}
	return &store.Cursor{CreatedAt: ts, ID: id}, nil
}

// pageParams 解析 ?limit=&cursor=（limit 1-100 默认 20）。
func pageParams(c *gin.Context) (int, *store.Cursor, error) {
	limit := 20
	if s := c.Query("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 100 {
			return 0, nil, apperr.E("validation_error", "limit: 须在 1-100 之间", 422)
		}
		limit = n
	}
	var cursor *store.Cursor
	if s := c.Query("cursor"); s != "" {
		cur, err := decodeCursor(s)
		if err != nil {
			return 0, nil, err
		}
		cursor = cur
	}
	return limit, cursor, nil
}

type cursorItem interface {
	CursorKey() (time.Time, uuid.UUID)
}

// buildPage rows 为 limit+1 条查询结果。
func buildPage[T cursorItem](rows []T, limit int, serialize func(T) gin.H) gin.H {
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		items = append(items, serialize(r))
	}
	var next any
	if hasMore && len(rows) > 0 {
		t, id := rows[len(rows)-1].CursorKey()
		next = encodeCursor(t, id)
	}
	return gin.H{"items": items, "nextCursor": next}
}
