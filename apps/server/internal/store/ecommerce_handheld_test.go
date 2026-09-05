package store_test

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/google/uuid"
)

func TestEcommerceHandheldTaskStatusSync(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "handheld-status-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}

	createBatch := func(t *testing.T, count int) (*store.EcommerceHandheldBatch, []*store.Task) {
		t.Helper()
		batch := &store.EcommerceHandheldBatch{
			UserID: user.ID, Status: "generating", ModelID: "test-model",
			ProductSnapshot: map[string]any{}, JobSpec: map[string]any{}, ItemCount: count,
		}
		if err := store.InsertEcommerceHandheldBatch(ctx, st.Pool, batch); err != nil {
			t.Fatal(err)
		}
		tasks := make([]*store.Task, 0, count)
		for index := 0; index < count; index++ {
			task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
				ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "test-model",
				Prompt: "test", Count: 1, WorkUnits: 1,
			})
			if err != nil {
				t.Fatal(err)
			}
			item := &store.EcommerceHandheldItem{
				BatchID: batch.ID, UserID: user.ID, TaskID: &task.ID, ItemIndex: index,
				Prompt: "test", ShotSpec: map[string]any{}, Status: "queued",
				QAStatus: "pending", ReviewStatus: "unreviewed",
			}
			if err := store.InsertEcommerceHandheldItem(ctx, st.Pool, item); err != nil {
				t.Fatal(err)
			}
			tasks = append(tasks, task)
		}
		return batch, tasks
	}

	assertBatchStatus := func(t *testing.T, batchID uuid.UUID, want string) {
		t.Helper()
		var got string
		if err := st.Pool.QueryRow(ctx, `SELECT status FROM ecommerce_handheld_batches WHERE id=$1`, batchID).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("batch status = %q, want %q", got, want)
		}
	}

	t.Run("all succeeded", func(t *testing.T) {
		batch, tasks := createBatch(t, 2)
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded' WHERE id=$1`, tasks[0].ID); err != nil {
			t.Fatal(err)
		}
		assertBatchStatus(t, batch.ID, "generating")
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded' WHERE id=$1`, tasks[1].ID); err != nil {
			t.Fatal(err)
		}
		assertBatchStatus(t, batch.ID, "review_ready")
		var itemStatus string
		if err := st.Pool.QueryRow(ctx, `SELECT status FROM ecommerce_handheld_items WHERE task_id=$1`, tasks[0].ID).Scan(&itemStatus); err != nil {
			t.Fatal(err)
		}
		if itemStatus != "succeeded" {
			t.Fatalf("item status = %q, want succeeded", itemStatus)
		}
	})

	t.Run("partial", func(t *testing.T) {
		batch, tasks := createBatch(t, 2)
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status=CASE WHEN id=$1 THEN 'succeeded' ELSE 'failed' END WHERE id=ANY($2)`, tasks[0].ID, []uuid.UUID{tasks[0].ID, tasks[1].ID}); err != nil {
			t.Fatal(err)
		}
		assertBatchStatus(t, batch.ID, "partial")
	})

	for name, terminal := range map[string]string{"all failed": "failed", "all canceled": "canceled"} {
		t.Run(name, func(t *testing.T) {
			batch, tasks := createBatch(t, 2)
			if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status=$1 WHERE id=ANY($2)`, terminal, []uuid.UUID{tasks[0].ID, tasks[1].ID}); err != nil {
				t.Fatal(err)
			}
			assertBatchStatus(t, batch.ID, terminal)
		})
	}

	t.Run("failed task requeued", func(t *testing.T) {
		batch, tasks := createBatch(t, 1)
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='failed' WHERE id=$1`, tasks[0].ID); err != nil {
			t.Fatal(err)
		}
		assertBatchStatus(t, batch.ID, "failed")
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='queued' WHERE id=$1`, tasks[0].ID); err != nil {
			t.Fatal(err)
		}
		assertBatchStatus(t, batch.ID, "generating")
	})
}

func TestRetryEcommerceHandheldItemReusesBatchAndItem(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "handheld-retry-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	batch := &store.EcommerceHandheldBatch{
		UserID: user.ID, Status: "generating", ModelID: "test-model",
		ProductSnapshot: map[string]any{}, JobSpec: map[string]any{}, ItemCount: 2,
	}
	if err := store.InsertEcommerceHandheldBatch(ctx, st.Pool, batch); err != nil {
		t.Fatal(err)
	}
	oldTasks := make([]*store.Task, 0, 2)
	items := make([]*store.EcommerceHandheldItem, 0, 2)
	for index := 0; index < 2; index++ {
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "test-model",
			Prompt: "test", Count: 1, WorkUnits: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		item := &store.EcommerceHandheldItem{
			BatchID: batch.ID, UserID: user.ID, TaskID: &task.ID, ItemIndex: index,
			Prompt: "test", ShotSpec: map[string]any{}, Status: "queued",
			QAStatus: "pending", ReviewStatus: "unreviewed",
		}
		if err := store.InsertEcommerceHandheldItem(ctx, st.Pool, item); err != nil {
			t.Fatal(err)
		}
		if err := store.InsertEcommerceHandheldQualityReport(ctx, st.Pool, item.ID); err != nil {
			t.Fatal(err)
		}
		oldTasks = append(oldTasks, task)
		items = append(items, item)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status=CASE WHEN id=$1 THEN 'succeeded' ELSE 'failed' END WHERE id=ANY($2)`, oldTasks[0].ID, []uuid.UUID{oldTasks[0].ID, oldTasks[1].ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE ecommerce_handheld_items SET qa_status='failed',review_status='rejected',review_note='old' WHERE id=$1`, items[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE ecommerce_handheld_quality_reports SET status='failed',detector='test',checks='[{"ok":false}]',score=12,summary='old' WHERE item_id=$1`, items[1].ID); err != nil {
		t.Fatal(err)
	}
	newTask, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "test-model",
		Prompt: "retry", Count: 1, WorkUnits: 1, CostCents: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	updatedBatchID, updated, err := store.RetryEcommerceHandheldItem(ctx, st.Pool, user.ID, items[1].ID, oldTasks[1].ID, newTask.ID, newTask.CostCents)
	if err != nil || !updated || updatedBatchID != batch.ID {
		t.Fatalf("retry item: batch=%s updated=%v err=%v", updatedBatchID, updated, err)
	}

	var batchRows, itemRows, itemCount int
	var batchStatus string
	var totalCost int64
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM ecommerce_handheld_batches WHERE user_id=$1`, user.ID).Scan(&batchRows); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM ecommerce_handheld_items WHERE batch_id=$1`, batch.ID).Scan(&itemRows); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT item_count,status,total_cost_cents FROM ecommerce_handheld_batches WHERE id=$1`, batch.ID).Scan(&itemCount, &batchStatus, &totalCost); err != nil {
		t.Fatal(err)
	}
	if batchRows != 1 || itemRows != 2 || itemCount != 2 || batchStatus != "generating" || totalCost != 7 {
		t.Fatalf("batch changed unexpectedly: batches=%d items=%d itemCount=%d status=%s cost=%d", batchRows, itemRows, itemCount, batchStatus, totalCost)
	}
	var succeededTaskID, retriedTaskID uuid.UUID
	if err := st.Pool.QueryRow(ctx, `SELECT task_id FROM ecommerce_handheld_items WHERE id=$1`, items[0].ID).Scan(&succeededTaskID); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT task_id FROM ecommerce_handheld_items WHERE id=$1`, items[1].ID).Scan(&retriedTaskID); err != nil {
		t.Fatal(err)
	}
	if succeededTaskID != oldTasks[0].ID || retriedTaskID != newTask.ID {
		t.Fatalf("task links = succeeded:%s retried:%s", succeededTaskID, retriedTaskID)
	}
	var qaStatus, reviewStatus, reviewNote, reportStatus, detector, summary string
	var score *float64
	if err := st.Pool.QueryRow(ctx, `SELECT qa_status,review_status,review_note FROM ecommerce_handheld_items WHERE id=$1`, items[1].ID).Scan(&qaStatus, &reviewStatus, &reviewNote); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT status,detector,score,summary FROM ecommerce_handheld_quality_reports WHERE item_id=$1`, items[1].ID).Scan(&reportStatus, &detector, &score, &summary); err != nil {
		t.Fatal(err)
	}
	if qaStatus != "pending" || reviewStatus != "unreviewed" || reviewNote != "" || reportStatus != "pending" || detector != "manual_required" || score != nil || summary != "等待视觉检测器" {
		t.Fatalf("retry state not reset: qa=%s review=%s note=%q report=%s detector=%s score=%v summary=%q", qaStatus, reviewStatus, reviewNote, reportStatus, detector, score, summary)
	}
	if _, updated, err := store.RetryEcommerceHandheldItem(ctx, st.Pool, user.ID, items[1].ID, oldTasks[1].ID, uuid.New(), 7); err != nil || updated {
		t.Fatalf("duplicate retry updated=%v err=%v", updated, err)
	}
	if _, updated, err := store.RetryEcommerceHandheldItem(ctx, st.Pool, user.ID, items[0].ID, oldTasks[0].ID, uuid.New(), 7); err != nil || updated {
		t.Fatalf("succeeded item retry updated=%v err=%v", updated, err)
	}
}
