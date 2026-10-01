package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/executionconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func executionTestSetting(t *testing.T, st *store.Store, key string, value int) {
	t.Helper()
	if err := settings.Set(context.Background(), st.Pool, key, json.RawMessage(fmt.Sprint(value))); err != nil {
		t.Fatal(err)
	}
}

func executionTestImage(t *testing.T, st *store.Store, user uuid.UUID, count int, source string) *store.Task {
	t.Helper()
	id := queuedSharedImage(t, st, user)
	if _, err := st.Pool.Exec(context.Background(), `UPDATE tasks SET count=$2,work_units=$2,params=params||jsonb_build_object('_source',$3::text) WHERE id=$1`, id, count, source); err != nil {
		t.Fatal(err)
	}
	task, err := store.GetTask(context.Background(), st.Pool, id)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func executionTestAssistant(t *testing.T, st *store.Store, user uuid.UUID, count int, reserved int64) *store.AssistantRun {
	t.Helper()
	run := insertAssistantRoutingTestRun(t, st, user, "image", modelconfig.WorkspaceAssistant, reserved)
	if _, err := st.Pool.Exec(context.Background(), `UPDATE assistant_runs SET params=params||jsonb_build_object('count',$2::int,'_billingUnitPriceCents',5) WHERE id=$1`, run.ID, count); err != nil {
		t.Fatal(err)
	}
	run, err := store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func TestExecutionPoolsCrossEntryImagesAndIndependentChat(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 30)
	user := assistantRoutingTestUser(t, st, 100)
	first := executionTestImage(t, st, user.ID, 1, "text_to_image")
	canvas := executionTestImage(t, st, user.ID, 1, "react_canvas")
	commerce := executionTestImage(t, st, user.ID, 1, "ecommerce")
	for _, task := range []*store.Task{first, canvas} {
		if got, reason, err := w.claimTask(ctx, task.ID); err != nil || got == nil || reason != "" {
			t.Fatalf("claim=%v reason=%s err=%v", got, reason, err)
		}
	}
	image := executionTestAssistant(t, st, user.ID, 2, 10)
	claimed, err := w.claimAssistantRun(ctx, image.ID, "image-owner")
	if err != nil || claimed == nil {
		t.Fatalf("assistant=%v err=%v", claimed, err)
	}
	if got, reason, err := w.claimTask(ctx, commerce.ID); err != nil || got != nil || reason != "user_execution_limit" {
		t.Fatalf("commerce escaped image cap: task=%v reason=%s err=%v", got, reason, err)
	}
	chat := insertAssistantRoutingTestRun(t, st, user.ID, "chat", modelconfig.WorkspaceAssistant, 0)
	if got, err := w.claimAssistantRun(ctx, chat.ID, "chat-owner"); err != nil || got == nil {
		t.Fatalf("images blocked chat: %v %v", got, err)
	}
	account, err := store.GetUserConcurrency(ctx, st.Pool, user.ID)
	if err != nil || account.ImageRunning != 4 || account.ChatRunning != 1 {
		t.Fatalf("usage=%+v err=%v", account, err)
	}
	routes, err := store.RunningExecutionUnitsByProvider(ctx, st.Pool, []string{"chat-provider/route-a"})
	if err != nil || routes["chat-provider/route-a"] != 5 {
		t.Fatalf("route usage=%v err=%v", routes, err)
	}
	if changed, err := assistantbilling.CompleteImageAttempt(ctx, st, claimed.ID, claimed.Attempt, 1); err != nil || !changed {
		t.Fatalf("partial settlement=%v %v", changed, err)
	}
	funds, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || funds.FrozenCents != 0 || funds.BalanceCents != 95 {
		t.Fatalf("partial refund=%+v err=%v", funds, err)
	}
	if got, _, err := w.claimTask(ctx, commerce.ID); err != nil || got == nil {
		t.Fatalf("completed batch retained slots: %v %v", got, err)
	}
}

func TestExecutionPoolsConcurrentClaimsCannotExceedEitherPool(t *testing.T) {
	st := testdb.Setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	w := assistantRoutingTestWorker(t, st, 40)
	user := assistantRoutingTestUser(t, st, 0)
	type item struct {
		id    uuid.UUID
		mode  string
		units int64
	}
	var items []item
	for range 8 {
		items = append(items, item{executionTestImage(t, st, user.ID, 1, "react_canvas").ID, "task", 1})
		items = append(items, item{executionTestAssistant(t, st, user.ID, 2, 0).ID, "image", 2})
		items = append(items, item{insertAssistantRoutingTestRun(t, st, user.ID, "chat", modelconfig.WorkspaceAssistant, 0).ID, "chat", 1})
	}
	start := make(chan struct{})
	var images, chats atomic.Int64
	errs := make(chan error, len(items))
	var wg sync.WaitGroup
	for _, entry := range items {
		wg.Go(func() {
			<-start
			if entry.mode == "task" {
				run, _, err := w.claimTask(ctx, entry.id)
				if err != nil {
					errs <- err
				} else if run != nil {
					images.Add(entry.units)
				}
			} else {
				run, err := w.claimAssistantRun(ctx, entry.id, uuid.NewString())
				if err != nil {
					errs <- err
				} else if run != nil {
					if entry.mode == "chat" {
						chats.Add(1)
					} else {
						images.Add(entry.units)
					}
				}
			}
		})
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if images.Load() != 4 || chats.Load() != 4 {
		t.Fatalf("claimed image units=%d chat runs=%d want=4/4", images.Load(), chats.Load())
	}
	usage, err := store.GetGlobalExecutionUsage(ctx, st.Pool)
	if err != nil || usage.ImageRunning != 4 || usage.ChatRunning != 4 {
		t.Fatalf("global=%+v %v", usage, err)
	}
}

func TestExecutionPoolsShareRoutesAcrossUsersAndClasses(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 3)
	u1, u2 := assistantRoutingTestUser(t, st, 0), assistantRoutingTestUser(t, st, 0)
	image := executionTestAssistant(t, st, u1.ID, 2, 0)
	if run, err := w.claimAssistantRun(ctx, image.ID, "first"); err != nil || run == nil {
		t.Fatalf("image=%v %v", run, err)
	}
	chat := insertAssistantRoutingTestRun(t, st, u2.ID, "chat", modelconfig.WorkspaceAssistant, 0)
	if run, err := w.claimAssistantRun(ctx, chat.ID, "second"); err != nil || run == nil {
		t.Fatalf("chat=%v %v", run, err)
	}
	task := executionTestImage(t, st, u2.ID, 1, "text_to_image")
	if got, reason, err := w.claimTask(ctx, task.ID); err != nil || got != nil || reason != "provider_execution_limit" {
		t.Fatalf("route overrun: %v %s %v", got, reason, err)
	}
}

func TestExecutionPoolsGlobalCapsRemainSeparate(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 30)
	executionTestSetting(t, st, "global_max_concurrent_tasks", 2)
	executionTestSetting(t, st, "global_max_concurrent_chats", 1)
	u1, u2 := assistantRoutingTestUser(t, st, 0), assistantRoutingTestUser(t, st, 0)
	image := executionTestAssistant(t, st, u1.ID, 2, 0)
	if got, err := w.claimAssistantRun(ctx, image.ID, "images"); err != nil || got == nil {
		t.Fatalf("image=%v %v", got, err)
	}
	other := executionTestImage(t, st, u2.ID, 1, "ecommerce")
	if got, reason, err := w.claimTask(ctx, other.ID); err != nil || got != nil || reason != "global_execution_limit" {
		t.Fatalf("global image overrun: %v %s %v", got, reason, err)
	}
	for index, user := range []*store.User{u1, u2} {
		chat := insertAssistantRoutingTestRun(t, st, user.ID, "chat", modelconfig.WorkspaceAssistant, 0)
		got, err := w.claimAssistantRun(ctx, chat.ID, fmt.Sprint(index))
		if err != nil || (got != nil) != (index == 0) {
			t.Fatalf("chat %d=%v err=%v", index, got, err)
		}
	}
}

func TestExecutionPoolsRejectBatchThatCannotFitRemainingRoute(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4, 2)
	user := assistantRoutingTestUser(t, st, 100)
	image := executionTestAssistant(t, st, user.ID, 4, 20)
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := executionconfig.CaptureAssistant(ctx, st.Pool, image, cfg, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET params=params||'{"_failedImageProviderRouteKeys":["chat-provider/route-a"]}'::jsonb WHERE id=$1`, image.ID); err != nil {
		t.Fatal(err)
	}
	got, err := w.claimAssistantRun(ctx, image.ID, "cannot-fit")
	if got != nil || !errors.Is(err, store.ErrExecutionBatchTooLarge) {
		t.Fatalf("permanent wait not rejected: %v %v", got, err)
	}
	if err := w.failQueuedAssistantRun(ctx, image.ID, err.Error(), "assistant_batch_capacity"); err != nil {
		t.Fatal(err)
	}
	funds, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || funds.BalanceCents != 100 || funds.FrozenCents != 0 {
		t.Fatalf("refund=%+v %v", funds, err)
	}
	if changed, err := assistantbilling.Fail(ctx, st, image.ID, "again", "duplicate failure"); err != nil || changed {
		t.Fatalf("duplicate settlement changed=%v err=%v", changed, err)
	}
}
