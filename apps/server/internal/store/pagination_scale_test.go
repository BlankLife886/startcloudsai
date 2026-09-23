package store_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// explainQ runs EXPLAIN (ANALYZE, BUFFERS) for every read the store issues,
// so the scale check measures the exact SQL the handlers send.
type explainQ struct {
	pool  *pgxpool.Pool
	t     *testing.T
	plans []planSummary
}

type planSummary struct {
	ExecMS float64
	Hit    int64
	Read   int64
	Rows   float64
	Nodes  []string
}

func (q *explainQ) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return q.pool.Exec(ctx, sql, args...)
}

func (q *explainQ) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	q.explain(ctx, sql, args)
	return q.pool.Query(ctx, sql, args...)
}

func (q *explainQ) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	q.explain(ctx, sql, args)
	return q.pool.QueryRow(ctx, sql, args...)
}

func (q *explainQ) explain(ctx context.Context, sql string, args []any) {
	var raw []byte
	if err := q.pool.QueryRow(ctx, "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql, args...).Scan(&raw); err != nil {
		q.t.Fatalf("explain: %v\n%s", err, sql)
	}
	var doc []struct {
		Plan          map[string]any `json:"Plan"`
		ExecutionTime float64        `json:"Execution Time"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc) == 0 {
		q.t.Fatalf("decode plan: %v", err)
	}
	s := planSummary{ExecMS: doc[0].ExecutionTime}
	s.Hit, _ = asInt(doc[0].Plan["Shared Hit Blocks"])
	s.Read, _ = asInt(doc[0].Plan["Shared Read Blocks"])
	s.Rows, _ = doc[0].Plan["Actual Rows"].(float64)
	seen := map[string]bool{}
	var walk func(node map[string]any)
	walk = func(node map[string]any) {
		label, _ := node["Node Type"].(string)
		if idx, ok := node["Index Name"].(string); ok {
			label += " " + idx
		} else if rel, ok := node["Relation Name"].(string); ok {
			label += " " + rel
		}
		if label == "Sort" || label == "Incremental Sort" {
			if keys, ok := node["Sort Method"].(string); ok {
				label += " (" + keys + ")"
			}
		}
		if !seen[label] && label != "Result" && label != "Subquery Scan" && label != "Limit" {
			seen[label] = true
			s.Nodes = append(s.Nodes, label)
		}
		children, _ := node["Plans"].([]any)
		for _, child := range children {
			if m, ok := child.(map[string]any); ok {
				walk(m)
			}
		}
	}
	walk(doc[0].Plan)
	q.plans = append(q.plans, s)
}

func asInt(v any) (int64, bool) {
	f, ok := v.(float64)
	return int64(f), ok
}

type scaleResult struct {
	name  string
	wall  time.Duration
	plans []planSummary
}

// measure runs fn three times (warm cache) and keeps the median wall time and
// the plans of the last run.
func measure(t *testing.T, q *explainQ, name string, fn func() error) scaleResult {
	t.Helper()
	walls := make([]time.Duration, 0, 3)
	for i := 0; i < 3; i++ {
		q.plans = nil
		start := time.Now()
		if err := fn(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		walls = append(walls, time.Since(start))
	}
	sort.Slice(walls, func(i, j int) bool { return walls[i] < walls[j] })
	return scaleResult{name: name, wall: walls[1], plans: append([]planSummary(nil), q.plans...)}
}

// TestPaginationScaleBaseline records list/count cost for users, tasks and the
// wallet ledger at production-like sizes. It only runs in an isolated
// temporary database:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/postgres PAGINATION_SCALE_ROWS=1000000 \
//	  go test ./internal/store -run '^TestPaginationScaleBaseline$' -count=1 -v -timeout 30m
func TestPaginationScaleBaseline(t *testing.T) {
	rows, _ := strconv.Atoi(os.Getenv("PAGINATION_SCALE_ROWS"))
	if rows == 0 {
		t.Skip("set PAGINATION_SCALE_ROWS to run isolated pagination scale check")
	}
	if rows < 10000 || rows > 5000000 {
		t.Fatal("PAGINATION_SCALE_ROWS must be between 10000 and 5000000")
	}
	users := min(max(rows/5, 1000), 200000)
	ctx := context.Background()
	st := scaleStore(t, ctx)
	seedStart := time.Now()
	seedPaginationScale(t, ctx, st.Pool, users, rows)
	t.Logf("seeded %d users, %d tasks, %d ledger rows in %s", users, rows, rows, time.Since(seedStart).Round(time.Second))

	var heavyUser store.Cursor
	if err := st.Pool.QueryRow(ctx, `SELECT id, created_at FROM users WHERE email='scale-heavy@test.dev'`).Scan(&heavyUser.ID, &heavyUser.CreatedAt); err != nil {
		t.Fatal(err)
	}
	q := &explainQ{pool: st.Pool, t: t}
	now := time.Now().UTC()
	last30 := store.AdminListFilter{From: ptr(now.AddDate(0, 0, -30))}
	var midTask, midLedger store.Cursor
	if err := st.Pool.QueryRow(ctx, `SELECT created_at, id FROM tasks ORDER BY created_at DESC, id DESC OFFSET $1 LIMIT 1`, rows/2).Scan(&midTask.CreatedAt, &midTask.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT created_at, id FROM wallet_ledger ORDER BY created_at DESC, id DESC OFFSET $1 LIMIT 1`, rows/2).Scan(&midLedger.CreatedAt, &midLedger.ID); err != nil {
		t.Fatal(err)
	}
	deepUserOffset := min(users, store.ListCountCap) - 20

	results := []scaleResult{
		measure(t, q, "users: capped count (no filter)", func() error {
			_, err := store.CountUsersCapped(ctx, q, "", "", "", "", "")
			return err
		}),
		measure(t, q, "users: page 1 (offset 0)", func() error {
			_, err := store.ListUsersOffset(ctx, q, "", "", "", "", "", 20, 0)
			return err
		}),
		measure(t, q, fmt.Sprintf("users: deep page (offset %d)", deepUserOffset), func() error {
			_, err := store.ListUsersOffset(ctx, q, "", "", "", "", "", 20, deepUserOffset)
			return err
		}),
		measure(t, q, "users: capped count (keyword 'scale-1')", func() error {
			_, err := store.CountUsersCapped(ctx, q, "scale-1", "", "", "", "")
			return err
		}),
		measure(t, q, "admin tasks: page 1 (last 30d)", func() error {
			_, err := store.ListAdminTasks(ctx, q, "", "", "", nil, 20, nil, "", last30)
			return err
		}),
		measure(t, q, "admin tasks: page 1 (all time)", func() error {
			_, err := store.ListAdminTasks(ctx, q, "", "", "", nil, 20, nil, "")
			return err
		}),
		measure(t, q, "admin tasks: mid cursor (all time)", func() error {
			_, err := store.ListAdminTasks(ctx, q, "", "", "", nil, 20, &midTask, "")
			return err
		}),
		measure(t, q, "admin tasks: jump to page 500 (all time)", func() error {
			start, err := store.AdminTaskPageCursor(ctx, q, "", "", "", nil, store.ListCountCap-20, "")
			if err != nil {
				return err
			}
			_, err = store.ListAdminTasks(ctx, q, "", "", "", nil, 20, start, "")
			return err
		}),
		measure(t, q, "admin tasks: overview (last 30d)", func() error {
			_, err := store.GetAdminTaskOverview(ctx, q, "", "", nil, "", last30)
			return err
		}),
		measure(t, q, "admin tasks: overview (all time)", func() error {
			_, err := store.GetAdminTaskOverview(ctx, q, "", "", nil, "")
			return err
		}),
		measure(t, q, "user tasks: page 1 (heavy user)", func() error {
			_, err := store.ListTasks(ctx, q, &heavyUser.ID, "", "", nil, 20, nil, "", "")
			return err
		}),
		measure(t, q, "site ledger: page 1", func() error {
			_, err := store.ListLedgerFiltered(ctx, q, nil, "", "", nil, 20, nil)
			return err
		}),
		measure(t, q, "site ledger: mid cursor", func() error {
			_, err := store.ListLedgerFiltered(ctx, q, nil, "", "", nil, 20, &midLedger)
			return err
		}),
		measure(t, q, "site ledger: page 1 (kind=spend)", func() error {
			_, err := store.ListLedgerFiltered(ctx, q, nil, "spend", "", nil, 20, nil)
			return err
		}),
		measure(t, q, "user ledger: page 1 (heavy user)", func() error {
			_, err := store.ListLedger(ctx, q, heavyUser.ID, 20, nil)
			return err
		}),
		measure(t, q, "user ledger: capped count (heavy user)", func() error {
			_, err := store.CountUserLedgerCapped(ctx, q, heavyUser.ID)
			return err
		}),
		measure(t, q, "user ledger: offset at cap (heavy user)", func() error {
			_, err := store.ListLedgerPage(ctx, q, heavyUser.ID, 20, store.ListCountCap-20)
			return err
		}),
	}

	var b strings.Builder
	fmt.Fprintf(&b, "\n%-40s %10s %10s %10s  %s\n", "scenario", "wall", "db ms", "buffers", "plan")
	for _, r := range results {
		var dbMS float64
		var buffers int64
		var nodes []string
		for _, p := range r.plans {
			dbMS += p.ExecMS
			buffers += p.Hit + p.Read
			nodes = append(nodes, strings.Join(p.Nodes, " > "))
		}
		fmt.Fprintf(&b, "%-40s %10s %10.1f %10d  %s\n", r.name, r.wall.Round(100*time.Microsecond), dbMS, buffers, strings.Join(nodes, " | "))
	}
	t.Log(b.String())
}

func ptr[T any](v T) *T { return &v }

// scaleStore uses PAGINATION_SCALE_KEEP_DB (a database URL that must not exist
// yet) when set, so the seeded data survives for manual EXPLAIN comparisons.
func scaleStore(t *testing.T, ctx context.Context) *store.Store {
	t.Helper()
	keep := os.Getenv("PAGINATION_SCALE_KEEP_DB")
	if keep == "" {
		return testdb.Setup(t)
	}
	if err := store.Migrate(keep); err != nil {
		t.Fatalf("migrate %s: %v", keep, err)
	}
	st, err := store.New(ctx, keep)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	t.Logf("keeping seeded database %s; drop it when done", keep)
	return st
}

// seedPaginationScale inserts synthetic rows spread over the past year. One
// heavy user owns 5% of tasks and ledger rows to exercise per-user pages.
func seedPaginationScale(t *testing.T, ctx context.Context, pool *pgxpool.Pool, users, rows int) {
	t.Helper()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	// Profile-refresh triggers would enqueue one job per synthetic row.
	stmts := []string{
		`SET session_replication_role = replica`,
		fmt.Sprintf(`INSERT INTO users (email, username, password_hash, role, status, created_at)
			SELECT 'scale-'||n||'@test.dev', 'scale-'||n, 'x', 'user', 'active', now() - (n * interval '365 days' / %d)
			FROM generate_series(1, %d) n`, users, users),
		`INSERT INTO users (email, username, password_hash, role, status, created_at)
			VALUES ('scale-heavy@test.dev', 'scale-heavy', 'x', 'user', 'active', now() - interval '400 days')`,
		`CREATE TEMP TABLE scale_users AS SELECT row_number() OVER (ORDER BY id) AS user_no, id FROM users WHERE email LIKE 'scale-%' AND email <> 'scale-heavy@test.dev'`,
		fmt.Sprintf(`INSERT INTO tasks (user_id, type, status, prompt, cost_cents, created_at)
			SELECT CASE WHEN n %% 20 = 0 THEN (SELECT id FROM users WHERE email='scale-heavy@test.dev') ELSE su.id END,
				(ARRAY['t2i','coloring','model_sheet','game_art'])[1 + n %% 4],
				(ARRAY['succeeded','succeeded','succeeded','failed','canceled'])[1 + n %% 5],
				'scale prompt '||n, 10, now() - (n * interval '365 days' / %d)
			FROM generate_series(1, %d) n
			JOIN scale_users su ON su.user_no = 1 + n %% %d`, rows, rows, users),
		fmt.Sprintf(`INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, created_at)
			SELECT CASE WHEN n %% 20 = 0 THEN (SELECT id FROM users WHERE email='scale-heavy@test.dev') ELSE su.id END,
				(ARRAY['spend','spend','freeze','release','grant','refund'])[1 + n %% 6],
				-10, 1000, 'task', 'scale-'||n, now() - (n * interval '365 days' / %d)
			FROM generate_series(1, %d) n
			JOIN scale_users su ON su.user_no = 1 + n %% %d`, rows, rows, users),
		`SET session_replication_role = origin`,
		`VACUUM ANALYZE users`,
		`VACUUM ANALYZE tasks`,
		`VACUUM ANALYZE wallet_ledger`,
	}
	for _, stmt := range stmts {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			t.Fatalf("seed: %v\n%s", err, stmt)
		}
	}
}
