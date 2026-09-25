package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/jackc/pgx/v5"
)

// 开放 API 请求结束后会异步更新 API Key 的 last_used_at：先锁 Key 行，再经触发器写
// user_profile_refresh_queue。建任务事务必须按同样顺序（先锁 Key、后写队列），否则同一
// Key 的并发请求会死锁。这里持有 Key 锁，检查建任务在等 Key 时尚未占住队列行。
func TestOpenAPITaskCreationLocksAPIKeyBeforeProfileQueue(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, _ := makeOrder(t, st)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, user.ID, 10000, "grant", "signup_bonus", user.ID.String(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(ctx, st.Pool, "page_controls", json.RawMessage(`{"developer_api":{"status":"normal","reason":""}}`)); err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://example.com", APIKey: "test-secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "image", Name: "Image", ProviderID: "provider", UpstreamModel: "image", Kind: "image", PriceCents: 20, Public: true, Enabled: true}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	secret, err := newAPISecret()
	if err != nil {
		t.Fatal(err)
	}
	key, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{
		UserID: user.ID, KeyPrefix: secret[:18], KeyHash: hashAPISecret(secret), Label: "concurrency test",
		Scopes: []string{"models:read", "tasks:write"}, AllowedModelIDs: []string{"image"},
		DailyTaskLimit: 1000, MonthlyTaskLimit: 10000, DailySpendLimitCents: 1000000, MonthlySpendLimitCents: 10000000,
	})
	if err != nil {
		t.Fatal(err)
	}
	queue, err := taskflow.NewQueue("redis://127.0.0.1:1", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer queue.Close()
	router := (&Server{St: st, Cfg: config.Load(), Queue: queue}).Router()

	// 模拟 last_used_at 更新：持有 API Key 行锁。
	holder, err := st.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(ctx)
	if _, err := holder.Exec(ctx, `SELECT 1 FROM user_api_keys WHERE id=$1 FOR UPDATE`, key.ID); err != nil {
		t.Fatal(err)
	}

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		raw, _ := json.Marshal(map[string]any{"type": "t2i", "prompt": "加锁顺序", "count": 1, "params": map[string]any{"modelId": "image"}})
		req := httptest.NewRequest(http.MethodPost, "/api/open/v1/tasks", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+secret)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		done <- recorder
	}()

	// 等建任务事务阻塞在 API Key 行锁上。
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting int
		if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%user_api_keys%FOR UPDATE%'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			break
		}
		select {
		case recorder := <-done:
			t.Fatalf("task creation finished while the API key was locked: status=%d body=%s", recorder.Code, recorder.Body.String())
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("task creation never waited on the API key lock")
		}
		time.Sleep(20 * time.Millisecond)
	}

	// 此时建任务事务不应已占住该用户的画像刷新队列行，否则与 last_used_at 更新构成死锁。
	queueTx, err := st.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer queueTx.Rollback(ctx)
	if _, err := queueTx.Exec(ctx, `SET LOCAL lock_timeout = '500ms'`); err != nil {
		t.Fatal(err)
	}
	if _, err := queueTx.Exec(ctx, `INSERT INTO user_profile_refresh_queue (user_id, requested_at) VALUES ($1, now())
		ON CONFLICT (user_id) DO UPDATE SET requested_at = EXCLUDED.requested_at`, user.ID); err != nil {
		t.Fatalf("task creation holds the profile refresh queue row while waiting on the API key (deadlock order): %v", err)
	}
	if err := queueTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	if err := holder.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case recorder := <-done:
		if recorder.Code != http.StatusCreated {
			t.Fatalf("submission status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("task creation did not finish after the API key lock was released")
	}
}
