package main

import (
	"context"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSandboxSubscriptionConsumption(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	l := &lab{st: st, users: map[string]account{}, plans: map[string]*store.Plan{}, clock: time.Now().UTC(), adminPassword: "Lab-test-password"}
	if err := l.seed(ctx); err != nil {
		t.Fatal(err)
	}
	p := l.plans["sub"]
	p.SubscriptionPolicy = store.DefaultSubscriptionPolicy()
	// Exercise a restricted API-only plan, not just the default web scope.
	p.SubscriptionPolicy.Channels = []string{"api"}
	p.SubscriptionPolicy.FeatureKeys = []string{"ui_design"}
	p.SubscriptionPolicy.ModelIDs = []string{"sandbox-model"}
	if err := store.UpdatePlan(ctx, st.Pool, p); err != nil {
		t.Fatal(err)
	}
	if err := l.seedSubscription(ctx, "demo", p, l.clock); err != nil {
		t.Fatal(err)
	}
	u := l.users["demo"]
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, u.ID, 500, "grant", "test", "usage-topup", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	sub, err := store.GetCurrentSubscription(ctx, st.Pool, u.ID, l.clock)
	if err != nil || sub == nil {
		t.Fatalf("subscription=%+v %v", sub, err)
	}
	check := func(spent, available int64) {
		t.Helper()
		c, err := subscription.RefundCalculation(ctx, st.Pool, sub, l.clock)
		if err != nil || c.SpentPoints != spent || c.AvailablePoints != available || c.TaskFrozenPoints != 0 {
			t.Fatalf("consumption=%+v %v", c, err)
		}
	}
	for _, points := range []int64{0, -1, 101} {
		if err := l.consumeSubscription(ctx, "demo", sub.ID, uuid.New(), points); err == nil {
			t.Fatalf("accepted invalid amount %d", points)
		}
	}
	if err := l.consumeSubscription(ctx, "subscriptions", sub.ID, uuid.New(), 1); err == nil {
		t.Fatal("consumed another account's subscription")
	}
	check(0, 100)
	op := uuid.New()
	for range 2 {
		if err := l.consumeSubscription(ctx, "demo", sub.ID, op, 1); err != nil {
			t.Fatal(err)
		}
		check(1, 99)
	}
	if _, err := subscription.RequestRefund(ctx, st, u.ID, sub.ID, "使用测试后申请自助退款", l.clock); err == nil {
		t.Fatal("simulated consumption did not block refund")
	}
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "usage-admin@payment.test", "admin", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := subscription.RequestManualRefund(ctx, st, admin.ID, *sub.OrderID, 100, "测试使用后人工协商退款", l.clock); err != nil {
		t.Fatal(err)
	}
	if err := l.consumeSubscription(ctx, "demo", sub.ID, uuid.New(), 1); err == nil {
		t.Fatal("consumed refund-held credits")
	}
	w, err := store.GetWallet(ctx, st.Pool, u.ID)
	if err != nil || w.BalanceCents != 500 || w.SubscriptionHeldCents != 99 {
		t.Fatalf("wallet=%+v %v", w, err)
	}
}
