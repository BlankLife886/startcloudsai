package worker

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func TestAssistantProviderEndpointRemovesCredentialsAndQuery(t *testing.T) {
	got := assistantProviderEndpoint("https://user:secret@enabled.example.com/v1/?token=secret#fragment")
	if got != "https://enabled.example.com/v1" {
		t.Fatalf("assistantProviderEndpoint() = %q", got)
	}
}

func TestCRUNOpenAICompatibleBaseURL(t *testing.T) {
	for _, input := range []string{
		"https://api.crun.ai",
		"https://api.crun.ai/api/v1",
	} {
		if got := crunOpenAICompatibleBaseURL(input); got != "https://api.crun.ai/api/v1" {
			t.Fatalf("crunOpenAICompatibleBaseURL(%q) = %q", input, got)
		}
	}
}

func assistantRoutingTestWorker(t *testing.T, st *store.Store, routeLimits ...int) *Worker {
	t.Helper()
	const masterKey = "assistant-routing-test-key"
	encrypted, err := settings.EncryptSecret("route-secret", masterKey)
	if err != nil {
		t.Fatal(err)
	}
	routes := make([]modelconfig.ProviderRoute, len(routeLimits))
	for index, limit := range routeLimits {
		routes[index] = modelconfig.ProviderRoute{
			ID: fmt.Sprintf("route-%c", 'a'+rune(index)), Name: fmt.Sprintf("Route %d", index+1),
			BaseURL: fmt.Sprintf("https://route-%d.example.com", index+1), APIKey: encrypted,
			MaxConcurrency: limit, Enabled: true,
		}
	}
	cfg := modelconfig.Config{
		Version: modelconfig.Version,
		Providers: []modelconfig.Provider{{
			ID: "chat-provider", Name: "Chat Provider", Adapter: modelconfig.AdapterOpenAI,
			Routes: routes, Enabled: true,
		}},
		Models: []modelconfig.Model{
			{
				ID: "chat-model", Name: "Assistant Chat", ProviderID: "chat-provider",
				UpstreamModel: "gpt-test", Kind: modelconfig.ModelKindChat, PriceCents: 20,
				Public: true, Default: true, Enabled: true,
			},
			{
				ID: "image-model", Name: "Assistant Image", ProviderID: "chat-provider",
				UpstreamModel: "gpt-image-test", Kind: modelconfig.ModelKindImage, PriceCents: 5,
				MaxImages: 4, Public: true, Default: true, Enabled: true,
			},
		},
	}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	return &Worker{St: st, Cfg: &config.Config{AppSecret: masterKey}, workerID: "assistant-router-test"}
}

func assistantRoutingTestUser(t *testing.T, st *store.Store, balance int64) *store.User {
	t.Helper()
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool,
		fmt.Sprintf("assistant-router-%s@test.dev", uuid.NewString()[:8]), "router", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if balance > 0 {
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			_, grantErr := wallet.Grant(ctx, tx, user.ID, balance, "grant", "test", uuid.NewString(), nil)
			return grantErr
		}); err != nil {
			t.Fatal(err)
		}
	}
	return user
}

func insertAssistantRoutingTestRun(
	t *testing.T,
	st *store.Store,
	userID uuid.UUID,
	mode string,
	workspace string,
	reserved int64,
) *store.AssistantRun {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, st.Pool, uuid.New(), userID, "Routing test", workspace, now,
	)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "hello",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant",
		Kind: mode, Status: "queued", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	params := map[string]any{
		"workspace":                    workspace,
		"_chatProviderConfigId":        "chat-provider",
		"_chatModelConfigId":           "chat-model",
		"_chatCostCents":               int64(20),
		"_chatContextWindowTokens":     128_000,
		"_chatMaxOutputTokens":         8_192,
		"_failedChatProviderRouteKeys": []string{},
	}
	if mode == "image" {
		params = map[string]any{
			"workspace":                      workspace,
			"count":                          2,
			"_imageProviderConfigId":         "chat-provider",
			"_imageModelConfigId":            "image-model",
			"_imageCostCents":                int64(10),
			"_imageModelEffectivePriceCents": int64(5),
			"_failedImageProviderRouteKeys":  []string{},
		}
	}
	var run *store.AssistantRun
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		var insertErr error
		run, insertErr = store.InsertAssistantRun(ctx, tx, store.AssistantRun{
			ID: uuid.New(), UserID: userID, ConversationID: conversation.ID,
			UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
			Mode: mode, Prompt: "hello", Params: params, ReservedCents: reserved,
		})
		if insertErr != nil {
			return insertErr
		}
		return assistantbilling.Reserve(ctx, tx, run)
	}); err != nil {
		t.Fatal(err)
	}
	return run
}

func TestClaimAssistantRunBalancesRoutesAndDefersAtCapacity(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 1, 2)
	user := assistantRoutingTestUser(t, st, 0)

	runs := make([]*store.AssistantRun, 4)
	for index := range runs {
		runs[index] = insertAssistantRoutingTestRun(t, st, user.ID, "chat", modelconfig.WorkspaceAssistant, 0)
	}
	wantRoutes := []string{"chat-provider/route-a", "chat-provider/route-b", "chat-provider/route-b"}
	for index, want := range wantRoutes {
		claimed, err := w.claimAssistantRun(ctx, runs[index].ID, fmt.Sprintf("worker-%d", index))
		if err != nil || claimed == nil {
			t.Fatalf("claim %d = %#v err=%v", index, claimed, err)
		}
		if got := assistantParamString(claimed.Params, "_chatProviderRouteKey", ""); got != want {
			t.Fatalf("claim %d route = %q, want %q", index, got, want)
		}
	}

	claimed, err := w.claimAssistantRun(ctx, runs[3].ID, "worker-full")
	if err != nil || claimed != nil {
		t.Fatalf("full route claim = %#v err=%v", claimed, err)
	}
	stored, err := store.GetAssistantRun(ctx, st.Pool, runs[3].ID)
	if err != nil || stored == nil || stored.Status != "queued" {
		t.Fatalf("deferred run = %#v err=%v", stored, err)
	}
	ready, err := store.ListReadyAssistantRunOutboxIDs(ctx, st.Pool, time.Now().UTC().Add(10*time.Second), 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, id := range ready {
		found = found || id == runs[3].ID
	}
	if !found {
		t.Fatalf("deferred run %s missing from outbox: %#v", runs[3].ID, ready)
	}
}

func TestClaimAssistantImageRunUsesWeightedCapacityAndFailover(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 2, 2)
	user := assistantRoutingTestUser(t, st, 100)
	firstRun := insertAssistantRoutingTestRun(t, st, user.ID, "image", modelconfig.WorkspaceAssistant, 10)
	secondRun := insertAssistantRoutingTestRun(t, st, user.ID, "image", modelconfig.WorkspaceAssistant, 10)

	first, err := w.claimAssistantRun(ctx, firstRun.ID, "image-worker-a")
	if err != nil || first == nil || assistantParamString(first.Params, "_imageProviderRouteKey", "") != "chat-provider/route-a" {
		t.Fatalf("first image claim = %#v err=%v", first, err)
	}
	second, err := w.claimAssistantRun(ctx, secondRun.ID, "image-worker-b")
	if err != nil || second == nil || assistantParamString(second.Params, "_imageProviderRouteKey", "") != "chat-provider/route-b" {
		t.Fatalf("second image claim = %#v err=%v", second, err)
	}

	requeued, err := w.retryAssistantProviderRoute(ctx, first,
		&c2a.UpstreamError{Message: "temporary image failure", StatusCode: http.StatusBadGateway})
	if err != nil || !requeued {
		t.Fatalf("image failover = %v err=%v", requeued, err)
	}
	stored, err := store.GetAssistantRun(ctx, st.Pool, first.ID)
	if err != nil || stored == nil || len(assistantParamStrings(stored.Params, "_failedImageProviderRouteKeys")) != 1 {
		t.Fatalf("stored image failover = %#v err=%v", stored, err)
	}
}

func TestAssistantRouteFailoverExhaustionFailsAndReleasesReservation(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	w := assistantRoutingTestWorker(t, st, 10, 10)
	user := assistantRoutingTestUser(t, st, 100)
	run := insertAssistantRoutingTestRun(t, st, user.ID, "chat", modelconfig.WorkspaceAssistant, 20)

	first, err := w.claimAssistantRun(ctx, run.ID, "worker-a")
	if err != nil || first == nil || assistantParamString(first.Params, "_chatProviderRouteKey", "") != "chat-provider/route-a" {
		t.Fatalf("first claim = %#v err=%v", first, err)
	}
	requeued, err := w.retryAssistantProviderRoute(ctx, first,
		&sub2api.UpstreamError{Status: http.StatusServiceUnavailable, Message: "route a unavailable"})
	if err != nil || !requeued {
		t.Fatalf("first failover = %v err=%v", requeued, err)
	}
	second, err := w.claimAssistantRun(ctx, run.ID, "worker-b")
	if err != nil || second == nil || assistantParamString(second.Params, "_chatProviderRouteKey", "") != "chat-provider/route-b" {
		t.Fatalf("second claim = %#v err=%v", second, err)
	}
	requeued, err = w.retryAssistantProviderRoute(ctx, second,
		&sub2api.UpstreamError{Status: http.StatusTooManyRequests, Message: "route b busy"})
	if err != nil || !requeued {
		t.Fatalf("second failover = %v err=%v", requeued, err)
	}
	if claimed, err := w.claimAssistantRun(ctx, run.ID, "worker-exhausted"); !errors.Is(err, errAssistantRoutesExhausted) || claimed != nil {
		t.Fatalf("exhausted claim = %#v err=%v", claimed, err)
	}
	if err := w.failQueuedAssistantRun(ctx, run.ID, "all routes failed"); err != nil {
		t.Fatal(err)
	}
	stored, err := store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil || stored == nil || stored.Status != "failed" || stored.ErrorCode == nil || *stored.ErrorCode != "assistant_routes_exhausted" {
		t.Fatalf("failed run = %#v err=%v", stored, err)
	}
	state, err := store.GetWallet(ctx, st.Pool, user.ID)
	if err != nil || state == nil || state.BalanceCents != 100 || state.FrozenCents != 0 {
		t.Fatalf("released wallet = %#v err=%v", state, err)
	}
}

func TestAssistantRouteFailoverStopsAfterOutputAndForCanvas(t *testing.T) {
	w := &Worker{}
	retryable := &sub2api.UpstreamError{Status: http.StatusServiceUnavailable, Message: "upstream unavailable"}
	started := &store.AssistantRun{Mode: "chat", Params: map[string]any{"_chatProviderRouteKey": "provider/route-a"}}
	if requeued, err := w.retryAssistantProviderRoute(context.Background(), started,
		&assistantProviderError{err: retryable, outputStarted: true}); err != nil || requeued {
		t.Fatalf("output-started failover = %v err=%v", requeued, err)
	}
	canvas := &store.AssistantRun{Mode: "agent", Params: map[string]any{
		"workspace": modelconfig.WorkspaceCanvas, "_chatProviderRouteKey": "provider/route-a",
	}}
	if requeued, err := w.retryAssistantProviderRoute(context.Background(), canvas, retryable); err != nil || requeued {
		t.Fatalf("canvas failover = %v err=%v", requeued, err)
	}
}
