package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/hibiken/asynq"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPreparingCancelDuringCRUNEstimateRefundsWithoutSendingGeneration(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	entered, released := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var created atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/client/job/EstimateTask" {
			once.Do(func() { close(entered) })
			<-released
			fmt.Fprint(w, `{"code":200,"data":{"affordable":true,"estimated_credits":1,"balance":50}}`)
			return
		}
		created.Add(1)
		fmt.Fprint(w, `{"code":200,"data":{"task_id":"must-not-create"}}`)
	}))
	defer server.Close()
	w := crunSubmissionWorker(t, st, server.URL)
	task := fundedCRUNSubmissionTask(t, st, true)
	body, _ := json.Marshal(taskflow.RunTaskPayload{TaskID: task.ID.String()})
	done := make(chan error, 1)
	go func() { done <- w.handleRunTask(ctx, asynq.NewTask(taskflow.TypeRunTask, body)) }()
	select {
	case <-entered:
	case err := <-done:
		close(released)
		t.Fatalf("worker stopped before estimate: %v", err)
	case <-time.After(10 * time.Second):
		close(released)
		t.Fatal("estimate did not start")
	}
	current, err := store.GetTask(ctx, st.Pool, task.ID)
	if err != nil {
		close(released)
		t.Fatal(err)
	}
	if current.Params["_generationStage"] != "preparing" {
		close(released)
		t.Fatalf("marked submitted before estimate finished: %v", current.Params["_generationStage"])
	}
	if _, err := taskflow.CancelTaskConfirmed(ctx, st, task.UserID, task.ID, false); err != nil {
		close(released)
		t.Fatal(err)
	}
	close(released)
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("canceled worker did not finish")
	}
	if created.Load() != 0 {
		t.Fatalf("canceled preparation sent %d generation requests", created.Load())
	}
	funds, err := store.GetWallet(ctx, st.Pool, task.UserID)
	if err != nil || funds.BalanceCents != 100 || funds.FrozenCents != 0 {
		t.Fatalf("refund=%+v err=%v", funds, err)
	}
	if pending, err := store.CountPendingTaskUpstreamAttempts(ctx, st.Pool, task.ID); err != nil || pending != 0 {
		t.Fatalf("pending attempts=%d err=%v", pending, err)
	}
}
