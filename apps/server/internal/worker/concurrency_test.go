package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestSelectExecutionCandidateUsesCapacityWeightedLoad(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Provider: modelconfig.Provider{ID: "small", MaxConcurrency: 10}},
		{Provider: modelconfig.Provider{ID: "large", MaxConcurrency: 100}},
	}
	selected, ok := selectExecutionCandidate(candidates, map[string]int64{"small": 2, "large": 10})
	if !ok || selected.Provider.ID != "large" {
		t.Fatalf("selected = %#v, ok=%v", selected, ok)
	}
	if _, ok := selectExecutionCandidate(candidates, map[string]int64{"small": 10, "large": 100}); ok {
		t.Fatal("all full providers must defer")
	}
}

func TestSelectExecutionCandidateDistributesSyntheticLoadByCapacity(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Provider: modelconfig.Provider{ID: "a", MaxConcurrency: 200}},
		{Provider: modelconfig.Provider{ID: "b", MaxConcurrency: 600}},
	}
	running := map[string]int64{}
	for index := 0; index < 800; index++ {
		selected, ok := selectExecutionCandidate(candidates, running)
		if !ok {
			t.Fatalf("selection stopped at %d", index)
		}
		running[selected.Provider.ID]++
	}
	if running["a"] != 200 || running["b"] != 600 {
		t.Fatalf("distribution = %#v", running)
	}
	if _, ok := selectExecutionCandidate(candidates, running); ok {
		t.Fatal("801st task must wait for provider capacity")
	}
}

func TestClaimTaskDefersWhenUserExecutionSlotsAreFull(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("worker-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(ctx, st.Pool, "user_max_concurrent_tasks", json.RawMessage(`1`)); err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, 2)
	for index := range ids {
		if err := st.Pool.QueryRow(ctx,
			`INSERT INTO tasks (user_id, type, prompt, status, cost_cents) VALUES ($1, 't2i', 'test', 'queued', 0) RETURNING id`,
			user.ID).Scan(&ids[index]); err != nil {
			t.Fatal(err)
		}
	}
	w := &Worker{St: st}
	claimed, deferReason, err := w.claimTask(ctx, ids[0])
	if err != nil || deferReason != "" || claimed == nil {
		t.Fatalf("first claim = task %v deferReason=%q err=%v", claimed, deferReason, err)
	}
	claimed, deferReason, err = w.claimTask(ctx, ids[1])
	if err != nil || deferReason != "user_execution_limit" || claimed != nil {
		t.Fatalf("second claim = task %v deferReason=%q err=%v", claimed, deferReason, err)
	}
}

func TestClaimTaskDefersAtDynamicGlobalExecutionLimit(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "global_max_concurrent_tasks", json.RawMessage(`1`)); err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(ctx, st.Pool, "user_max_concurrent_tasks", json.RawMessage(`10`)); err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, 2)
	for index := range ids {
		user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("global-worker-%d-%s@test.dev", index, uuid.NewString()[:8]), "worker", "x", "user", nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := st.Pool.QueryRow(ctx,
			`INSERT INTO tasks (user_id, type, prompt, status, cost_cents) VALUES ($1, 't2i', 'test', 'queued', 0) RETURNING id`,
			user.ID).Scan(&ids[index]); err != nil {
			t.Fatal(err)
		}
	}
	w := &Worker{St: st}
	claimed, deferReason, err := w.claimTask(ctx, ids[0])
	if err != nil || deferReason != "" || claimed == nil {
		t.Fatalf("first global claim = task %v deferReason=%q err=%v", claimed, deferReason, err)
	}
	claimed, deferReason, err = w.claimTask(ctx, ids[1])
	if err != nil || deferReason != "global_execution_limit" || claimed != nil {
		t.Fatalf("second global claim = task %v deferReason=%q err=%v", claimed, deferReason, err)
	}
}

func TestOutputCollectorIgnoresUnexpectedExtraOutput(t *testing.T) {
	collector := newTaskOutputCollector(&Worker{}, context.Background(), &store.Task{ID: uuid.New(), Count: 1})
	if err := collector.persist(1, "not-used"); err != nil {
		t.Fatalf("extra output should be ignored: %v", err)
	}
}
