package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// The console invokes this compiled scenario. Provider jobs remain pending
// until both users' image reservations and independent chat execution have
// been measured. All HTTP endpoints and generated images are local fixtures.
func scenarioAtMost(t *testing.T, name string, limit, actual int64) {
	t.Helper()
	passed := actual <= limit
	raw, _ := json.Marshal(map[string]any{"test": t.Name(), "name": name, "expected": fmt.Sprintf("≤ %d", limit), "actual": fmt.Sprint(actual), "passed": passed})
	fmt.Printf("BILLING_SCENARIO %s\n", raw)
	if !passed {
		t.Fatalf("%s: %d exceeds %d", name, actual, limit)
	}
}

func TestTaskScenarioMultiUserImages(t *testing.T) {
	parent, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	st := testdb.Setup(t)
	w := assistantRoutingTestWorker(t, st, 10)
	w.Cfg.AppEnv = "development"
	executionTestSetting(t, st, "user_max_concurrent_tasks", 2)
	executionTestSetting(t, st, "global_max_concurrent_tasks", 3)
	executionTestSetting(t, st, "user_max_concurrent_chats", 1)
	executionTestSetting(t, st, "global_max_concurrent_chats", 2)
	users := []*store.User{assistantRoutingTestUser(t, st, 100), assistantRoutingTestUser(t, st, 100)}
	var bitmap bytes.Buffer
	if err := png.Encode(&bitmap, image.NewNRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(bitmap.Bytes())
	var released atomic.Bool
	var chats atomic.Int32
	var mu sync.Mutex
	jobs := map[string]bool{}
	posts, peakPending := 0, 0
	provider := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/image-tasks/"):
			var body struct {
				ID string `json:"client_task_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" {
				http.Error(rw, "invalid simulated image request", 400)
				return
			}
			mu.Lock()
			posts++
			if _, exists := jobs[body.ID]; exists {
				t.Error("same image job submitted twice")
			}
			jobs[body.ID] = false
			pending := 0
			for _, done := range jobs {
				if !done {
					pending++
				}
			}
			peakPending = max(peakPending, pending)
			mu.Unlock()
			_ = json.NewEncoder(rw).Encode(map[string]any{"id": body.ID, "status": "queued"})
		case r.Method == http.MethodGet && r.URL.Path == "/api/image-tasks":
			var items []any
			for _, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
				complete := released.Load()
				mu.Lock()
				_, exists := jobs[id]
				if exists && complete {
					jobs[id] = true
				}
				mu.Unlock()
				if !exists {
					t.Errorf("poll of unknown simulated job %s", id)
					continue
				}
				item := map[string]any{"id": id, "status": "processing"}
				if complete {
					item["status"] = "success"
					item["data"] = []any{map[string]any{"b64_json": encoded}}
				}
				items = append(items, item)
			}
			_ = json.NewEncoder(rw).Encode(map[string]any{"items": items})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
			chats.Add(1)
			rw.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(rw, "data: {\"choices\":[{\"delta\":{\"content\":\"模拟对话完成\"}}]}\n\ndata: [DONE]\n\n")
		default:
			http.NotFound(rw, r)
		}
	}))
	defer provider.Close()
	objects := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			http.Error(rw, "unexpected object request", 400)
			return
		}
		_, _ = io.Copy(io.Discard, r.Body)
		rw.Header().Set("ETag", `"simulated"`)
		rw.WriteHeader(200)
	}))
	defer objects.Close()
	var err error
	w.Storage, err = storage.New(&config.Config{ObjectStorageEndpoint: objects.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test", ObjectStorageBucket: "test", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers[0].Routes[0].BaseURL = provider.URL
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	var runs []*store.AssistantRun
	for _, user := range users {
		for range 3 {
			runs = append(runs, executionTestAssistant(t, st, user.ID, 1, 5))
		}
	}
	scenarioCheck(t, "模拟账号数量", 2, len(users))
	scenarioCheck(t, "两个账号提交的图片任务", 6, len(runs))
	var claims, executions sync.WaitGroup
	var claimed atomic.Int32
	errors := make(chan error, len(runs))
	start := make(chan struct{})
	for _, run := range runs {
		claims.Add(1)
		executions.Add(1)
		go func(id uuid.UUID) {
			defer executions.Done()
			<-start
			current, err := w.claimAssistantRun(ctx, id, "simulated-"+uuid.NewString())
			if err != nil {
				errors <- err
			}
			if current != nil {
				claimed.Add(1)
			}
			claims.Done()
			if err == nil && current != nil {
				if err := w.executeAssistantRun(ctx, current); err != nil {
					errors <- err
				}
			}
		}(run.ID)
	}
	defer func() { released.Store(true); cancel(); executions.Wait() }()
	close(start)
	claims.Wait()
	scenarioCheck(t, "全局3张名额：正在执行的图片任务", 3, claimed.Load())
	for {
		mu.Lock()
		count := len(jobs)
		mu.Unlock()
		if count == 3 {
			break
		}
		select {
		case err := <-errors:
			t.Fatal(err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(20 * time.Millisecond):
		}
	}
	mu.Lock()
	initialPosts := posts
	mu.Unlock()
	scenarioCheck(t, "实际提交给本地模拟上游的图片任务", 3, initialPosts)
	for index, user := range users {
		account, err := store.GetUserConcurrency(ctx, st.Pool, user.ID)
		if err != nil {
			t.Fatal(err)
		}
		scenarioAtMost(t, fmt.Sprintf("账号%c当前图片占用", 'A'+index), 2, account.ImageRunning)
		scenarioCheck(t, fmt.Sprintf("账号%c个人图片上限", 'A'+index), 2, account.ImageLimit)
	}
	var waiting int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM assistant_runs WHERE mode='image' AND status='queued'`).Scan(&waiting); err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "超额图片在数据库排队", 3, waiting)
	for _, user := range users {
		chat := insertAssistantRoutingTestRun(t, st, user.ID, "chat", modelconfig.WorkspaceAssistant, 20)
		current, err := w.claimAssistantRun(ctx, chat.ID, "chat-"+uuid.NewString())
		if err != nil || current == nil {
			t.Fatalf("chat admission: %v", err)
		}
		if err := w.executeAssistantRun(ctx, current); err != nil {
			t.Fatal(err)
		}
	}
	scenarioCheck(t, "图片仍在等待时，两位用户的模拟对话均完成", 2, chats.Load())
	usage, err := store.GetGlobalExecutionUsage(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "对话完成后图片仍占3张，未被错误释放", 3, usage.ImageRunning)
	released.Store(true)
	executions.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	if t.Failed() {
		return
	}
	for _, run := range runs {
		current, err := store.GetAssistantRun(ctx, st.Pool, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == "queued" {
			current, err = w.claimAssistantRun(ctx, run.ID, "drain-"+uuid.NewString())
			if err != nil || current == nil {
				t.Fatalf("queued task did not advance: %v", err)
			}
			if err := w.executeAssistantRun(ctx, current); err != nil {
				t.Fatal(err)
			}
		}
	}
	var succeeded int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM assistant_runs WHERE mode='image' AND status='succeeded'`).Scan(&succeeded); err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "放行模拟上游后，6张图片均完成", 6, succeeded)
	mu.Lock()
	finalPosts, peak := posts, peakPending
	mu.Unlock()
	scenarioCheck(t, "没有重复提交：上游总共接收6个图片任务", 6, finalPosts)
	scenarioCheck(t, "模拟上游同时未完成的图片任务峰值", 3, peak)
	for index, user := range users {
		funds, err := store.GetWallet(ctx, st.Pool, user.ID)
		if err != nil {
			t.Fatal(err)
		}
		scenarioCheck(t, fmt.Sprintf("账号%c余额：100减3张×5积分及对话20积分", 'A'+index), 65, funds.BalanceCents)
		scenarioCheck(t, fmt.Sprintf("账号%c无残留冻结", 'A'+index), 0, funds.FrozenCents)
	}
}
