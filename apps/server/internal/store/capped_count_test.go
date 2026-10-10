package store_test

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestCappedCountsStopAtListCap(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	over := store.ListCountCap + 5
	if _, err := st.Pool.Exec(ctx, `INSERT INTO users (email, username, password_hash, role, status)
		SELECT 'cap-'||n||'@test.dev', 'cap-'||n, 'x', 'user', 'active' FROM generate_series(1, $1::int) n`, over); err != nil {
		t.Fatal(err)
	}
	var userID any
	if err := st.Pool.QueryRow(ctx, `SELECT id FROM users WHERE email = 'cap-1@test.dev'`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `INSERT INTO tasks (user_id, type, status, prompt, cost_cents)
		SELECT $1, 't2i', CASE WHEN n <= 3 THEN 'failed' ELSE 'succeeded' END, 'cap', 0 FROM generate_series(1, $2::int) n`, userID, over); err != nil {
		t.Fatal(err)
	}

	users, err := store.CountUsersCapped(ctx, st.Pool, "", "", "", "", "")
	if err != nil || users != (store.CappedCount{Value: store.ListCountCap, Capped: true}) {
		t.Fatalf("users count = %+v, %v", users, err)
	}
	exact, err := store.CountUsersCapped(ctx, st.Pool, "cap-1@test.dev", "", "", "", "")
	if err != nil || exact != (store.CappedCount{Value: 1}) {
		t.Fatalf("filtered users count = %+v, %v", exact, err)
	}

	overview, err := store.GetAdminTaskOverview(ctx, st.Pool, "", "", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if overview.Total != store.ListCountCap || !overview.Capped["total"] ||
		overview.Succeeded != store.ListCountCap || !overview.Capped["succeeded"] ||
		overview.Failed != 3 || overview.Capped["failed"] || overview.Queued != 0 ||
		overview.Today != store.ListCountCap || !overview.Capped["today"] {
		t.Fatalf("overview = %+v", overview)
	}
}
