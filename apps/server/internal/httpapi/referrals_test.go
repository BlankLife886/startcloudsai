package httpapi

import (
	"context"
	"encoding/json"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"sync"
	"testing"
)

func TestReferralVerifiedOrderAndIdempotency(t *testing.T) {
	st := testdb.Setup(t)
	enableReferralFeatureForTest(t, st)
	ctx := context.Background()
	inviter, _ := makeOrder(t, st)
	friend, order := makeOrder(t, st)
	code, err := referral.Code(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := referral.BindNewAccount(ctx, st.Pool, friend.ID, code); err != nil {
		t.Fatal(err)
	}
	// Rebinding and self referral cannot replace the original relationship.
	own, err := referral.Code(ctx, st.Pool, friend.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := referral.BindNewAccount(ctx, st.Pool, friend.ID, own); err != nil {
		t.Fatal(err)
	}
	order = prepareLanjingOrder(t, st, order, "referral-provider", 990, "alipay")
	s := &Server{St: st, Cfg: config.Load()}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	balance, err := store.GetWallet(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	if balance.BalanceCents != 0 {
		t.Fatalf("reward must wait for month-end: %d", balance.BalanceCents)
	}
	var count int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM referral_rewards WHERE order_id=$1`, order.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate reward %d %v", count, err)
	}
	raw, _ := json.Marshal(referral.Config{Enabled: true, Mode: "fixed", Percent: 10, FixedPoints: 10})
	if err := settings.Set(ctx, st.Pool, "referral_config", raw); err != nil {
		t.Fatal(err)
	}
	next, err := store.InsertOrder(ctx, st.Pool, friend.ID, order.PlanID, 990, 1000, 200, "lanjing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.completeVerifiedOrder(ctx, next); err != nil {
		t.Fatal(err)
	}
	balance, _ = store.GetWallet(ctx, st.Pool, inviter.ID)
	if balance.BalanceCents != 0 {
		t.Fatalf("fixed reward balance=%d", balance.BalanceCents)
	}
	unverified, err := store.InsertOrder(ctx, st.Pool, friend.ID, order.PlanID, 990, 1000, 200, "lanjing")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.completeOrder(ctx, unverified); err != nil {
		t.Fatal(err)
	}
	balance, _ = store.GetWallet(ctx, st.Pool, inviter.ID)
	if balance.BalanceCents != 0 {
		t.Fatal("unverified order rewarded")
	}
	settleAllReferralRewards(t, st)
	balance, _ = store.GetWallet(ctx, st.Pool, inviter.ID)
	if balance.BalanceCents != 110 {
		t.Fatalf("monthly reward=%d want110", balance.BalanceCents)
	}
	settleAllReferralRewards(t, st)
	balance, _ = store.GetWallet(ctx, st.Pool, inviter.ID)
	if balance.BalanceCents != 110 {
		t.Fatal("monthly settlement replay credited twice")
	}
}

func TestReferralRules(t *testing.T) {
	for _, cfg := range []referral.Config{{Mode: "invalid", Percent: 10, FixedPoints: 10}, {Mode: "percent", Percent: 101, FixedPoints: 10}, {Mode: "fixed", Percent: 10, FixedPoints: 0}} {
		if referral.Validate(cfg) == nil {
			t.Fatal("invalid config accepted")
		}
	}
	cfg := referral.Config{Mode: "percent", Percent: 10, FixedPoints: 10}
	if referral.RewardPoints(19, cfg) != 1 || referral.RewardPoints(9, cfg) != 0 {
		t.Fatal("percentage must floor")
	}
	cfg.Mode = "fixed"
	if referral.RewardPoints(0, cfg) != 0 || referral.RewardPoints(100, cfg) != 10 {
		t.Fatal("fixed reward mismatch")
	}
}
