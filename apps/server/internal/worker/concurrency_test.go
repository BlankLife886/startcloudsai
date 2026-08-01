package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
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

func TestSelectExecutionCandidateAvoidsFailedProvider(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Provider: modelconfig.Provider{ID: "failed", MaxConcurrency: 100}},
		{Provider: modelconfig.Provider{ID: "backup", MaxConcurrency: 100}},
	}
	selected, ok := selectExecutionCandidateAvoiding(candidates, map[string]int64{}, "failed")
	if !ok || selected.Provider.ID != "backup" {
		t.Fatalf("selected = %#v, ok=%v", selected, ok)
	}
	selected, ok = selectExecutionCandidateAvoiding(candidates[:1], map[string]int64{}, "failed")
	if !ok || selected.Provider.ID != "failed" {
		t.Fatalf("single provider fallback = %#v, ok=%v", selected, ok)
	}
}

func TestSelectExecutionCandidateExcludesAllPreviouslyFailedProviders(t *testing.T) {
	candidates := []modelconfig.Selection{
		{Provider: modelconfig.Provider{ID: "a", MaxConcurrency: 100}},
		{Provider: modelconfig.Provider{ID: "b", MaxConcurrency: 100}},
		{Provider: modelconfig.Provider{ID: "c", MaxConcurrency: 100}},
	}
	selected, ok := selectExecutionCandidateExcluding(candidates, map[string]int64{}, map[string]bool{"a": true, "b": true})
	if !ok || selected.Provider.ID != "c" {
		t.Fatalf("selected = %#v, ok=%v", selected, ok)
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

func TestSelectExecutionCandidateDistributesTenThousandAcrossProviderPool(t *testing.T) {
	candidates := make([]modelconfig.Selection, 100)
	running := make(map[string]int64, len(candidates))
	for index := range candidates {
		candidates[index].Provider = modelconfig.Provider{ID: fmt.Sprintf("provider-%03d", index), MaxConcurrency: 100}
	}
	for index := 0; index < 10000; index++ {
		selected, ok := selectExecutionCandidate(candidates, running)
		if !ok {
			t.Fatalf("selection stopped at %d", index)
		}
		running[selected.Provider.ID]++
	}
	for providerID, count := range running {
		if count != 100 {
			t.Fatalf("provider %s count = %d", providerID, count)
		}
	}
	if _, ok := selectExecutionCandidate(candidates, running); ok {
		t.Fatal("pool must be full after 10000 selections")
	}
}

func TestClaimTaskDistributesAcrossConfiguredProviderCapacity(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	const masterKey = "worker-provider-pool-test-key"
	encrypted, err := settings.EncryptSecret("provider-secret", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Config{
		Version: modelconfig.Version,
		Providers: []modelconfig.Provider{
			{ID: "provider-a", Name: "A", Adapter: modelconfig.AdapterOpenAI, BaseURL: "https://a.example.com", APIKey: encrypted, MaxConcurrency: 2, Enabled: true},
			{ID: "provider-b", Name: "B", Adapter: modelconfig.AdapterOpenAI, BaseURL: "https://b.example.com", APIKey: encrypted, MaxConcurrency: 1, Enabled: true},
		},
		Models: []modelconfig.Model{
			{ID: "model-a", Name: "Image", ProviderID: "provider-a", UpstreamModel: "image-model", Kind: modelconfig.ModelKindImage, Enabled: true, Public: true},
			{ID: "model-b", Name: "Image backup", ProviderID: "provider-b", UpstreamModel: "image-model", Kind: modelconfig.ModelKindImage, Enabled: true},
		},
	}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"global_max_concurrent_tasks": "100", "user_max_concurrent_tasks": "100"} {
		if err := settings.Set(ctx, st.Pool, key, json.RawMessage(value)); err != nil {
			t.Fatal(err)
		}
	}
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("provider-pool-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		params := `{"_providerConfigId":"provider-a","_modelConfigId":"model-a","_serviceProvider":"openai"}`
		if err := st.Pool.QueryRow(ctx,
			`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents) VALUES ($1, 't2i', 'test', $2, 'queued', 0) RETURNING id`,
			user.ID, params).Scan(&ids[index]); err != nil {
			t.Fatal(err)
		}
	}
	w := &Worker{St: st, Cfg: &config.Config{AppSecret: masterKey}}
	for index := 0; index < 3; index++ {
		claimed, reason, err := w.claimTask(ctx, ids[index])
		if err != nil || reason != "" || claimed == nil {
			t.Fatalf("claim %d task=%#v reason=%q err=%v", index, claimed, reason, err)
		}
	}
	counts, err := store.RunningTasksByProvider(ctx, st.Pool, []string{"provider-a", "provider-b"})
	if err != nil || counts["provider-a"] != 2 || counts["provider-b"] != 1 {
		t.Fatalf("provider counts=%#v err=%v", counts, err)
	}
	claimed, reason, err := w.claimTask(ctx, ids[3])
	if err != nil || claimed != nil || reason != "provider_execution_limit" {
		t.Fatalf("full pool task=%#v reason=%q err=%v", claimed, reason, err)
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
