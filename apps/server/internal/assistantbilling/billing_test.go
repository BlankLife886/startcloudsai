package assistantbilling_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func billingUser(t *testing.T, st *store.Store, balance int64) *store.User {
	t.Helper()
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool,
		fmt.Sprintf("assistant-%s@test.dev", uuid.NewString()[:8]), "assistant-user", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, user.ID, balance, "grant", "test", uuid.NewString(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return user
}

func billingRun(t *testing.T, st *store.Store, userID uuid.UUID, reserved int64, params map[string]any) *store.AssistantRun {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), userID, "计费测试", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "test",
		Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant",
		Kind: "agent", Status: "queued", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	var run *store.AssistantRun
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		var insertErr error
		run, insertErr = store.InsertAssistantRun(ctx, tx, store.AssistantRun{
			ID: uuid.New(), UserID: userID, ConversationID: conversation.ID,
			UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
			Mode: "agent", Prompt: "test", Params: params, ReservedCents: reserved,
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

func walletState(t *testing.T, st *store.Store, userID uuid.UUID) *store.Wallet {
	t.Helper()
	item, err := store.GetWallet(context.Background(), st.Pool, userID)
	if err != nil || item == nil {
		t.Fatalf("wallet = %#v err=%v", item, err)
	}
	return item
}

func TestAgentCompletionSettlesActualChatCostAndReleasesRemainder(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 200)
	run := billingRun(t, st, user.ID, 80, map[string]any{
		"_chatCostCents": int64(20), "_imageCostCents": int64(80),
	})

	if state := walletState(t, st, user.ID); state.BalanceCents != 120 || state.FrozenCents != 80 {
		t.Fatalf("reserved wallet = %#v", state)
	}
	if claimed, err := store.ClaimAssistantRun(context.Background(), st.Pool, run.ID); err != nil || !claimed {
		t.Fatalf("claim = %v err=%v", claimed, err)
	}
	if changed, err := assistantbilling.Complete(context.Background(), st, run.ID, "chat"); err != nil || !changed {
		t.Fatalf("complete = %v err=%v", changed, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 180 || state.FrozenCents != 0 {
		t.Fatalf("settled wallet = %#v", state)
	}
	stored, err := store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil || stored == nil || stored.Status != "succeeded" || stored.CostCents != 20 {
		t.Fatalf("stored run = %#v err=%v", stored, err)
	}
	if changed, err := assistantbilling.Complete(context.Background(), st, run.ID, "chat"); err != nil || changed {
		t.Fatalf("idempotent complete = %v err=%v", changed, err)
	}
}

func TestAssistantCancelAndRetryReleaseEveryReservation(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 100)
	run := billingRun(t, st, user.ID, 20, map[string]any{
		"_chatCostCents": int64(20), "_imageCostCents": int64(20),
	})
	if claimed, err := store.ClaimAssistantRun(context.Background(), st.Pool, run.ID); err != nil || !claimed {
		t.Fatalf("claim = %v err=%v", claimed, err)
	}
	if changed, err := assistantbilling.Fail(context.Background(), st, run.ID, "upstream", "failed"); err != nil || !changed {
		t.Fatalf("fail = %v err=%v", changed, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 100 || state.FrozenCents != 0 {
		t.Fatalf("failed wallet = %#v", state)
	}

	if err := st.Tx(context.Background(), func(tx pgx.Tx) error {
		locked, err := store.GetAssistantRunForUpdate(context.Background(), tx, run.ID)
		if err != nil {
			return err
		}
		changed, err := assistantbilling.Requeue(context.Background(), tx, locked)
		if err == nil && !changed {
			t.Fatal("expected requeue change")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 80 || state.FrozenCents != 20 {
		t.Fatalf("retry wallet = %#v", state)
	}
	stored, err := store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil || stored == nil || stored.BillingGeneration != 1 {
		t.Fatalf("retry run = %#v err=%v", stored, err)
	}
	if _, canceled, err := assistantbilling.CancelUser(context.Background(), st, user.ID, run.ID); err != nil || !canceled {
		t.Fatalf("cancel = %v err=%v", canceled, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 100 || state.FrozenCents != 0 {
		t.Fatalf("canceled wallet = %#v", state)
	}
}
