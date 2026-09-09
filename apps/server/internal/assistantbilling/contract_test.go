package assistantbilling_test

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"testing"
	"time"
)

func TestContractPartialSettlementPrioritizesSubscriptionOverTrial(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := billingUser(t, st, 100)
	grantAssistantTrialCredits(t, st, u.ID, "ai_assistant", 10)
	p, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: uuid.NewString(), Name: "sub", Kind: "subscription", PriceCents: 100, DailyGrantCents: 10, DurationDays: 3, SubscriptionPolicy: store.DefaultSubscriptionPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	o, err := store.InsertOrder(ctx, st.Pool, u.ID, p.ID, 100, 0, 0, "mock")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error { _, err := subscription.ApplyOrder(ctx, tx, o, p, time.Now()); return err }); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := wallet.FreezeFeatureCredits(ctx, tx, u.ID, 20, "ai_assistant", "assistant_run", id, nil); err != nil {
			return err
		}
		if _, err := wallet.SettleFeatureCredits(ctx, tx, u.ID, 7, "assistant_run", id, nil); err != nil {
			return err
		}
		_, err := wallet.ReleaseFeatureCredits(ctx, tx, u.ID, 13, "assistant_run", id, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	w := walletState(t, st, u.ID)
	if w.SubscriptionBalanceCents != 3 || w.TrialBalanceCents != 10 || w.BalanceCents != 100 || w.FrozenCents != 0 || w.TrialFrozenCents != 0 {
		t.Fatalf("wallet=%+v", w)
	}
}

func TestContractAssistantRetryRequotesInsteadOfTrustingParams(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	u := billingUser(t, st, 100)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "p", Name: "provider", Adapter: "openai", BaseURL: "https://example.invalid", APIKey: "test", Enabled: true}}
	cfg.Models = []modelconfig.Model{{ID: "m", Name: "model", ProviderID: "p", Kind: "chat", UpstreamModel: "chat", PriceCents: 5, Enabled: true, Public: true, Default: true}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	run := billingRun(t, st, u.ID, 3, map[string]any{"_modelConfigId": "m", "_chatCostCents": 3, "_billing": map[string]any{"source": "subscription_contract", "unitPoints": 3}})
	if claimed, err := store.ClaimAssistantRun(ctx, st.Pool, run.ID); err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	run, changed, err := assistantbilling.ForceFailAdmin(ctx, st, run.ID)
	if err != nil || !changed {
		t.Fatalf("fail=%v %v", changed, err)
	}
	run, err = store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error { _, err := assistantbilling.Requeue(ctx, tx, run); return err }); err == nil {
		t.Fatal("stale price accepted")
	}
	w := walletState(t, st, u.ID)
	if w.BalanceCents != 100 || w.FrozenCents != 0 {
		t.Fatalf("wallet=%+v", w)
	}
}
