package store_test

import (
	"context"
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestAdminListFiltersAgreeWithCountsAndPurge(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	var userID uuid.UUID
	for i := 0; i < 205; i++ {
		u, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("range-user-%d@test.dev", i), "search-cohort", "x", "user", nil)
		if err != nil {
			t.Fatal(err)
		}
		userID = u.ID
	}
	from := time.Date(2026, 9, 22, 16, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	var inside uuid.UUID
	for i, created := range []time.Time{from, to, from.Add(-time.Second)} {
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{ID: uuid.New(), UserID: userID, Type: "t2i", Model: "image", Prompt: "find literal 100%_match", Params: map[string]any{}, Count: 1, CostCents: 0})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = st.Pool.Exec(ctx, "UPDATE tasks SET created_at=$2,status='succeeded' WHERE id=$1", task.ID, created); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			inside = task.ID
		}
	}
	filter := store.AdminListFilter{From: &from, To: &to, Search: "100%_match", UserSearch: "search-cohort"}
	rows, err := store.ListAdminTasks(ctx, st.Pool, "", "", "", nil, 20, nil, "", filter)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != inside {
		t.Fatalf("date/user/keyword filter returned %d rows", len(rows))
	}
	overview, err := store.GetAdminTaskOverview(ctx, st.Pool, "", "", nil, "", filter)
	if err != nil || overview.Total != 1 {
		t.Fatalf("overview mismatch: %#v %v", overview, err)
	}
	exact := store.AdminListFilter{Search: inside.String()}
	rows, err = store.ListAdminTasks(ctx, st.Pool, "", "", "", nil, 20, nil, "", exact)
	if err != nil || len(rows) != 1 {
		t.Fatalf("ID lookup failed: %v", err)
	}
	removed, err := store.PurgeFinishedAdminTasks(ctx, st, "", "", "", nil, "", filter)
	if err != nil || removed.Deleted != 1 {
		t.Fatalf("purge escaped filter: %#v %v", removed, err)
	}
	remaining, err := store.ListAdminTasks(ctx, st.Pool, "", "", "", nil, 20, nil, "")
	if err != nil || len(remaining) != 2 {
		t.Fatalf("unmatched tasks changed: %v", err)
	}
	if _, err = st.Pool.Exec(ctx, "UPDATE users SET created_at=$2 WHERE id=$1", userID, from); err != nil {
		t.Fatal(err)
	}
	count, err := store.CountUsersFiltered(ctx, st.Pool, userID.String(), "", "", "", "", filter)
	if err != nil || count != 1 {
		t.Fatalf("user count %d: %v", count, err)
	}
	users, err := store.ListUsersOffset(ctx, st.Pool, userID.String(), "", "", "", "", 20, 0, filter)
	if err != nil || len(users) != 1 {
		t.Fatalf("user list mismatch: %v", err)
	}
}

// Optional isolated-database smoke benchmark, never run against application data.
func TestAdminListLargeDataset(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("ADMIN_LIST_PERF_ROWS"))
	if n == 0 {
		t.Skip("set ADMIN_LIST_PERF_ROWS to run isolated scale check")
	}
	if n < 1000 || n > 200000 {
		t.Fatal("rows must be between 1000 and 200000")
	}
	st := testdb.Setup(t)
	ctx := context.Background()
	_, err := st.Pool.Exec(ctx, `INSERT INTO users (email,username,password_hash,role,status,created_at) SELECT 'scale-'||n||'@test.dev','scale-'||n,'x','user','active',now()-(n||' seconds')::interval FROM generate_series(1,$1::int) n`, n)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.Pool.Exec(ctx, "ANALYZE users"); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	count, err := store.CountUsersFiltered(ctx, st.Pool, "scale-199999@test.dev", "", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	users, err := store.ListUsersOffset(ctx, st.Pool, "scale-199999@test.dev", "", "", "", "", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if n == 200000 && (count != 1 || len(users) != 1) {
		t.Fatalf("search result mismatch %d %d", count, len(users))
	}
	t.Logf("%d users: keyword count + first page took %s", n, time.Since(start))
	plan, err := st.Pool.Query(ctx, `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM users WHERE role='user' AND (email::text ILIKE '%scale-199999@test.dev%' OR username ILIKE '%scale-199999@test.dev%') ORDER BY created_at DESC,id DESC LIMIT 21`)
	if err != nil {
		t.Fatal(err)
	}
	defer plan.Close()
	for plan.Next() {
		var line string
		if err = plan.Scan(&line); err != nil {
			t.Fatal(err)
		}
		t.Log(line)
	}
}
