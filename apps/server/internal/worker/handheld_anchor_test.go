package worker

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestWaitForHandheldAnchor(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "handheld-anchor-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	newTask := func(t *testing.T, params map[string]any, inputs []string) *store.Task {
		t.Helper()
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "test-model",
			Prompt: "base", Count: 1, WorkUnits: 1, Params: params, InputKeys: inputs,
		})
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	reload := func(t *testing.T, id uuid.UUID) *store.Task {
		t.Helper()
		task, err := store.GetTask(ctx, st.Pool, id)
		if err != nil || task == nil {
			t.Fatalf("reload %s: %v", id, err)
		}
		return task
	}
	succeed := func(t *testing.T, id uuid.UUID) {
		t.Helper()
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded', output_keys='["tasks/u/hero.png"]'::jsonb, finished_at=now() WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	w := &Worker{St: st}

	t.Run("hero succeeded: follower gets the hero as last reference", func(t *testing.T) {
		hero := newTask(t, nil, []string{"uploads/u/front.png"})
		succeed(t, hero.ID)
		follower := newTask(t, map[string]any{store.HandheldAnchorTaskParam: hero.ID.String()}, []string{"uploads/u/front.png"})
		waiting, err := w.waitForSeriesAnchor(ctx, follower.ID)
		if err != nil || waiting {
			t.Fatalf("waiting=%v err=%v", waiting, err)
		}
		got := reload(t, follower.ID)
		if len(got.InputKeys) != 2 || got.InputKeys[1] != "tasks/u/hero.png" {
			t.Fatalf("input keys = %v", got.InputKeys)
		}
		if !strings.Contains(got.Prompt, "整套参考") || got.Params[store.HandheldAnchorResolvedParam] != true {
			t.Fatalf("prompt/params not updated: %q %v", got.Prompt, got.Params)
		}
		// 已处理过：再次执行不会重复追加
		if _, err := w.waitForSeriesAnchor(ctx, follower.ID); err != nil {
			t.Fatal(err)
		}
		if again := reload(t, follower.ID); len(again.InputKeys) != 2 {
			t.Fatalf("anchor appended twice: %v", again.InputKeys)
		}
	})

	t.Run("hero failed: follower runs without reference", func(t *testing.T) {
		hero := newTask(t, nil, []string{"uploads/u/front.png"})
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='failed' WHERE id=$1`, hero.ID); err != nil {
			t.Fatal(err)
		}
		follower := newTask(t, map[string]any{store.HandheldAnchorTaskParam: hero.ID.String()}, []string{"uploads/u/front.png"})
		if waiting, err := w.waitForSeriesAnchor(ctx, follower.ID); err != nil || waiting {
			t.Fatalf("waiting=%v err=%v", waiting, err)
		}
		got := reload(t, follower.ID)
		if len(got.InputKeys) != 1 || got.Prompt != "base" || got.Params[store.HandheldAnchorResolvedParam] != true {
			t.Fatalf("unexpected follower: %v %q %v", got.InputKeys, got.Prompt, got.Params)
		}
	})

	t.Run("references full: hero is not appended", func(t *testing.T) {
		hero := newTask(t, nil, nil)
		succeed(t, hero.ID)
		inputs := []string{"a.png", "b.png", "c.png", "d.png", "e.png", "f.png"}
		follower := newTask(t, map[string]any{store.HandheldAnchorTaskParam: hero.ID.String()}, inputs)
		if _, err := w.waitForSeriesAnchor(ctx, follower.ID); err != nil {
			t.Fatal(err)
		}
		if got := reload(t, follower.ID); len(got.InputKeys) != 6 {
			t.Fatalf("input keys = %v", got.InputKeys)
		}
	})

	t.Run("hero still running: follower is re-queued, not changed", func(t *testing.T) {
		hero := newTask(t, nil, nil)
		follower := newTask(t, map[string]any{store.HandheldAnchorTaskParam: hero.ID.String()}, []string{"uploads/u/front.png"})
		queue, err := taskflow.NewQueue("redis://127.0.0.1:1", 1)
		if err != nil {
			t.Fatal(err)
		}
		defer queue.Close()
		waiting := &Worker{St: st, Queue: queue}
		// 测试环境没有 Redis：重新排队失败时要把错误交回给队列重试，而不是跳过等待直接执行
		if deferred, err := waiting.waitForSeriesAnchor(ctx, follower.ID); err == nil || deferred {
			t.Fatalf("expected enqueue error, got deferred=%v err=%v", deferred, err)
		}
		if got := reload(t, follower.ID); got.Params[store.HandheldAnchorResolvedParam] == true || len(got.InputKeys) != 1 {
			t.Fatalf("follower changed while hero running: %v %v", got.Params, got.InputKeys)
		}
	})

	t.Run("series anchor: follower gets the hero with the series prompt", func(t *testing.T) {
		hero := newTask(t, nil, []string{"uploads/u/front.png"})
		succeed(t, hero.ID)
		inputs := []string{"a.png", "b.png", "c.png", "d.png", "e.png", "f.png"}
		follower := newTask(t, map[string]any{store.SeriesAnchorTaskParam: hero.ID.String()}, inputs)
		if waiting, err := w.waitForSeriesAnchor(ctx, follower.ID); err != nil || waiting {
			t.Fatalf("waiting=%v err=%v", waiting, err)
		}
		got := reload(t, follower.ID)
		// 通用整套不受手持 6 张上限限制
		if len(got.InputKeys) != 7 || got.InputKeys[6] != "tasks/u/hero.png" {
			t.Fatalf("input keys = %v", got.InputKeys)
		}
		if !strings.Contains(got.Prompt, "布景语言") || strings.Contains(got.Prompt, "握法") {
			t.Fatalf("prompt = %q", got.Prompt)
		}
	})

	t.Run("series anchor from another user is ignored", func(t *testing.T) {
		stranger, err := store.InsertUser(ctx, st.Pool, "handheld-anchor-"+uuid.NewString()+"@example.com", "", "", "user", nil)
		if err != nil {
			t.Fatal(err)
		}
		hero, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: stranger.ID, Type: "ecommerce_design", Model: "test-model",
			Prompt: "base", Count: 1, WorkUnits: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		succeed(t, hero.ID)
		follower := newTask(t, map[string]any{store.SeriesAnchorTaskParam: hero.ID.String()}, []string{"uploads/u/front.png"})
		if _, err := w.waitForSeriesAnchor(ctx, follower.ID); err != nil {
			t.Fatal(err)
		}
		if got := reload(t, follower.ID); len(got.InputKeys) != 1 || got.Prompt != "base" {
			t.Fatalf("foreign hero leaked: %v %q", got.InputKeys, got.Prompt)
		}
	})

	t.Run("plain tasks are untouched", func(t *testing.T) {
		plain := newTask(t, nil, []string{"uploads/u/front.png"})
		if waiting, err := w.waitForSeriesAnchor(ctx, plain.ID); err != nil || waiting {
			t.Fatalf("waiting=%v err=%v", waiting, err)
		}
		if got := reload(t, plain.ID); got.Prompt != "base" || len(got.InputKeys) != 1 {
			t.Fatalf("plain task changed: %q %v", got.Prompt, got.InputKeys)
		}
	})
}
