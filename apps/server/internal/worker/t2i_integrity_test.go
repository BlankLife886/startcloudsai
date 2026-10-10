package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/semaphore"
)

func integrityPNG(t *testing.T, c color.NRGBA) string {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			im.SetNRGBA(x, y, c)
		}
	}
	var data bytes.Buffer
	if err := png.Encode(&data, im); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(data.Bytes())
}

func TestT2IIntegrityPrivateModelBindingCannotComeFromClient(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	w.Cfg.AppEnv = "development"
	u := assistantRoutingTestUser(t, st, 1000)
	models := make(chan string, 4)
	data := integrityPNG(t, color.NRGBA{R: 255, A: 255})
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" {
			http.NotFound(rw, r)
			return
		}
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		models <- body.Model
		rw.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(rw).Encode(map[string]any{"data": []any{map[string]any{"b64_json": data}}})
	}))
	defer server.Close()
	w.Cfg.C2ABaseURL = server.URL
	w.Cfg.C2AAPIKey = "legacy-test-key"
	w.Cfg.C2ATimeoutSecs = 180
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Models = []modelconfig.Model{{ID: "private-premium", ProviderID: "chat-provider", Name: "Private", Kind: modelconfig.ModelKindImage, UpstreamModel: "private-image", PriceCents: 500, Enabled: true, Public: false}}
	cfg.Providers[0].Routes[0].BaseURL = server.URL
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	task, _, err := taskflow.CreateTask(ctx, st, u.ID, taskflow.CreateInput{Type: "t2i", Prompt: "test", Count: 1, Params: map[string]any{"_providerConfigId": "chat-provider", "_modelConfigId": "private-premium", "_completionClaimId": "fake", "_outputSlots": map[string]any{"version": 1}, "_automatic": true}})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"_providerConfigId", "_modelConfigId", "_completionClaimId", "_outputSlots", "_automatic"} {
		if _, exists := task.Params[key]; exists {
			t.Fatalf("untrusted internal key retained: %s", key)
		}
	}
	claimed, _, err := w.claimTask(ctx, task.ID)
	if err != nil || claimed == nil {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if _, err := w.callUpstream(ctx, claimed, "", "", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case called := <-models:
		if called == "private-image" || called != task.Model {
			t.Fatalf("wrong model invoked: %s", called)
		}
	default:
		t.Fatal("legacy compatibility request not executed")
	}
	if _, _, err := taskflow.CreateTask(ctx, st, u.ID, taskflow.CreateInput{Type: "t2i", Prompt: "test", Count: 1, Params: map[string]any{"publicModelKey": "private-premium"}}); err == nil {
		t.Fatal("explicit private model was allowed")
	}
}

func TestT2IIntegrityClientHistoryAndCompletionMarkersCannotHideTasks(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	u := assistantRoutingTestUser(t, st, 100)
	for _, key := range []string{"user_max_running_tasks", "user_max_running_images"} {
		if err := settings.Set(ctx, st.Pool, key, json.RawMessage(`1`)); err != nil {
			t.Fatal(err)
		}
	}
	in := taskflow.CreateInput{Type: "t2i", Prompt: "test", Count: 1, Params: map[string]any{"publicModelKey": "image-model", "_kind": store.UIDesignRegionEditKind, "_completionClaimId": "fake", "_completionClaimedAtMs": int64(9999999999999)}}
	task, _, err := taskflow.CreateTask(ctx, st, u.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := taskflow.CreateTask(ctx, st, u.ID, in); err == nil {
		t.Fatal("queue capacity bypassed")
	}
	if got, _, err := w.claimTask(ctx, task.ID); err != nil || got == nil {
		t.Fatalf("client claim marker blocked task: %v", err)
	}
	// Old rows may still contain the untrusted label. Operational queries must
	// rely on server ownership even before those records are rewritten.
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET params=params||'{"_kind":"ui-design-region-edit"}',lease_until=now()-interval '20 minutes' WHERE id=$1`, task.ID); err != nil {
		t.Fatal(err)
	}
	ids, err := store.RequeueExpiredRunningTasks(ctx, st.Pool, time.Now().UTC())
	if err != nil || len(ids) != 1 || ids[0] != task.ID {
		t.Fatalf("legacy label excluded recovery: %v %v", ids, err)
	}
	for _, stamp := range []string{"invalid", "9999999999999"} {
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='queued',params=params||jsonb_build_object('_completionClaimId','legacy-invalid','_completionClaimedAtMs',$2::text) WHERE id=$1`, task.ID, stamp); err != nil {
			t.Fatal(err)
		}
		if ok, err := store.ClaimTask(ctx, st.Pool, task.ID, time.Now().UTC(), "recovery", time.Minute); err != nil || !ok {
			t.Fatalf("legacy timestamp blocked claim: %v %v", ok, err)
		}
	}
}

func TestT2IIntegrityPartialImagesRestoreOriginalSlots(t *testing.T) {
	for _, mode := range []string{"slots", "legacy", "cleanup"} {
		t.Run(mode, func(t *testing.T) {
			st := testdb.Setup(t)
			ctx := context.Background()
			w := assistantRoutingTestWorker(t, st, 4)
			u := assistantRoutingTestUser(t, st, 100)
			var mu sync.Mutex
			objects := map[string][]byte{}
			server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				if r.Method == http.MethodPut {
					mu.Lock()
					objects[strings.TrimPrefix(r.URL.Path, "/test/")] = b
					mu.Unlock()
				}
				rw.WriteHeader(200)
			}))
			defer server.Close()
			var err error
			w.Storage, err = storage.New(&config.Config{ObjectStorageEndpoint: server.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test", ObjectStorageBucket: "test", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300})
			if err != nil {
				t.Fatal(err)
			}
			w.imageMemoryBytes = 64 << 20
			w.imageMemory = semaphore.NewWeighted(w.imageMemoryBytes)
			task, _, err := taskflow.CreateTask(ctx, st, u.ID, taskflow.CreateInput{Type: "t2i", Prompt: "test", Count: 2, Params: map[string]any{"publicModelKey": "image-model"}})
			if err != nil {
				t.Fatal(err)
			}
			task, _, err = w.claimTask(ctx, task.ID)
			if err != nil || task == nil {
				t.Fatal(err)
			}
			a, b := integrityPNG(t, color.NRGBA{R: 255, A: 255}), integrityPNG(t, color.NRGBA{B: 255, A: 255})
			claim := func(id string) *taskOutputCollector {
				t.Helper()
				if ok, err := store.TryClaimTaskCompletion(ctx, st.Pool, task.ID, id, time.Now().UTC(), time.Minute); err != nil || !ok {
					t.Fatalf("completion claim: %v %v", ok, err)
				}
				latest, err := store.GetTask(ctx, st.Pool, task.ID)
				if err != nil {
					t.Fatal(err)
				}
				return newClaimedTaskOutputCollector(w, ctx, latest, id)
			}
			first := claim("first")
			if err := deliverEncodedImages([]string{"", b}, first.persist); err != nil {
				t.Fatal(err)
			}
			if _, err := store.ReleaseTaskCompletionClaim(ctx, st.Pool, task.ID, "first"); err != nil {
				t.Fatal(err)
			}
			if mode == "legacy" {
				if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET params=params-'_outputSlots' WHERE id=$1`, task.ID); err != nil {
					t.Fatal(err)
				}
			}
			second := claim("second")
			if second.outputSlots[0] != "" || second.outputSlots[1] == "" {
				t.Fatalf("partial position lost: %v", second.outputSlots)
			}
			if err := deliverEncodedImages([]string{a, b}, second.persist); err != nil {
				t.Fatal(err)
			}
			if mode == "cleanup" {
				second.cleanup()
				if _, err := store.ReleaseTaskCompletionClaim(ctx, st.Pool, task.ID, "second"); err != nil {
					t.Fatal(err)
				}
				second = claim("after-cleanup")
				if second.outputSlots[0] != "" || second.outputSlots[1] == "" {
					t.Fatalf("cleanup lost previous slot: %v", second.outputSlots)
				}
				if err := deliverEncodedImages([]string{a, b}, second.persist); err != nil {
					t.Fatal(err)
				}
			}
			keys, thumbs := second.completed()
			if len(keys) != 2 {
				t.Fatalf("outputs=%v", keys)
			}
			mu.Lock()
			outA, outB := objects[keys[0]], objects[keys[1]]
			mu.Unlock()
			wantA, _ := base64.StdEncoding.DecodeString(a)
			wantB, _ := base64.StdEncoding.DecodeString(b)
			if !bytes.Equal(outA, wantA) || !bytes.Equal(outB, wantB) {
				t.Fatal("images duplicated or swapped")
			}
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				latest, err := store.GetTask(ctx, tx, task.ID)
				if err != nil {
					return err
				}
				_, err = taskflow.MarkSucceededClaimed(ctx, tx, latest, keys, thumbs, time.Now().UTC(), second.completionClaimID)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			funds, err := store.GetWallet(ctx, st.Pool, u.ID)
			if err != nil || funds.BalanceCents != 90 || funds.FrozenCents != 0 {
				t.Fatalf("settlement=%+v %v", funds, err)
			}
		})
	}
}

func TestT2IIntegrityMemoryBudgetUsesDecodedDimensions(t *testing.T) {
	raw, _ := base64.StdEncoding.DecodeString(integrityPNG(t, color.NRGBA{R: 1, A: 254}))
	// A valid IHDR suffices: the budget must be calculated before decoding pixels.
	binary.BigEndian.PutUint32(raw[16:20], 4096)
	binary.BigEndian.PutUint32(raw[20:24], 4096)
	binary.BigEndian.PutUint32(raw[29:33], crc32.ChecksumIEEE(raw[12:29]))
	weight, err := taskOutputMemoryWeight(&store.Task{}, base64.StdEncoding.EncodeToString(raw), len(raw), 128<<20)
	if err != nil || weight != 128<<20 {
		t.Fatalf("4K budget=%d err=%v", weight, err)
	}
	weight, err = taskOutputMemoryWeight(&store.Task{}, base64.StdEncoding.EncodeToString(raw), len(raw), 1024<<20)
	if err != nil || weight < 64<<20 {
		t.Fatalf("decoded image was undercounted: %d %v", weight, err)
	}
	if _, err := taskOutputMemoryWeight(&store.Task{}, "invalid", 7, 128<<20); err == nil {
		t.Fatal("invalid image header accepted")
	}
}
