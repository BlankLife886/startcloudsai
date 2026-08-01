// 任务生命周期账务：提交冻结 / settle / release / 取消 / requeue（重新冻结代数键）。
package taskflow_test

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func timeNow() time.Time { return time.Now().UTC() }

func newUserWithBalance(t *testing.T, st *store.Store, balance int64) *store.User {
	t.Helper()
	ctx := context.Background()
	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	user, err := store.InsertUser(ctx, st.Pool, email, "tester", "x", "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	if balance > 0 {
		err = st.Tx(ctx, func(tx pgx.Tx) error {
			_, gerr := wallet.Grant(ctx, tx, user.ID, balance, "grant", "signup_bonus", user.ID.String(), nil)
			return gerr
		})
		if err != nil {
			t.Fatalf("grant: %v", err)
		}
	}
	return user
}

func getWallet(t *testing.T, st *store.Store, userID uuid.UUID) *store.Wallet {
	t.Helper()
	w, err := store.GetWallet(context.Background(), st.Pool, userID)
	if err != nil || w == nil {
		t.Fatalf("get wallet: %v", err)
	}
	return w
}

func mustAppErr(t *testing.T, err error, code string) {
	t.Helper()
	e, isApp := apperr.As(err)
	if !isApp {
		t.Fatalf("expected apperr %q, got %v", code, err)
	}
	if e.Code != code {
		t.Fatalf("expected code %q, got %q (%s)", code, e.Code, e.Message)
	}
}

func createT2I(t *testing.T, st *store.Store, userID uuid.UUID, count int, idemKey *string) (*store.Task, bool, error) {
	t.Helper()
	return taskflow.CreateTask(context.Background(), st, userID, taskflow.CreateInput{
		Type: "t2i", Prompt: "测试", Count: count, IdempotencyKey: idemKey,
	})
}

func forceRunning(t *testing.T, st *store.Store, taskID uuid.UUID) {
	t.Helper()
	if _, err := st.Pool.Exec(context.Background(),
		`UPDATE tasks SET status = 'running', started_at = now() WHERE id = $1`, taskID); err != nil {
		t.Fatalf("force running: %v", err)
	}
}

func TestCreateTaskFreezesCost(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)

	task, created, err := createT2I(t, st, user.ID, 2, nil)
	if err != nil || !created {
		t.Fatalf("create task: %v (created=%v)", err, created)
	}
	if task.CostCents != 40 { // 默认单价 t2i=20 × 2
		t.Fatalf("cost = %d, want 40", task.CostCents)
	}
	if task.Model != "gpt-image-2" {
		t.Fatalf("model = %q, want gpt-image-2", task.Model)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 60 || w.FrozenCents != 40 {
		t.Fatalf("wallet = (%d, %d), want (60, 40)", w.BalanceCents, w.FrozenCents)
	}
}

func TestCreateTaskSnapshotsConfiguredModel(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()

	first, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create first task: %v", err)
	}
	if err := settings.Set(ctx, st.Pool, "task_models", json.RawMessage(`{"default":"new-default","t2i":"new-t2i"}`)); err != nil {
		t.Fatalf("set task models: %v", err)
	}
	second, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create second task: %v", err)
	}
	if first.Model != "gpt-image-2" {
		t.Fatalf("first model changed to %q", first.Model)
	}
	if second.Model != "new-t2i" {
		t.Fatalf("second model = %q, want new-t2i", second.Model)
	}
}

func TestCreateTaskUsesUserSelectedPublicModel(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://api.example.com", APIKey: "secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{
		{ID: "quality", Name: "Quality", ProviderID: "provider", UpstreamModel: "imagen-4-ultra", Kind: "image", PriceCents: 20, Public: true, Default: true, Enabled: true},
		{ID: "fast", Name: "Fast", ProviderID: "provider", UpstreamModel: "flux-kontext-max", Kind: "image", PriceCents: 12, Public: true, Enabled: true, FastMode: true, MinSeconds: 10, MaxSeconds: 20},
	}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}

	task, _, err := taskflow.CreateTask(context.Background(), st, user.ID, taskflow.CreateInput{
		Type: "t2i", Prompt: "测试", Count: 1, Params: map[string]any{"publicModelKey": "fast"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.Model != "flux-kontext-max" || task.CostCents != 12 {
		t.Fatalf("fast task = model %q cost %d", task.Model, task.CostCents)
	}
}

func TestCreateTaskSnapshotsConfiguredImageService(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "image_service_routes", json.RawMessage(`{"t2i":"sub2api"}`)); err != nil {
		t.Fatal(err)
	}
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if task.Params["_serviceProvider"] != "sub2api" {
		t.Fatalf("provider snapshot = %#v", task.Params["_serviceProvider"])
	}
	if task.Model != "" {
		t.Fatalf("Sub2API model should resolve at execution, got %q", task.Model)
	}
}

func TestStoreCRUNTaskIDsInTaskParams(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"crun-task-1", "crun-task-2"}
	if err := store.SetTaskCRUNTaskIDs(context.Background(), st.Pool, task.ID, want); err != nil {
		t.Fatal(err)
	}
	stored, err := store.GetTask(context.Background(), st.Pool, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := stored.Params["_crunTaskIds"].([]any)
	if !ok || len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("stored CRUN task IDs = %#v", stored.Params["_crunTaskIds"])
	}
}

func TestCreateTaskInsufficientBalance(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 10)
	_, _, err := createT2I(t, st, user.ID, 1, nil)
	mustAppErr(t, err, "insufficient_balance")
}

func TestCreateTaskIdempotencyKey(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	key := "k1"

	task1, created1, err := createT2I(t, st, user.ID, 1, &key)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	task2, created2, err := createT2I(t, st, user.ID, 1, &key)
	if err != nil {
		t.Fatalf("create replay: %v", err)
	}
	if !created1 || created2 {
		t.Fatalf("created flags = (%v, %v), want (true, false)", created1, created2)
	}
	if task1.ID != task2.ID {
		t.Fatalf("idempotent create should return same task")
	}
	w := getWallet(t, st, user.ID)
	if w.FrozenCents != 20 { // 只冻结一次
		t.Fatalf("frozen = %d, want 20", w.FrozenCents)
	}
}

func TestUserTaskLimit(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 10000)
	for range 100 { // 默认允许大量任务排队，Worker 并发仍独立受控
		if _, _, err := createT2I(t, st, user.ID, 1, nil); err != nil {
			t.Fatalf("create: %v", err)
		}
	}
	_, _, err := createT2I(t, st, user.ID, 1, nil)
	mustAppErr(t, err, "user_task_limit")
}

func TestUserTaskLimitUnderConcurrentCreation(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 10000)
	const attempts = 110
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _, err := createT2I(t, st, user.ID, 1, nil)
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	succeeded := 0
	limited := 0
	for err := range results {
		if err == nil {
			succeeded++
			continue
		}
		appErr, ok := apperr.As(err)
		if !ok || appErr.Code != "user_task_limit" {
			t.Fatalf("unexpected concurrent create error: %v", err)
		}
		limited++
	}
	if succeeded != 100 || limited != attempts-100 {
		t.Fatalf("concurrent results = %d succeeded, %d limited; want 100 and %d", succeeded, limited, attempts-100)
	}
	active, err := store.CountActiveTasks(context.Background(), st.Pool, user.ID)
	if err != nil || active != 100 {
		t.Fatalf("active tasks = %d, err=%v; want 100", active, err)
	}
}

func TestGlobalTaskCapacityPreservesIdempotentReplay(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 1000)
	if err := settings.Set(ctx, st.Pool, "global_max_active_tasks", json.RawMessage(`10`)); err != nil {
		t.Fatal(err)
	}
	key := "capacity-replay"
	var first *store.Task
	for index := range 10 {
		idem := (*string)(nil)
		if index == 0 {
			idem = &key
		}
		task, _, err := createT2I(t, st, user.ID, 1, idem)
		if err != nil {
			t.Fatalf("fill capacity at %d: %v", index, err)
		}
		if index == 0 {
			first = task
		}
	}
	if _, _, err := createT2I(t, st, user.ID, 1, nil); err == nil {
		t.Fatal("expected global capacity rejection")
	} else {
		mustAppErr(t, err, "system_task_capacity")
	}
	replayed, created, err := createT2I(t, st, user.ID, 1, &key)
	if err != nil || created || replayed.ID != first.ID {
		t.Fatalf("idempotent replay at capacity = task %v created=%v err=%v", replayed, created, err)
	}
}

func TestSettleOnSuccess(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	forceRunning(t, st, task.ID)

	err = st.Tx(ctx, func(tx pgx.Tx) error {
		won, merr := taskflow.MarkSucceeded(ctx, tx, task, []string{"tasks/x/0.png"}, nil, timeNow())
		if merr != nil {
			return merr
		}
		if !won {
			t.Fatal("expected to win state transition")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("mark succeeded: %v", err)
	}
	// M4 解耦：通知由调用方在事务提交后发（抢到迁移才发，重放不发）
	taskflow.NotifyTaskSucceeded(ctx, st.Pool, task, 1)

	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 80 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (80, 0)", w.BalanceCents, w.FrozenCents)
	}
	// 重复结算（幂等）：状态迁移抢不到
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		won, merr := taskflow.MarkSucceeded(ctx, tx, task, []string{"tasks/x/0.png"}, nil, timeNow())
		if merr != nil {
			return merr
		}
		if won {
			t.Fatal("second settle should not win")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("second mark: %v", err)
	}
	var notif int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1`, user.ID).Scan(&notif); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notif != 1 {
		t.Fatalf("notifications = %d, want 1", notif)
	}
}

func TestReleaseOnFailure(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	forceRunning(t, st, task.ID)

	err = st.Tx(ctx, func(tx pgx.Tx) error {
		won, merr := taskflow.MarkFailed(ctx, tx, task, "upstream_error", "boom", "running")
		if merr != nil {
			return merr
		}
		if !won {
			t.Fatal("expected to win state transition")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("mark failed: %v", err)
	}

	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0)", w.BalanceCents, w.FrozenCents)
	}
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		won, merr := taskflow.MarkFailed(ctx, tx, task, "upstream_error", "boom", "running")
		if merr != nil {
			return merr
		}
		if won {
			t.Fatal("second failure should not win")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("second mark: %v", err)
	}
}

func TestCancelOnlyQueued(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	canceled, err := taskflow.CancelTask(ctx, st, user.ID, task.ID)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if canceled.Status != "canceled" {
		t.Fatalf("status = %s, want canceled", canceled.Status)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (100, 0)", w.BalanceCents, w.FrozenCents)
	}

	_, err = taskflow.CancelTask(ctx, st, user.ID, task.ID)
	mustAppErr(t, err, "task_not_cancelable")
}

func TestRequeueRefreezesThenSettles(t *testing.T) {
	st := testdb.Setup(t)
	user := newUserWithBalance(t, st, 100)
	ctx := context.Background()
	task, _, err := createT2I(t, st, user.ID, 1, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	forceRunning(t, st, task.ID)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, merr := taskflow.MarkFailed(ctx, tx, task, "upstream_error", "boom", "running")
		return merr
	}); err != nil {
		t.Fatalf("mark failed: %v", err)
	}

	requeued, err := taskflow.RequeueTask(ctx, st, task.ID)
	if err != nil {
		t.Fatalf("requeue: %v", err)
	}
	if requeued.Status != "queued" {
		t.Fatalf("status = %s, want queued", requeued.Status)
	}
	w := getWallet(t, st, user.ID)
	if w.BalanceCents != 80 || w.FrozenCents != 20 { // 重新冻结，不重复扣费
		t.Fatalf("wallet = (%d, %d), want (80, 20)", w.BalanceCents, w.FrozenCents)
	}

	forceRunning(t, st, task.ID)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		won, merr := taskflow.MarkSucceeded(ctx, tx, requeued, []string{"tasks/x/0.png"}, nil, timeNow())
		if merr != nil {
			return merr
		}
		if !won {
			t.Fatal("expected to win state transition after requeue")
		}
		return nil
	}); err != nil {
		t.Fatalf("mark succeeded: %v", err)
	}

	w = getWallet(t, st, user.ID)
	if w.BalanceCents != 80 || w.FrozenCents != 0 {
		t.Fatalf("wallet = (%d, %d), want (80, 0)", w.BalanceCents, w.FrozenCents)
	}
	// 全程只扣一次费：freeze×2 / release×1 / spend×1；第二代 freeze 账本键为 task_id/1
	kinds := map[string]int{}
	rows, err := st.Pool.Query(ctx,
		`SELECT kind, count(*) FROM wallet_ledger WHERE user_id = $1 AND source_type = 'task' GROUP BY kind`, user.ID)
	if err != nil {
		t.Fatalf("query ledger: %v", err)
	}
	for rows.Next() {
		var kind string
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			t.Fatalf("scan: %v", err)
		}
		kinds[kind] = n
	}
	rows.Close()
	want := map[string]int{"freeze": 2, "release": 1, "spend": 1}
	for k, n := range want {
		if kinds[k] != n {
			t.Fatalf("ledger kinds = %v, want %v", kinds, want)
		}
	}
	var genSource string
	if err := st.Pool.QueryRow(ctx,
		`SELECT source_id FROM wallet_ledger WHERE kind = 'freeze' AND source_type = 'task' AND source_id LIKE $1`,
		task.ID.String()+"/%").Scan(&genSource); err != nil {
		t.Fatalf("second-generation freeze key missing: %v", err)
	}
	if genSource != task.ID.String()+"/1" {
		t.Fatalf("second freeze source_id = %s, want %s/1", genSource, task.ID)
	}
}
