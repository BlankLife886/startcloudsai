package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// Jumping to page N must return exactly the rows reached by following cursors.
func TestAdminTaskPageCursorMatchesCursorWalk(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "page-"+uuid.NewString()+"@test.dev", "page", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC().Add(-time.Hour)
	for i := 0; i < 23; i++ {
		at := base.Add(time.Duration(i) * time.Second)
		if i%4 == 0 {
			insertPerfAssistantRun(t, st, user.ID, "assistant", at, "succeeded", map[string]any{})
		} else {
			insertPerfTask(t, st, user.ID, at, "succeeded", "t2i", map[string]any{})
		}
	}
	const limit = 5
	var walked [][]uuid.UUID
	var cursor *store.Cursor
	for {
		rows, err := store.ListAdminTasks(ctx, st.Pool, "", "", "", nil, limit, cursor, "")
		if err != nil {
			t.Fatal(err)
		}
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		ids := make([]uuid.UUID, len(rows))
		for i, row := range rows {
			ids[i] = row.ID
		}
		walked = append(walked, ids)
		if !hasMore {
			break
		}
		last := rows[len(rows)-1]
		cursor = &store.Cursor{CreatedAt: last.CreatedAt, ID: last.ID}
	}
	if len(walked) != 5 {
		t.Fatalf("walked %d pages, want 5", len(walked))
	}
	for page := 1; page <= len(walked); page++ {
		start, err := store.AdminTaskPageCursor(ctx, st.Pool, "", "", "", nil, (page-1)*limit, "")
		if err != nil {
			t.Fatal(err)
		}
		if (page == 1) != (start == nil) {
			t.Fatalf("page %d start cursor = %v", page, start)
		}
		rows, err := store.ListAdminTasks(ctx, st.Pool, "", "", "", nil, limit, start, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) > limit {
			rows = rows[:limit]
		}
		if len(rows) != len(walked[page-1]) {
			t.Fatalf("page %d has %d rows, want %d", page, len(rows), len(walked[page-1]))
		}
		for i, row := range rows {
			if row.ID != walked[page-1][i] {
				t.Fatalf("page %d row %d = %s, want %s", page, i, row.ID, walked[page-1][i])
			}
		}
	}
	// offset == 行数时起点是最后一行（下一页为空）；超过行数才没有起点。
	if last, err := store.AdminTaskPageCursor(ctx, st.Pool, "", "", "", nil, 23, ""); err != nil || last == nil || last.ID != walked[4][len(walked[4])-1] {
		t.Fatalf("offset at end = %v, %v", last, err)
	}
	if past, err := store.AdminTaskPageCursor(ctx, st.Pool, "", "", "", nil, 24, ""); err != nil || past != nil {
		t.Fatalf("offset past end = %v, %v", past, err)
	}
}

// Offset cursors (page-number jumps) must return the same rows as the keyset walk.
func TestLedgerOffsetCursorMatchesCursorWalk(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "ledger-page-"+uuid.NewString()+"@test.dev", "ledger", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
		SELECT $1, 'grant', 1, n, 'test', 'page-'||n, now() - (n % 7) * interval '1 second' FROM generate_series(1, 23) n`, user.ID); err != nil {
		t.Fatal(err)
	}
	const limit = 5
	var cursor *store.Cursor
	for page := 1; ; page++ {
		walked, err := store.ListLedger(ctx, st.Pool, user.ID, limit, cursor)
		if err != nil {
			t.Fatal(err)
		}
		var seek *store.Cursor
		if page > 1 {
			seek = &store.Cursor{Offset: (page - 1) * limit}
		}
		jumped, err := store.ListLedger(ctx, st.Pool, user.ID, limit, seek)
		if err != nil {
			t.Fatal(err)
		}
		if len(walked) != len(jumped) {
			t.Fatalf("page %d: walked %d rows, jumped %d", page, len(walked), len(jumped))
		}
		for i := range walked {
			if walked[i].ID != jumped[i].ID {
				t.Fatalf("page %d row %d differs", page, i)
			}
		}
		if len(walked) <= limit {
			break
		}
		last := walked[limit-1]
		cursor = &store.Cursor{CreatedAt: last.CreatedAt, ID: last.ID}
	}
	count, err := store.CountUserLedgerCapped(ctx, st.Pool, user.ID)
	if err != nil || count != (store.CappedCount{Value: 23}) {
		t.Fatalf("count = %+v, %v", count, err)
	}
}
