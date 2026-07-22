// 同步引擎集成测试（真实 Postgres 临时库）：upsert 保留语义、锁防并发、全流程同步。
package promptsync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func insertTestSource(t *testing.T, st *store.Store, id, url, format string) *store.PromptSource {
	t.Helper()
	src, err := store.InsertPromptSource(context.Background(), st.Pool, &store.PromptSource{
		ID: id, Name: id, SourceURL: url, Format: format, TaskType: "t2i",
		Enabled: true, AutoSyncEnabled: true, SyncIntervalMinutes: 360,
	})
	if err != nil {
		t.Fatalf("insert source: %v", err)
	}
	return src
}

func TestUpsertSourcePromptPreservesCuration(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()

	res, err := store.UpsertSourcePrompt(ctx, st.Pool, "src-a", "key-1", "标题", "提示词内容", "t2i",
		[]string{"tag1"}, "https://img.example.com/1.png", 5)
	if err != nil {
		t.Fatal(err)
	}
	if res != store.SourcePromptImported {
		t.Fatalf("want imported, got %v", res)
	}
	var category string
	var active bool
	var sort int
	row := st.Pool.QueryRow(ctx,
		`SELECT category, active, sort FROM prompt_library WHERE source_id = 'src-a' AND source_item_key = 'key-1'`)
	if err := row.Scan(&category, &active, &sort); err != nil {
		t.Fatal(err)
	}
	if category != "other" || !active || sort != 5 {
		t.Fatalf("unexpected new row: category=%s active=%v sort=%d", category, active, sort)
	}

	// 管理员回填分类 / 下架 / 调序后，再次同步不得覆盖
	if _, err := st.Pool.Exec(ctx,
		`UPDATE prompt_library SET category = 'portrait', active = false, sort = 99
		 WHERE source_id = 'src-a' AND source_item_key = 'key-1'`); err != nil {
		t.Fatal(err)
	}
	res, err = store.UpsertSourcePrompt(ctx, st.Pool, "src-a", "key-1", "新标题", "提示词内容", "t2i",
		[]string{"tag1"}, "https://img.example.com/1.png", 42)
	if err != nil {
		t.Fatal(err)
	}
	if res != store.SourcePromptUpdated {
		t.Fatalf("want updated, got %v", res)
	}
	var title string
	row = st.Pool.QueryRow(ctx,
		`SELECT title, category, active, sort FROM prompt_library WHERE source_id = 'src-a' AND source_item_key = 'key-1'`)
	if err := row.Scan(&title, &category, &active, &sort); err != nil {
		t.Fatal(err)
	}
	if title != "新标题" {
		t.Fatalf("title not updated: %q", title)
	}
	if category != "portrait" || active || sort != 99 {
		t.Fatalf("curation overwritten: category=%s active=%v sort=%d", category, active, sort)
	}

	// 内容一致 → unchanged，不落盘
	res, err = store.UpsertSourcePrompt(ctx, st.Pool, "src-a", "key-1", "新标题", "提示词内容", "t2i",
		[]string{"tag1"}, "https://img.example.com/1.png", 42)
	if err != nil {
		t.Fatal(err)
	}
	if res != store.SourcePromptUnchanged {
		t.Fatalf("want unchanged, got %v", res)
	}
}

func TestPromptSourceLockPreventsConcurrentSync(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	insertTestSource(t, st, "lock-src", "https://example.com/p.json", "json")

	got, err := store.AcquirePromptSourceLock(ctx, st.Pool, "lock-src", "token-a", 20*time.Minute, false)
	if err != nil || !got {
		t.Fatalf("first acquire: got=%v err=%v", got, err)
	}
	got, err = store.AcquirePromptSourceLock(ctx, st.Pool, "lock-src", "token-b", 20*time.Minute, false)
	if err != nil || got {
		t.Fatalf("second acquire should fail: got=%v err=%v", got, err)
	}
	if err := store.ReleasePromptSourceLock(ctx, st.Pool, "lock-src", "token-b"); err != nil {
		t.Fatal(err)
	}
	// 非持有者释放无效
	got, _ = store.AcquirePromptSourceLock(ctx, st.Pool, "lock-src", "token-b", 20*time.Minute, false)
	if got {
		t.Fatal("acquire after foreign release should fail")
	}
	if err := store.ReleasePromptSourceLock(ctx, st.Pool, "lock-src", "token-a"); err != nil {
		t.Fatal(err)
	}
	got, err = store.AcquirePromptSourceLock(ctx, st.Pool, "lock-src", "token-b", 20*time.Minute, false)
	if err != nil || !got {
		t.Fatalf("acquire after release: got=%v err=%v", got, err)
	}
}

func TestSyncSourceEndToEnd(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()

	payload := `[
		{"id": "a1", "title": "词条一", "prompt": "prompt body one long enough", "image": "img/1.png"},
		{"title": "词条二", "prompt": "prompt body two long enough"}
	]`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}))
	defer server.Close()

	insertTestSource(t, st, "e2e-src", server.URL+"/prompts.json", "json")
	engine := New(st, true)

	result, err := engine.SyncSource(ctx, "e2e-src")
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 2 || result.Updated != 0 || result.Unchanged != 0 || result.ItemCount != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}

	var coverKey string
	if err := st.Pool.QueryRow(ctx,
		`SELECT cover_key FROM prompt_library WHERE source_id = 'e2e-src' AND source_item_key = 'a1'`,
	).Scan(&coverKey); err != nil {
		t.Fatal(err)
	}
	if coverKey != server.URL+"/img/1.png" {
		t.Fatalf("cover_key should be remote url, got %q", coverKey)
	}

	src, err := store.GetPromptSource(ctx, st.Pool, "e2e-src")
	if err != nil {
		t.Fatal(err)
	}
	if src.ItemCount != 2 || src.LastSyncedAt == nil || src.LastError != "" || src.NextSyncAt == nil {
		t.Fatalf("source stats not updated: %+v", src)
	}
	if !src.NextSyncAt.After(time.Now().Add(5 * time.Hour)) {
		t.Fatalf("next_sync_at should be ~6h later, got %v", src.NextSyncAt)
	}

	// 二次同步：内容一致 → 全部 unchanged
	result, err = engine.SyncSource(ctx, "e2e-src")
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 0 || result.Unchanged != 2 {
		t.Fatalf("second sync unexpected: %+v", result)
	}

	// 持锁期间手动同步被拒
	if got, _ := store.AcquirePromptSourceLock(ctx, st.Pool, "e2e-src", "outer", 20*time.Minute, false); !got {
		t.Fatal("acquire for busy test")
	}
	if _, err := engine.SyncSource(ctx, "e2e-src"); err != ErrSyncBusy {
		t.Fatalf("want ErrSyncBusy, got %v", err)
	}
}

func TestSyncSourceFailureRecordsError(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	insertTestSource(t, st, "bad-src", server.URL+"/x.json", "json")
	engine := New(st, true)
	if _, err := engine.SyncSource(ctx, "bad-src"); err == nil {
		t.Fatal("sync should fail")
	}
	src, err := store.GetPromptSource(ctx, st.Pool, "bad-src")
	if err != nil {
		t.Fatal(err)
	}
	if src.LastError == "" {
		t.Fatal("last_error should be recorded")
	}
	// 失败后 15 分钟重试；锁应已释放
	if src.NextSyncAt == nil || src.NextSyncAt.After(time.Now().Add(16*time.Minute)) {
		t.Fatalf("unexpected next_sync_at: %v", src.NextSyncAt)
	}
	if got, _ := store.AcquirePromptSourceLock(ctx, st.Pool, "bad-src", "again", time.Minute, false); !got {
		t.Fatal("lock should be released after failed sync")
	}
}
