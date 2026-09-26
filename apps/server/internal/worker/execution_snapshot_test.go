package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/executionconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestExecutionSnapshotFreezesActualRequestAndOnlyUpdatesLiveCapacity(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	w.Cfg.AppEnv = "development"
	user := assistantRoutingTestUser(t, st, 0)
	var originalCalls, changedCalls atomic.Int32
	original := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" {
			http.NotFound(rw, r)
			return
		}
		originalCalls.Add(1)
		var body struct {
			Model string `json:"model"`
			N     int    `json:"n"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "gpt-image-test" || body.N != 1 || r.Header.Get("Authorization") != "Bearer route-secret" {
			t.Errorf("original execution contract changed: model=%s n=%d authMatches=%v", body.Model, body.N, r.Header.Get("Authorization") == "Bearer route-secret")
		}
		rw.Header().Set("Content-Type", "application/json")
		fmt.Fprint(rw, `{"data":[{"b64_json":"aW1hZ2U="}]}`)
	}))
	defer original.Close()
	changed := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		changedCalls.Add(1)
		http.Error(rw, "old task must not use new endpoint", 500)
	}))
	defer changed.Close()
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers[0].Routes[0].BaseURL = original.URL
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	cfg, err = modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	task := executionTestImage(t, st, user.ID, 1, "text_to_image")
	assistant := executionTestAssistant(t, st, user.ID, 1, 0)
	if _, err := executionconfig.CaptureTask(ctx, st.Pool, task, cfg, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := executionconfig.CaptureAssistant(ctx, st.Pool, assistant, cfg, nil); err != nil {
		t.Fatal(err)
	}
	newKey, err := settings.EncryptSecret("changed-key", w.Cfg.AppSecret)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Providers[0].Routes[0].BaseURL = changed.URL
	cfg.Providers[0].Routes[0].APIKey = newKey
	cfg.Providers[0].Routes[0].TimeoutSecs = 77
	cfg.Providers[0].Routes[0].MaxConcurrency = 7
	cfg.Models[1].UpstreamModel = "new-image-model"
	cfg.Models[1].PriceCents = 99
	cfg.Models[1].MaxImages = 8
	cfg.Providers[0].Routes = append(cfg.Providers[0].Routes, modelconfig.ProviderRoute{ID: "new-route", Name: "New", BaseURL: changed.URL, APIKey: newKey, MaxConcurrency: 9, Enabled: true})
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	claimed, reason, err := w.claimTask(ctx, task.ID)
	if err != nil || claimed == nil || reason != "" {
		t.Fatalf("claim=%v %s %v", claimed, reason, err)
	}
	selection, configured, err := w.configuredModelSelection(ctx, claimed)
	if err != nil || !configured {
		t.Fatalf("selection=%v %v", configured, err)
	}
	if selection.Provider.BaseURL != original.URL || selection.Provider.MaxConcurrency != 7 || selection.Provider.APIKey != "route-secret" || selection.Model.PriceCents != 5 || selection.Model.MaxImages != 4 {
		t.Fatalf("snapshot drift: endpointMatches=%v capacity=%d price=%d maxImages=%d", selection.Provider.BaseURL == original.URL, selection.Provider.MaxConcurrency, selection.Model.PriceCents, selection.Model.MaxImages)
	}
	scenarioCheck(t, "改参前排队任务仍使用原单价", 5, selection.Model.PriceCents)
	scenarioCheck(t, "旧任务上游模型保持不变", "gpt-image-test", selection.Model.UpstreamModel)
	scenarioCheck(t, "旧任务仍绑定原密钥（不显示密钥）", true, selection.Provider.APIKey == "route-secret")
	scenarioCheck(t, "旧任务图片能力保持原值", 4, selection.Model.MaxImages)
	scenarioCheck(t, "线路并发使用实时新上限", 7, selection.Provider.MaxConcurrency)
	images, err := w.callUpstream(ctx, claimed, "", "", nil)
	if err != nil || len(images) != 1 || originalCalls.Load() != 1 || changedCalls.Load() != 0 {
		t.Fatalf("actual upstream drift: images=%d original=%d changed=%d err=%v", len(images), originalCalls.Load(), changedCalls.Load(), err)
	}
	scenarioCheck(t, "旧地址实际收到的生成请求", 1, originalCalls.Load())
	scenarioCheck(t, "新地址没有收到旧任务的请求", 0, changedCalls.Load())
	assistantClaim, err := w.claimAssistantRun(ctx, assistant.ID, "assistant-frozen")
	if err != nil || assistantClaim == nil {
		t.Fatalf("assistant claim=%v %v", assistantClaim, err)
	}
	assistantSelection, configured, err := w.configuredAssistantModelSelection(ctx, assistantClaim, modelconfig.ModelKindImage)
	if err != nil || !configured || assistantSelection.Model.UpstreamModel != "gpt-image-test" || assistantSelection.Provider.BaseURL != original.URL {
		t.Fatalf("assistant snapshot drift: configured=%v err=%v", configured, err)
	}
	scenarioCheck(t, "助手旧任务也保留原模型", "gpt-image-test", assistantSelection.Model.UpstreamModel)
	for _, old := range []*store.Task{claimed} {
		candidates, err := w.taskExecutionCandidates(ctx, old)
		if err != nil || len(candidates) != 1 || candidates[0].Provider.RouteID != "route-a" {
			t.Fatalf("old candidates expanded: len=%d err=%v", len(candidates), err)
		}
		scenarioCheck(t, "后来新增的线路没有混入旧任务候选", 1, len(candidates))
	}
	newTask := executionTestImage(t, st, user.ID, 1, "react_canvas")
	newSelection, configured, err := w.configuredModelSelection(ctx, newTask)
	if err != nil || !configured || newSelection.Provider.BaseURL != changed.URL || newSelection.Model.UpstreamModel != "new-image-model" {
		t.Fatalf("new task did not bind updated config: configured=%v err=%v", configured, err)
	}
	scenarioCheck(t, "新任务使用新上游模型", "new-image-model", newSelection.Model.UpstreamModel)
	scenarioCheck(t, "新任务使用新单价", 99, newSelection.Model.PriceCents)
	scenarioCheck(t, "新任务绑定新地址", true, newSelection.Provider.BaseURL == changed.URL)
}

func TestExecutionSnapshotBindingIsAtomicImmutableAndCleanedOnDelete(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 4)
	user := assistantRoutingTestUser(t, st, 0)
	task := executionTestImage(t, st, user.ID, 1, "text_to_image")
	cfg, err := modelconfig.Load(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan *executionconfig.Snapshot, 8)
	errs := make(chan error, 8)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			<-start
			snapshot, err := executionconfig.CaptureTask(ctx, st.Pool, task, cfg, nil)
			if err != nil {
				errs <- err
				return
			}
			results <- snapshot
		})
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	var version string
	for snapshot := range results {
		if version == "" {
			version = snapshot.ConfigVersion
		}
		if version == "" || version != snapshot.ConfigVersion {
			t.Fatal("concurrent bind returned different execution contracts")
		}
	}
	var rows int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_snapshots WHERE source_type='task' AND source_id=$1`, task.ID).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("bindings=%d %v", rows, err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE execution_snapshots SET config='{}' WHERE source_id=$1`, task.ID); err == nil {
		t.Fatal("immutable execution snapshot was overwritten")
	}
	var resolves int
	for range 2 {
		client, err := executionconfig.Client(ctx, st.Pool, executionconfig.Task, task.ID, "legacy", w.Cfg.AppSecret, func() (executionconfig.ClientConfig, error) {
			resolves++
			return executionconfig.ClientConfig{APIKey: "private-legacy-key", BaseURL: "https://original.invalid"}, nil
		})
		if err != nil || client.APIKey != "private-legacy-key" {
			t.Fatalf("legacy binding error=%v", err)
		}
	}
	if resolves != 1 {
		t.Fatalf("legacy resolved %d times", resolves)
	}
	raw, err := store.GetExecutionSnapshot(ctx, st.Pool, executionconfig.Task, task.ID, "client:legacy")
	if err != nil || strings.Contains(string(raw), "private-legacy-key") {
		t.Fatal("legacy credential stored in plaintext")
	}
	if _, err := st.Pool.Exec(ctx, `DELETE FROM tasks WHERE id=$1`, task.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_snapshots WHERE source_id=$1`, task.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("orphaned bindings=%d %v", rows, err)
	}
	if _, err := executionconfig.CaptureTask(ctx, st.Pool, task, cfg, nil); err == nil {
		t.Fatal("late worker recreated deleted source snapshot")
	}
	assistant := executionTestAssistant(t, st, user.ID, 1, 0)
	if _, err := executionconfig.CaptureAssistant(ctx, st.Pool, assistant, cfg, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `DELETE FROM assistant_runs WHERE id=$1`, assistant.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM execution_snapshots WHERE source_id=$1`, assistant.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("orphaned assistant bindings=%d %v", rows, err)
	}
}
