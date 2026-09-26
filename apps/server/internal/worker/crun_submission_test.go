package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/semaphore"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func fundedCRUNSubmissionTask(t *testing.T, st *store.Store, queued bool) *store.Task {
	t.Helper()
	ctx := context.Background()
	for _, key := range []string{"growth_failure_bonus_enabled", "growth_usage_rewards_enabled"} {
		if err := settings.Set(ctx, st.Pool, key, json.RawMessage(`false`)); err != nil {
			t.Fatal(err)
		}
	}
	id, _, _ := insertPollableOpenAITask(t, st, ctx, time.Now().UTC())
	task, err := store.GetTask(ctx, st.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, task.UserID); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.Grant(ctx, tx, task.UserID, 100, "grant", "test", id.String(), nil); err != nil {
			return err
		}
		if _, err := wallet.FreezeForTask(ctx, tx, task.UserID, id, 40, "text_to_image", nil); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE tasks SET cost_cents=40,count=2,params=params || '{"_serviceProvider":"crun","_modelConfigId":"model-a"}'::jsonb WHERE id=$1`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if queued {
		if _, err := st.Pool.Exec(ctx, `DELETE FROM task_upstream_attempts WHERE task_id=$1`, id); err != nil {
			t.Fatal(err)
		}
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='queued',lease_owner=NULL,lease_until=NULL WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	} else {
		if _, err := st.Pool.Exec(ctx, `UPDATE task_upstream_attempts SET adapter='crun',status='submitting',upstream_task_ids='[]' WHERE task_id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	task, err = store.GetTask(ctx, st.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func crunSubmissionWorker(t *testing.T, st *store.Store, baseURL string) *Worker {
	t.Helper()
	w := &Worker{
		St: st, Cfg: &config.Config{AppEnv: "development", AppSecret: "crun-submission-test-secret"}, workerID: "worker:crun-test",
		imageMemory: semaphore.NewWeighted(64 << 20), imageMemoryBytes: 64 << 20,
		modelConfig: modelconfig.Config{Version: modelconfig.Version,
			Providers: []modelconfig.Provider{{ID: "provider-a", Name: "CRUN", Adapter: modelconfig.AdapterCRUN, Enabled: true,
				Routes: []modelconfig.ProviderRoute{{ID: "route-a", Name: "Original", BaseURL: baseURL, APIKey: "test", TimeoutSecs: 300, MaxConcurrency: 10, Enabled: true}}}},
			Models: []modelconfig.Model{{ID: "model-a", Name: "Image", ProviderID: "provider-a", UpstreamModel: "openai/gpt-image-2", Kind: modelconfig.ModelKindImage, Enabled: true}}},
		modelConfigAt: time.Now(),
	}
	if err := modelconfig.Save(context.Background(), st.Pool, w.modelConfig); err != nil {
		t.Fatal(err)
	}
	return w
}

func TestCRUNUnknownSubmissionPollsOnlyKnownJobsAndRefundsRemainder(t *testing.T) {
	st := testdb.Setup(t)
	for _, status := range []int{500, 502, 0} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			ctx := context.Background()
			task := fundedCRUNSubmissionTask(t, st, false)
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
				t.Fatal(err)
			}
			imageURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
			var creates, polls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/v1/client/job/EstimateTask":
					fmt.Fprint(w, `{"code":200,"data":{"affordable":true}}`)
				case "/api/v1/client/job/CreateTask":
					if creates.Add(1) == 1 {
						fmt.Fprint(w, `{"code":200,"data":{"task_id":"job-1"}}`)
						return
					}
					if status == 0 {
						conn, _, err := w.(http.Hijacker).Hijack()
						if err == nil {
							_ = conn.Close()
						}
						return
					}
					w.WriteHeader(status)
					fmt.Fprint(w, `{"code":500,"message":"accepted but response was lost"}`)
				case "/api/v1/client/job/TaskInfo":
					polls.Add(1)
					if got := r.URL.Query().Get("task_id"); got != "job-1" {
						t.Errorf("polled unknown job %s", got)
					}
					fmt.Fprintf(w, `{"code":200,"data":{"task_id":"job-1","status":"success","result":{"code":200,"media_urls":[%q]}}}`, imageURL)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			objects := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				w.WriteHeader(http.StatusOK)
			}))
			defer objects.Close()
			w := crunSubmissionWorker(t, st, server.URL)
			var err error
			w.Storage, err = storage.New(&config.Config{ObjectStorageEndpoint: objects.URL, ObjectStorageAccessKeyID: "test", ObjectStorageSecretAccessKey: "test", ObjectStorageBucket: "test", ObjectStorageUsePathStyle: true, ObjectStoragePresignExpireSecs: 300})
			if err != nil {
				t.Fatal(err)
			}
			selection, _, err := w.configuredModelSelection(ctx, task)
			if err != nil || selection == nil {
				t.Fatalf("selection=%v err=%v", selection, err)
			}
			_, err = w.callConfiguredUpstream(ctx, task, selection, nil)
			var pending *asyncImagePendingError
			if !errors.As(err, &pending) || len(pending.upstreamTaskIDs) != 1 || pending.upstreamTaskIDs[0] != "job-1" {
				t.Fatalf("err=%v pending=%+v", err, pending)
			}
			restored, err := store.GetTask(ctx, st.Pool, task.ID)
			if err != nil {
				t.Fatal(err)
			}
			_, err = w.callConfiguredUpstream(ctx, restored, selection, nil)
			if !errors.As(err, &pending) || creates.Load() != 2 {
				t.Fatalf("recovery resubmitted unknown slot: creates=%d err=%v", creates.Load(), err)
			}
			var attemptID uuid.UUID
			if err := st.Pool.QueryRow(ctx, `SELECT id FROM task_upstream_attempts WHERE task_id=$1`, task.ID).Scan(&attemptID); err != nil {
				t.Fatal(err)
			}
			if err := store.SetTaskUpstreamAttemptPending(ctx, st.Pool, attemptID, pending.upstreamTaskIDs); err != nil {
				t.Fatal(err)
			}
			claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, "provider-a/route-a", "known-jobs", time.Now().UTC(), time.Minute, 10)
			if err != nil || len(claimed) != 1 {
				t.Fatalf("claim=%d err=%v", len(claimed), err)
			}
			w.pollCRUNProviderTasks(ctx, &selection.Provider, claimed)
			current, err := store.GetTask(ctx, st.Pool, task.ID)
			if err != nil || current.Status != "succeeded" || len(current.OutputKeys) != 1 || current.Count != 2 {
				t.Fatalf("partial task=%+v err=%v", current, err)
			}
			balance, err := store.GetWallet(ctx, st.Pool, task.UserID)
			if err != nil || balance.BalanceCents != 80 || balance.FrozenCents != 0 || creates.Load() != 2 || polls.Load() != 1 {
				t.Fatalf("wallet=%+v creates=%d polls=%d err=%v", balance, creates.Load(), polls.Load(), err)
			}
			label := fmt.Sprintf("模拟上游 %d", status)
			if status == 0 {
				label = "模拟上游断连"
			}
			scenarioCheck(t, label+"：原请求图片数量", 2, current.Count)
			scenarioCheck(t, label+"：实际交付图片数量", 1, len(current.OutputKeys))
			scenarioCheck(t, label+"：未重复提交未知任务", 2, creates.Load())
			scenarioCheck(t, label+"：只查询已知任务", 1, polls.Load())
			scenarioCheck(t, label+"：100积分仅扣已交付的一张20积分", 80, balance.BalanceCents)
			scenarioCheck(t, label+"：没有残留冻结", 0, balance.FrozenCents)
		})
	}
}

func TestCRUNUnknownFirstSubmissionFailsWithoutRetry(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	task := fundedCRUNSubmissionTask(t, st, true)
	var creates atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/client/job/EstimateTask" {
			fmt.Fprint(w, `{"code":200,"data":{"affordable":true}}`)
			return
		}
		creates.Add(1)
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprint(w, `{"code":502,"message":"unknown acceptance"}`)
	}))
	defer server.Close()
	w := crunSubmissionWorker(t, st, server.URL)
	payload, _ := json.Marshal(taskflow.RunTaskPayload{TaskID: task.ID.String()})
	if err := w.handleRunTask(ctx, asynq.NewTask(taskflow.TypeRunTask, payload)); err != nil {
		t.Fatal(err)
	}
	current, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil || current.Status != "failed" || current.Attempt != 0 || current.ErrorCode == nil || *current.ErrorCode != "upstream_submission_uncertain" {
		t.Fatalf("task=%+v err=%v", current, err)
	}
	balance, err := store.GetWallet(ctx, st.Pool, task.UserID)
	if err != nil || balance.BalanceCents != 100 || balance.FrozenCents != 0 || creates.Load() != 1 {
		t.Fatalf("wallet=%+v creates=%d err=%v", balance, creates.Load(), err)
	}
	if isRetryableTaskError(&crun.SubmissionUncertainError{Err: context.DeadlineExceeded}) {
		t.Fatal("network unwrap bypassed uncertain submission protection")
	}
}

func TestCRUNPreflightFailureCanRetryBeforeAnyJobExists(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	task := fundedCRUNSubmissionTask(t, st, true)
	var creates atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/client/job/CreateTask" {
			creates.Add(1)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"code":503,"message":"estimate unavailable"}`)
	}))
	defer server.Close()
	w := crunSubmissionWorker(t, st, server.URL)
	payload, _ := json.Marshal(taskflow.RunTaskPayload{TaskID: task.ID.String()})
	if err := w.handleRunTask(ctx, asynq.NewTask(taskflow.TypeRunTask, payload)); err != nil {
		t.Fatal(err)
	}
	current, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil || current.Status != "queued" || current.Attempt != 1 || creates.Load() != 0 {
		t.Fatalf("task=%+v creates=%d err=%v", current, creates.Load(), err)
	}
}
