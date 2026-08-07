package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func TestAutomaticBackgroundRemovalModelRequiresImageParentConfiguration(t *testing.T) {
	modelKey := "background-tool"
	tests := []struct {
		name string
		task *store.Task
		want string
	}{
		{name: "configured t2i", task: &store.Task{Type: "t2i", Params: map[string]any{
			"autoBackgroundRemovalEnabled":  true,
			"autoBackgroundRemovalModelKey": modelKey,
		}}, want: modelKey},
		{name: "disabled", task: &store.Task{Type: "t2i", Params: map[string]any{
			"autoBackgroundRemovalEnabled":  false,
			"autoBackgroundRemovalModelKey": modelKey,
		}}},
		{name: "background child", task: &store.Task{Type: "background_remove", Params: map[string]any{
			"autoBackgroundRemovalEnabled":  true,
			"autoBackgroundRemovalModelKey": modelKey,
		}}},
		{name: "missing model", task: &store.Task{Type: "t2i", Params: map[string]any{
			"autoBackgroundRemovalEnabled": true,
		}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := automaticBackgroundRemovalModel(tt.task); got != tt.want {
				t.Fatalf("model = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTaskFailureRetryCountDefaultsToTwoAndClamps(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := &Worker{St: st}
	if got := w.taskFailureRetryCount(ctx); got != 2 {
		t.Fatalf("default retry count = %d, want 2", got)
	}
	if err := settings.Set(ctx, st.Pool, "task_failure_retry_count", json.RawMessage(`7`)); err != nil {
		t.Fatal(err)
	}
	if got := w.taskFailureRetryCount(ctx); got != 7 {
		t.Fatalf("configured retry count = %d, want 7", got)
	}
	if err := settings.Set(ctx, st.Pool, "task_failure_retry_count", json.RawMessage(`1000`)); err != nil {
		t.Fatal(err)
	}
	if got := w.taskFailureRetryCount(ctx); got != maxTaskFailureRetries {
		t.Fatalf("clamped retry count = %d, want %d", got, maxTaskFailureRetries)
	}
}

func TestTaskRetryRequiresUpstreamIdempotency(t *testing.T) {
	openAI := &store.Task{Params: map[string]any{"_serviceProvider": modelconfig.AdapterOpenAI}}
	if !taskRetryIsIdempotent(openAI, "") {
		t.Fatal("OpenAI client_task_id retry should be allowed")
	}
	crunUnknown := &store.Task{Params: map[string]any{"_serviceProvider": modelconfig.AdapterCRUN}}
	if taskRetryIsIdempotent(crunUnknown, "") {
		t.Fatal("CRUN retry without durable upstream IDs must be rejected")
	}
	crunKnown := &store.Task{Params: map[string]any{
		"_serviceProvider": modelconfig.AdapterCRUN,
		"_crunTaskIds":     []string{"upstream-1"},
	}}
	if !taskRetryIsIdempotent(crunKnown, "") {
		t.Fatal("CRUN resume with durable upstream IDs should be allowed")
	}
	sub2api := &store.Task{Params: map[string]any{"_serviceProvider": "sub2api"}}
	if taskRetryIsIdempotent(sub2api, "sub2api") {
		t.Fatal("non-idempotent synchronous provider retry must be rejected")
	}
}

func TestTaskDispatchBackoffSpreadsSaturatedQueue(t *testing.T) {
	id := uuid.MustParse("ff000000-0000-0000-0000-000000000000")
	if got := taskDispatchBackoff("user_execution_limit", id); got < 5*time.Second || got > 10*time.Second {
		t.Fatalf("user backoff = %s", got)
	}
	if got := taskDispatchBackoff("provider_execution_limit", id); got < 15*time.Second || got > 30*time.Second {
		t.Fatalf("provider backoff = %s", got)
	}
	if got := taskDispatchBackoff("global_execution_limit", id); got < 15*time.Second || got > 30*time.Second {
		t.Fatalf("global backoff = %s", got)
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

func TestClaimTaskDistributesAcrossBaseURLRoutes(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	const masterKey = "worker-base-url-route-test-key"
	encrypted, err := settings.EncryptSecret("route-secret", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Config{
		Version: modelconfig.Version,
		Providers: []modelconfig.Provider{{
			ID: "provider", Name: "Image Provider", Adapter: modelconfig.AdapterOpenAI, Enabled: true,
			Routes: []modelconfig.ProviderRoute{
				{ID: "route-a", Name: "A", BaseURL: "https://a.example.com", APIKey: encrypted, MaxConcurrency: 2, Enabled: true},
				{ID: "route-b", Name: "B", BaseURL: "https://b.example.com", APIKey: encrypted, MaxConcurrency: 1, Enabled: true},
			},
		}},
		Models: []modelconfig.Model{{
			ID: "image", Name: "Image", ProviderID: "provider", UpstreamModel: "image-model",
			Kind: modelconfig.ModelKindImage, Enabled: true, Public: true,
		}},
	}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"global_max_concurrent_tasks": "100", "user_max_concurrent_tasks": "100"} {
		if err := settings.Set(ctx, st.Pool, key, json.RawMessage(value)); err != nil {
			t.Fatal(err)
		}
	}
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("base-url-routes-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		params := `{"_providerConfigId":"provider","_modelConfigId":"image","_serviceProvider":"openai"}`
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
	counts, err := store.RunningTasksByProvider(ctx, st.Pool, []string{"provider/route-a", "provider/route-b"})
	if err != nil || counts["provider/route-a"] != 2 || counts["provider/route-b"] != 1 {
		t.Fatalf("route counts=%#v err=%v", counts, err)
	}
	claimed, reason, err := w.claimTask(ctx, ids[3])
	if err != nil || claimed != nil || reason != "provider_execution_limit" {
		t.Fatalf("full routes task=%#v reason=%q err=%v", claimed, reason, err)
	}
}

func TestClaimTaskBalancesSameNameAndPriceAcrossProviders(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	const masterKey = "worker-cross-provider-test-key"
	encrypted, err := settings.EncryptSecret("route-secret", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	cfg := modelconfig.Config{
		Version: modelconfig.Version,
		Providers: []modelconfig.Provider{
			{ID: "provider-a", Name: "Provider A", Adapter: modelconfig.AdapterOpenAI, Enabled: true, Routes: []modelconfig.ProviderRoute{{ID: "route-a", Name: "A", BaseURL: "https://a.example.com", APIKey: encrypted, MaxConcurrency: 1, Enabled: true}}},
			{ID: "provider-b", Name: "Provider B", Adapter: modelconfig.AdapterOpenAI, Enabled: true, Routes: []modelconfig.ProviderRoute{{ID: "route-b", Name: "B", BaseURL: "https://b.example.com", APIKey: encrypted, MaxConcurrency: 1, Enabled: true}}},
		},
		Models: []modelconfig.Model{
			{ID: "model-a", Name: "Shared Image", ProviderID: "provider-a", UpstreamModel: "upstream-a", Kind: modelconfig.ModelKindImage, PriceCents: 12, Qualities: []string{"high"}, Public: true, Default: true, Enabled: true},
			{ID: "model-b", Name: "Shared Image", ProviderID: "provider-b", UpstreamModel: "upstream-b", Kind: modelconfig.ModelKindImage, PriceCents: 12, Qualities: []string{"high"}, Public: true, Enabled: true},
		},
	}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{
		"global_max_concurrent_tasks":                 "100",
		"user_max_concurrent_tasks":                   "100",
		"cross_provider_same_model_balancing_enabled": "true",
	} {
		if err := settings.Set(ctx, st.Pool, key, json.RawMessage(value)); err != nil {
			t.Fatal(err)
		}
	}
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("cross-provider-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uuid.UUID, 2)
	for index := range ids {
		params := `{"_providerConfigId":"provider-a","_providerRouteId":"route-a","_modelConfigId":"model-a","_serviceProvider":"openai","_unitPriceCents":12,"quality":"high"}`
		if err := st.Pool.QueryRow(ctx,
			`INSERT INTO tasks (user_id, type, model, prompt, params, status, cost_cents) VALUES ($1, 't2i', 'upstream-a', 'test', $2, 'queued', 12) RETURNING id`,
			user.ID, params).Scan(&ids[index]); err != nil {
			t.Fatal(err)
		}
	}
	w := &Worker{St: st, Cfg: &config.Config{AppSecret: masterKey}}
	first, reason, err := w.claimTask(ctx, ids[0])
	if err != nil || reason != "" || first == nil || taskParamString(first.Params, "_providerConfigId") != "provider-a" {
		t.Fatalf("first claim task=%#v reason=%q err=%v", first, reason, err)
	}
	second, reason, err := w.claimTask(ctx, ids[1])
	if err != nil || reason != "" || second == nil {
		t.Fatalf("second claim task=%#v reason=%q err=%v", second, reason, err)
	}
	if taskParamString(second.Params, "_providerConfigId") != "provider-b" || taskParamString(second.Params, "_modelConfigId") != "model-b" || second.Model != "upstream-b" {
		t.Fatalf("second execution route provider=%q modelID=%q upstream=%q", taskParamString(second.Params, "_providerConfigId"), taskParamString(second.Params, "_modelConfigId"), second.Model)
	}
	if second.CostCents != 12 {
		t.Fatalf("second task cost = %d, want frozen cost 12", second.CostCents)
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

func TestTaskCompletionClaimIsExclusiveAndFencesStaleWriters(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("completion-claim-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	var taskID uuid.UUID
	if err := st.Pool.QueryRow(ctx,
		`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents)
		 VALUES ($1, 't2i', 'test', '{}'::jsonb, 'running', 0) RETURNING id`, user.ID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	const lease = 5 * time.Minute
	firstClaim := uuid.NewString()
	claimed, err := store.TryClaimTaskCompletion(ctx, st.Pool, taskID, firstClaim, now, lease)
	if err != nil || !claimed {
		t.Fatalf("first claim = %v, err=%v", claimed, err)
	}
	secondClaim := uuid.NewString()
	claimed, err = store.TryClaimTaskCompletion(ctx, st.Pool, taskID, secondClaim, now.Add(time.Second), lease)
	if err != nil || claimed {
		t.Fatalf("overlapping claim = %v, err=%v", claimed, err)
	}
	if err := store.SetTaskPartialOutputsClaimed(ctx, st.Pool, taskID, []string{"stale"}, nil, secondClaim); err == nil {
		t.Fatal("stale claim must not persist outputs")
	}
	if err := store.SetTaskPartialOutputsClaimed(ctx, st.Pool, taskID, []string{"first"}, nil, firstClaim); err != nil {
		t.Fatalf("owner persist: %v", err)
	}

	claimed, err = store.TryClaimTaskCompletion(ctx, st.Pool, taskID, secondClaim, now.Add(lease+time.Second), lease)
	if err != nil || !claimed {
		t.Fatalf("expired claim takeover = %v, err=%v", claimed, err)
	}
	if err := store.SetTaskPartialOutputsClaimed(ctx, st.Pool, taskID, []string{"expired"}, nil, firstClaim); err == nil {
		t.Fatal("expired owner must be fenced")
	}
	if err := store.SetTaskPartialOutputsClaimed(ctx, st.Pool, taskID, []string{"winner"}, nil, secondClaim); err != nil {
		t.Fatalf("takeover persist: %v", err)
	}

	completed, err := store.MarkTaskSucceededClaimed(ctx, st.Pool, taskID, []string{"stale"}, nil, now, firstClaim)
	if err != nil || completed {
		t.Fatalf("stale completion = %v, err=%v", completed, err)
	}
	failed, err := store.MarkTaskFailedClaimed(ctx, st.Pool, taskID, "running", "stale", "stale", now, firstClaim)
	if err != nil || failed {
		t.Fatalf("stale failure = %v, err=%v", failed, err)
	}
	completed, err = store.MarkTaskSucceededClaimed(ctx, st.Pool, taskID, []string{"winner"}, nil, now, secondClaim)
	if err != nil || !completed {
		t.Fatalf("winning completion = %v, err=%v", completed, err)
	}
	var params map[string]any
	if err := st.Pool.QueryRow(ctx, `SELECT params FROM tasks WHERE id = $1`, taskID).Scan(&params); err != nil {
		t.Fatal(err)
	}
	if params["_completionClaimId"] != nil || params["_completionClaimedAtMs"] != nil {
		t.Fatalf("completion claim leaked into finished task: %#v", params)
	}
}

func TestTaskLeaseFencesStaleSyncWriterAndRetriesAtomically(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("lease-fence-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	owner := "worker-a:" + uuid.NewString()
	staleOwner := "worker-b:" + uuid.NewString()
	var taskID uuid.UUID
	if err := st.Pool.QueryRow(ctx,
		`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents, lease_owner, heartbeat_at, lease_until)
		 VALUES ($1, 't2i', 'test', '{"_providerRouteKey":"route-a"}'::jsonb, 'running', 0, $2, now(), now() + interval '2 minutes') RETURNING id`,
		user.ID, owner).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	if err := store.SetTaskPartialOutputsOwned(ctx, st.Pool, taskID, []string{"stale"}, nil, staleOwner); err == nil {
		t.Fatal("stale lease owner persisted partial output")
	}
	if err := store.SetTaskPartialOutputsOwned(ctx, st.Pool, taskID, []string{"owned"}, nil, owner); err != nil {
		t.Fatalf("lease owner persist: %v", err)
	}
	if won, err := store.MarkTaskSucceededOwned(ctx, st.Pool, taskID, []string{"stale"}, nil, time.Now().UTC(), staleOwner); err != nil || won {
		t.Fatalf("stale success won=%v err=%v", won, err)
	}
	if _, won, err := store.RetryRunningTaskOwned(ctx, st.Pool, taskID, staleOwner, 0, []string{"route-a"}); err != nil || won {
		t.Fatalf("stale retry won=%v err=%v", won, err)
	}
	attempt, won, err := store.RetryRunningTaskOwned(ctx, st.Pool, taskID, owner, 0, []string{"route-a"})
	if err != nil || !won || attempt != 1 {
		t.Fatalf("owned retry attempt=%d won=%v err=%v", attempt, won, err)
	}
	task, err := store.GetTask(ctx, st.Pool, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "queued" || task.Attempt != 1 || task.LeaseOwner != nil || task.StartedAt != nil {
		t.Fatalf("atomic retry state = %#v", task)
	}
	failed := taskParamStrings(task.Params, "_failedProviderConfigIds")
	if len(failed) != 1 || failed[0] != "route-a" {
		t.Fatalf("failed provider history = %#v", failed)
	}
}

func TestExpiredTaskRecoveryIsAtomicAndPreservesLiveLease(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("lease-recovery-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	ids := make([]uuid.UUID, 2)
	for index, leaseUntil := range []time.Time{now.Add(-time.Minute), now.Add(time.Minute)} {
		if err := st.Pool.QueryRow(ctx,
			`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents, lease_owner, heartbeat_at, lease_until, started_at)
			 VALUES ($1, 't2i', 'test', '{}'::jsonb, 'running', 0, $2, now(), $3, now()) RETURNING id`,
			user.ID, fmt.Sprintf("owner-%d", index), leaseUntil).Scan(&ids[index]); err != nil {
			t.Fatal(err)
		}
	}
	recovered, err := store.RequeueExpiredRunningTasks(ctx, st.Pool, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(recovered) != 1 || recovered[0] != ids[0] {
		t.Fatalf("recovered = %#v, want only %s", recovered, ids[0])
	}
	expired, _ := store.GetTask(ctx, st.Pool, ids[0])
	live, _ := store.GetTask(ctx, st.Pool, ids[1])
	if expired.Status != "queued" || live.Status != "running" || live.LeaseOwner == nil {
		t.Fatalf("expired=%#v live=%#v", expired, live)
	}
}

func TestAsyncPendingRoutesCanRebuildLostPollCoordinators(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("poll-recovery-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	var taskID uuid.UUID
	if err := st.Pool.QueryRow(ctx,
		`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents, lease_owner, heartbeat_at, lease_until, started_at)
		 VALUES ($1, 't2i', 'test', '{"_upstreamStage":"async_pending","_providerConfigId":"provider-a","_providerRouteId":"route-a","_providerRouteKey":"provider-a:route-a"}'::jsonb,
		 'running', 0, 'poller:provider-a:route-a', now(), now() + interval '15 minutes', now()) RETURNING id`, user.ID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{
		TaskID: taskID, ProviderID: "provider-a", RouteID: "route-a", RouteKey: "provider-a:route-a",
		Adapter: modelconfig.AdapterOpenAI, UpstreamTaskIDs: []string{taskID.String()},
		SubmittedAt: now, FailoverAt: now.Add(5 * time.Minute), ExpiresAt: now.Add(30 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	routes, err := store.ListAsyncPendingRoutes(ctx, st.Pool, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 || routes[0].ProviderID != "provider-a" || routes[0].RouteID != "route-a" || routes[0].RouteKey != "provider-a:route-a" {
		t.Fatalf("pending routes = %#v", routes)
	}
}

func TestLateUpstreamAttemptSurvivesFailoverAndCompletesQueuedTask(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("late-result-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	owner := "poller:provider-a/route-a"
	var taskID uuid.UUID
	if err := st.Pool.QueryRow(ctx,
		`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents, lease_owner, heartbeat_at, lease_until, started_at)
		 VALUES ($1, 't2i', 'test', '{"_providerConfigId":"provider-a","_providerRouteId":"route-a","_providerRouteKey":"provider-a/route-a"}'::jsonb,
		 'running', 0, $2, now(), now() + interval '15 minutes', now()) RETURNING id`, user.ID, owner).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	attemptID, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{
		TaskID: taskID, ProviderID: "provider-a", RouteID: "route-a", RouteKey: "provider-a/route-a",
		Adapter: modelconfig.AdapterOpenAI, UpstreamTaskIDs: []string{taskID.String()}, BaseURL: "https://old.example",
		APIKeyEncrypted: "encrypted-old-key", SubmittedAt: now,
		FailoverAt: now.Add(-time.Second), ExpiresAt: now.Add(30 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, won, err := store.RetryRunningTaskOwned(ctx, st.Pool, taskID, owner, 0, []string{"provider-a/route-a"}); err != nil || !won {
		t.Fatalf("failover requeue won=%v err=%v", won, err)
	}
	claimedTasks, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, "provider-a/route-a", "attempt-poller:test", now, time.Minute, 10)
	if err != nil || len(claimedTasks) != 1 {
		t.Fatalf("claimed old attempts=%d err=%v", len(claimedTasks), err)
	}
	if got := upstreamAttemptID(claimedTasks[0]); got != attemptID {
		t.Fatalf("attempt id=%s want=%s", got, attemptID)
	}
	claimID := uuid.NewString()
	claimed, err := store.TryClaimTaskCompletion(ctx, st.Pool, taskID, claimID, now, time.Minute)
	if err != nil || !claimed {
		t.Fatalf("late completion claim=%v err=%v", claimed, err)
	}
	completed, err := store.MarkTaskSucceededClaimed(ctx, st.Pool, taskID, []string{"late-winner"}, nil, now, claimID)
	if err != nil || !completed {
		t.Fatalf("late queued completion=%v err=%v", completed, err)
	}
	secondClaim, err := store.TryClaimTaskCompletion(ctx, st.Pool, taskID, uuid.NewString(), now, time.Minute)
	if err != nil || secondClaim {
		t.Fatalf("second route claim=%v err=%v", secondClaim, err)
	}
}

func TestUpstreamAttemptRouteSnapshotSurvivesProviderRemoval(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("route-snapshot-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	var taskID uuid.UUID
	if err := st.Pool.QueryRow(ctx,
		`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents) VALUES ($1, 't2i', 'test', '{}'::jsonb, 'queued', 0) RETURNING id`,
		user.ID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{
		TaskID: taskID, ProviderID: "deleted-provider", RouteID: "old-route", RouteKey: "deleted-provider/old-route",
		Adapter: modelconfig.AdapterOpenAI, BaseURL: "https://old.example", APIKeyEncrypted: "enc:v1:test",
		TimeoutSecs: 123, MaxConcurrency: 7, UpstreamTaskIDs: []string{taskID.String()},
		SubmittedAt: now, FailoverAt: now.Add(time.Minute), ExpiresAt: now.Add(30 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	route, err := store.GetPendingUpstreamAttemptRoute(ctx, st.Pool, "deleted-provider/old-route")
	if err != nil || route == nil {
		t.Fatalf("snapshot route=%#v err=%v", route, err)
	}
	if route.BaseURL != "https://old.example" || route.APIKeyEncrypted != "enc:v1:test" || route.TimeoutSecs != 123 || route.MaxConcurrency != 7 {
		t.Fatalf("snapshot changed: %#v", route)
	}
}

func TestProviderForUpstreamAttemptPrefersImmutableSnapshot(t *testing.T) {
	const secret = "attempt-snapshot-test-secret"
	encrypted, err := settings.EncryptSecret("old-api-key", secret)
	if err != nil {
		t.Fatal(err)
	}
	w := &Worker{Cfg: &config.Config{AppSecret: secret}}
	task := &store.Task{Params: map[string]any{
		"_providerConfigId":        "provider-a",
		"_providerRouteId":         "route-a",
		"_serviceProvider":         modelconfig.AdapterOpenAI,
		"_upstreamBaseURL":         "https://old.example",
		"_upstreamAPIKeyEncrypted": encrypted,
		"_upstreamTimeoutSecs":     123,
		"_upstreamMaxConcurrency":  7,
	}}
	fallback := &modelconfig.Provider{BaseURL: "https://new.example", APIKey: "new-api-key", TimeoutSecs: 999}
	provider, err := w.providerForUpstreamAttempt(task, fallback)
	if err != nil {
		t.Fatal(err)
	}
	if provider.BaseURL != "https://old.example" || provider.APIKey != "old-api-key" || provider.TimeoutSecs != 123 || provider.MaxConcurrency != 7 {
		t.Fatalf("attempt did not use immutable snapshot: %#v", provider)
	}
}

func TestDisconnectedPollRouteCannotLeaveTaskRunning(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	if err := settings.Set(ctx, st.Pool, "task_failure_retry_count", json.RawMessage(`0`)); err != nil {
		t.Fatal(err)
	}
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("poll-404-%s@test.dev", uuid.NewString()[:8]), "worker", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	routeKey := "provider-a/route-a"
	owner := "poller:" + routeKey
	var taskID uuid.UUID
	if err := st.Pool.QueryRow(ctx,
		`INSERT INTO tasks (user_id, type, prompt, params, status, cost_cents, lease_owner, heartbeat_at, lease_until, started_at)
		 VALUES ($1, 't2i', 'test', jsonb_build_object('_providerConfigId','provider-a','_providerRouteId','route-a','_providerRouteKey',$2::text),
		 'running', 0, $3, now(), now() + interval '15 minutes', now()) RETURNING id`,
		user.ID, routeKey, owner).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := store.UpsertTaskUpstreamAttempt(ctx, st.Pool, store.UpstreamAttemptInput{
		TaskID: taskID, ProviderID: "provider-a", RouteID: "route-a", RouteKey: routeKey,
		Adapter: modelconfig.AdapterOpenAI, UpstreamTaskIDs: []string{taskID.String()},
		SubmittedAt: now, FailoverAt: now.Add(5 * time.Minute), ExpiresAt: now.Add(30 * time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "route disconnected", http.StatusNotFound)
	}))
	defer server.Close()
	claimed, err := store.ClaimPendingUpstreamTasksByRoute(ctx, st.Pool, routeKey, "attempt-poller:test", now, time.Minute, 10)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim attempts=%d err=%v", len(claimed), err)
	}
	w := &Worker{St: st, Cfg: &config.Config{AppEnv: "development"}}
	w.pollOpenAIProviderTasks(ctx, &modelconfig.Provider{
		ID: "provider-a", RouteID: "route-a", Adapter: modelconfig.AdapterOpenAI,
		BaseURL: server.URL, APIKey: "test", TimeoutSecs: 30,
	}, claimed)
	task, err := store.GetTask(ctx, st.Pool, taskID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "failed" || task.ErrorCode == nil || *task.ErrorCode != "upstream_unreachable" {
		t.Fatalf("disconnected task remained active: %#v", task)
	}
	var attemptStatus string
	if err := st.Pool.QueryRow(ctx, `SELECT status FROM task_upstream_attempts WHERE task_id=$1`, taskID).Scan(&attemptStatus); err != nil {
		t.Fatal(err)
	}
	if attemptStatus != store.UpstreamAttemptSuperseded {
		t.Fatalf("attempt status=%s", attemptStatus)
	}
}
