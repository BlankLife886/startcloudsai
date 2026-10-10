package httpapi

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func scopedContext(target string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", target, nil)
	return c
}

func TestAdminCursorIsBoundToFilters(t *testing.T) {
	raw := encodeValueCursor(time.Now(), uuid.New(), nil)
	first := scopedContext("/api/v1/admin/feedback?status=open&limit=20")
	if _, _, err := pageParams(first); err != nil {
		t.Fatal(err)
	}
	page := gin.H{"nextCursor": raw}
	scopeResponseCursors(first, page)
	scoped, _ := page["nextCursor"].(string)
	if scoped == raw {
		t.Fatal("admin cursor was not scoped")
	}

	same := scopedContext("/api/v1/admin/feedback?limit=50&status=open&summary=false&cursor=" + scoped)
	if _, cursor, err := pageParams(same); err != nil || cursor == nil {
		t.Fatalf("same filters rejected: %v", err)
	}
	changed := scopedContext("/api/v1/admin/feedback?status=closed&cursor=" + scoped)
	if _, _, err := pageParams(changed); err != errCursorScope {
		t.Fatalf("changed filters err = %v, want scope error", err)
	}
	legacy := scopedContext("/api/v1/admin/feedback?status=closed&cursor=" + raw)
	if _, _, err := pageParams(legacy); err != nil {
		t.Fatalf("unscoped legacy cursor rejected: %v", err)
	}
	user := scopedContext("/api/v1/tasks?status=failed")
	if _, _, err := pageParams(user); err != nil {
		t.Fatal(err)
	}
	userPage := gin.H{"nextCursor": raw}
	scopeResponseCursors(user, userPage)
	if userPage["nextCursor"] != raw {
		t.Fatal("user-facing cursors must stay unscoped")
	}
}
