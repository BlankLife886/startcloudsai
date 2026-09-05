package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func openPlatformUser(t *testing.T, st *store.Store) *store.User {
	t.Helper()
	user, err := store.InsertUser(context.Background(), st.Pool,
		"open-"+uuid.NewString()+"@test.dev", "developer", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func TestUsageProfitLedgerIsIdempotent(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := openPlatformUser(t, st)
	now := time.Now().UTC().Truncate(time.Second)
	entry := store.UsageProfitEntry{
		SourceType: "task", SourceID: uuid.NewString(), UserID: user.ID, EventStatus: "succeeded",
		ModelID: "image-model", Units: 2, RevenueCents: 100, UpstreamCostCents: 60, CreatedAt: now,
	}
	if err := store.InsertUsageProfitEntry(ctx, st.Pool, entry); err != nil {
		t.Fatal(err)
	}
	duplicate := entry
	duplicate.RevenueCents = 999
	if err := store.InsertUsageProfitEntry(ctx, st.Pool, duplicate); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUsageProfitEntry(ctx, st.Pool, store.UsageProfitEntry{
		SourceType: "task", SourceID: uuid.NewString(), UserID: user.ID, EventStatus: "failed",
		ModelID: "image-model", Units: 1, UpstreamCostCents: 30, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	summary, err := store.GetProfitabilitySummary(ctx, st.Pool, now.Add(-time.Hour), now.Add(-time.Hour), now.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if got := summary.Today; got.RevenueCents != 100 || got.UpstreamCostCents != 90 ||
		got.GrossProfitCents != 10 || got.SucceededUnits != 2 || got.FailedUnits != 1 {
		t.Fatalf("summary = %#v", got)
	}
	models, err := store.ListProfitabilityBreakdown(ctx, st.Pool, "model", now.Add(-time.Hour), 20)
	if err != nil || len(models) != 1 || models[0].Key != "image-model" || models[0].Label != "image-model" {
		t.Fatalf("model breakdown = %#v err=%v", models, err)
	}
	users, err := store.ListProfitabilityBreakdown(ctx, st.Pool, "user", now.Add(-time.Hour), 20)
	if err != nil || len(users) != 1 || users[0].Label != user.Email {
		t.Fatalf("user breakdown = %#v err=%v", users, err)
	}
}

func TestAPIKeyTaskAndSpendLimits(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := openPlatformUser(t, st)
	key, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{
		UserID: user.ID, KeyPrefix: "sk-sc-test", KeyHash: "hash-" + uuid.NewString(), Label: "test",
		Scopes: []string{"tasks:write"}, AllowedModelIDs: []string{"allowed"}, DailyTaskLimit: 1,
		MonthlyTaskLimit: 2, DailySpendLimitCents: 20, MonthlySpendLimitCents: 40,
	})
	if err != nil {
		t.Fatal(err)
	}
	newTask := func(model string) *store.Task {
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: model, Prompt: "test", Count: 1, CostCents: 20,
		})
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	now := time.Now().UTC()
	first := newTask("allowed")
	if err := store.RecordAPIKeyTaskCreation(ctx, st.Pool, key.ID, user.ID, first.ID, "allowed", 20, now); err != nil {
		t.Fatal(err)
	}
	usage, err := store.GetAPIKeyUsageSummary(ctx, st.Pool, key.ID, now)
	if err != nil || usage.TodayTasks != 1 || usage.TodaySpendCents != 20 {
		t.Fatalf("usage = %#v err=%v", usage, err)
	}
	second := newTask("allowed")
	if err := store.RecordAPIKeyTaskCreation(ctx, st.Pool, key.ID, user.ID, second.ID, "allowed", 20, now); !errors.Is(err, store.ErrAPIKeyDailyLimit) {
		t.Fatalf("expected daily limit, got %v", err)
	}
	denied := newTask("denied")
	if err := store.RecordAPIKeyTaskCreation(ctx, st.Pool, key.ID, user.ID, denied.ID, "denied", 1, now); !errors.Is(err, store.ErrAPIKeyModelDenied) {
		t.Fatalf("expected model denial, got %v", err)
	}
}

func TestWebhookDeadDeliveryCanBeRetriedByOwner(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := openPlatformUser(t, st)
	endpoint, err := store.InsertAPIWebhookEndpoint(ctx, st.Pool, &store.APIWebhookEndpoint{
		UserID: user.ID, Label: "callback", URL: "https://example.com/hook", SecretEncrypted: "encrypted",
		Events: []string{"task.failed"}, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	apiKeyID := uuid.NewString()
	errorCode, errorMessage := "upstream_failed", "provider rejected request"
	task := &store.Task{ID: uuid.New(), UserID: user.ID, Type: "t2i", Count: 1,
		Params: map[string]any{"_apiKeyId": apiKeyID}, ErrorCode: &errorCode, ErrorMessage: &errorMessage}
	now := time.Now().UTC()
	if err := store.EnqueueTaskWebhookDeliveries(ctx, st.Pool, task, "failed", now); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimAPIWebhookDeliveries(ctx, st.Pool, "worker", time.Now().UTC().Add(time.Second), time.Minute, 10)
	if err != nil || len(claimed) != 1 || claimed[0].EndpointID != endpoint.ID {
		t.Fatalf("claimed = %#v err=%v", claimed, err)
	}
	if err := store.FailAPIWebhookDelivery(ctx, st.Pool, claimed[0].ID, "worker", "HTTP 400", 400, now, now, 1); err != nil {
		t.Fatal(err)
	}
	items, err := store.ListAPIWebhookDeliveries(ctx, st.Pool, user.ID, 10)
	if err != nil || len(items) != 1 || items[0].Status != "dead" {
		t.Fatalf("deliveries = %#v err=%v", items, err)
	}
	changed, err := store.RetryAPIWebhookDelivery(ctx, st.Pool, user.ID, items[0].ID, now.Add(time.Second))
	if err != nil || !changed {
		t.Fatalf("retry changed=%v err=%v", changed, err)
	}
	other := openPlatformUser(t, st)
	if changed, err := store.RetryAPIWebhookDelivery(ctx, st.Pool, other.ID, items[0].ID, now); err != nil || changed {
		t.Fatalf("other user retry changed=%v err=%v", changed, err)
	}
}
