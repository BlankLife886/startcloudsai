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

func grantAssistantTrialCredits(t *testing.T, st *store.Store, userID uuid.UUID, featureKey string, amount int64) {
	t.Helper()
	ctx := context.Background()
	campaign, err := store.GetActiveTrialCampaign(ctx, st.Pool)
	if err != nil || campaign == nil {
		t.Fatalf("active trial campaign = %#v err=%v", campaign, err)
	}
	if _, err = store.UpdateTrialCampaign(ctx, st.Pool, campaign.ID, campaign.Title,
		[]string{featureKey}, "restricted", campaign.Capacity, campaign.DisplayOffset,
		campaign.ExpiresAt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	application, err := store.InsertTrialAccessApplication(ctx, st.Pool, userID, campaign.ID, 1,
		[]string{featureKey}, "测试用户", "用于验证助手体验积分的混合结算逻辑")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.GrantTrialFeatureEntitlement(ctx, st.Pool, userID, featureKey, application.ID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, grantErr := wallet.GrantTrial(ctx, tx, userID, amount, featureKey, "test_trial", uuid.NewString(), nil)
		return grantErr
	}); err != nil {
		t.Fatal(err)
	}
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

func TestAssistantCompletionUsesApprovedTrialCreditsAndReturnsMixedRemainder(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 50)
	grantAssistantTrialCredits(t, st, user.ID, "ai_assistant", 30)
	run := billingRun(t, st, user.ID, 60, map[string]any{
		"workspace": "assistant", "_chatCostCents": int64(20), "_imageCostCents": int64(60),
	})

	if state := walletState(t, st, user.ID); state.BalanceCents != 20 || state.TrialBalanceCents != 0 ||
		state.FrozenCents != 30 || state.TrialFrozenCents != 30 {
		t.Fatalf("mixed reserved wallet = %#v", state)
	}
	if claimed, err := store.ClaimAssistantRun(context.Background(), st.Pool, run.ID); err != nil || !claimed {
		t.Fatalf("claim = %v err=%v", claimed, err)
	}
	if changed, err := assistantbilling.Complete(context.Background(), st, run.ID, "chat"); err != nil || !changed {
		t.Fatalf("complete = %v err=%v", changed, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 50 || state.TrialBalanceCents != 10 ||
		state.FrozenCents != 0 || state.TrialFrozenCents != 0 {
		t.Fatalf("mixed settled wallet = %#v", state)
	}
	entries, err := store.ListLedger(context.Background(), st.Pool, user.ID, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	buckets := map[string]string{}
	for _, entry := range entries {
		if entry.SourceType == assistantbilling.SourceType {
			buckets[entry.Kind] = entry.CreditBucket
		}
	}
	if buckets["freeze"] != "mixed" || buckets["spend"] != "trial" || buckets["release"] != "mixed" {
		t.Fatalf("assistant ledger buckets = %#v", buckets)
	}
}

func TestAssistantPartialImageCompletionSettlesOnlyActualImages(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 100)
	run := billingRun(t, st, user.ID, 20, map[string]any{
		"count": int64(4), "_imageCostCents": int64(20), "_billingUnitPriceCents": int64(5),
	})
	if claimed, err := store.ClaimAssistantRun(context.Background(), st.Pool, run.ID); err != nil || !claimed {
		t.Fatalf("claim = %v err=%v", claimed, err)
	}
	if changed, err := assistantbilling.CompleteImageAttempt(context.Background(), st, run.ID, 0, 1); err != nil || !changed {
		t.Fatalf("complete partial images = %v err=%v", changed, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 95 || state.FrozenCents != 0 {
		t.Fatalf("partial image wallet = %#v", state)
	}
	stored, err := store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil || stored == nil || stored.CostCents != 5 {
		t.Fatalf("stored partial image run = %#v err=%v", stored, err)
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
	if state := walletState(t, st, user.ID); state.BalanceCents != 80 || state.FrozenCents != 0 {
		t.Fatalf("canceled wallet = %#v", state)
	}
	stored, err = store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil || stored == nil || stored.Status != "canceled" || stored.CostCents != 20 || pointerString(stored.ErrorCode) != "user_canceled" || pointerString(stored.ErrorMessage) != "用户主动停止任务" {
		t.Fatalf("canceled run = %#v err=%v", stored, err)
	}
	assertLedgerReason(t, st, user.ID, "AI 助手由用户主动停止，本轮积分不退还")
}

func TestCanvasAssistantReserveUsesCanvasLedgerReason(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 20)
	billingRun(t, st, user.ID, 1, map[string]any{
		"_source": "react_canvas", "workspace": "infinite_canvas", "_chatCostCents": int64(1),
	})
	entries, err := store.ListLedger(context.Background(), st.Pool, user.ID, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Kind == "freeze" && entry.Reason != nil && *entry.Reason == "无限画布费用预留" {
			return
		}
	}
	t.Fatalf("canvas reserve reason missing: %#v", ledgerReasons(entries))
}

func TestCanvasAgentCancelAfterBillableActionSettlesReservedFee(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 100)
	run := billingRun(t, st, user.ID, 15, map[string]any{
		"_source": "react_canvas", "workspace": "infinite_canvas", "_chatCostCents": int64(15),
	})
	if claimed, err := store.ClaimAssistantRun(context.Background(), st.Pool, run.ID); err != nil || !claimed {
		t.Fatalf("claim = %v err=%v", claimed, err)
	}
	if err := store.MergeAssistantMessageMetadata(context.Background(), st.Pool, run.AssistantMessageID,
		map[string]any{"agentBillableAction": true, "canvasOpsApplied": 1}); err != nil {
		t.Fatal(err)
	}
	if _, canceled, err := assistantbilling.CancelUser(context.Background(), st, user.ID, run.ID); err != nil || !canceled {
		t.Fatalf("cancel = %v err=%v", canceled, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 85 || state.FrozenCents != 0 {
		t.Fatalf("settled canceled wallet = %#v", state)
	}
	stored, err := store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil || stored == nil || stored.Status != "canceled" || stored.CostCents != 15 || pointerString(stored.ErrorCode) != "user_canceled" || pointerString(stored.ErrorMessage) != "用户主动停止任务" {
		t.Fatalf("stored run = %#v err=%v", stored, err)
	}
	assertLedgerReason(t, st, user.ID, "无限画布由用户主动停止，按已完成画布操作结算")
}

func TestCanvasAgentCancelBeforeBillableActionReleasesReservation(t *testing.T) {
	st := testdb.Setup(t)
	user := billingUser(t, st, 100)
	run := billingRun(t, st, user.ID, 15, map[string]any{
		"_source": "react_canvas", "workspace": "infinite_canvas", "_chatCostCents": int64(15),
	})
	if _, canceled, err := assistantbilling.CancelUser(context.Background(), st, user.ID, run.ID); err != nil || !canceled {
		t.Fatalf("cancel = %v err=%v", canceled, err)
	}
	if state := walletState(t, st, user.ID); state.BalanceCents != 100 || state.FrozenCents != 0 {
		t.Fatalf("released canceled wallet = %#v", state)
	}
	stored, err := store.GetAssistantRun(context.Background(), st.Pool, run.ID)
	if err != nil || stored == nil || stored.Status != "canceled" || stored.CostCents != 0 || pointerString(stored.ErrorCode) != "user_canceled" || pointerString(stored.ErrorMessage) != "用户主动停止任务" {
		t.Fatalf("stored run = %#v err=%v", stored, err)
	}
	assertLedgerReason(t, st, user.ID, "无限画布由用户主动停止，未执行画布操作，费用已退回")
}

func assertLedgerReason(t *testing.T, st *store.Store, userID uuid.UUID, want string) {
	t.Helper()
	entries, err := store.ListLedger(context.Background(), st.Pool, userID, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Reason != nil && *entry.Reason == want {
			return
		}
	}
	t.Fatalf("ledger reason %q missing: %#v", want, ledgerReasons(entries))
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func ledgerReasons(entries []*store.LedgerEntry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Reason != nil {
			out = append(out, entry.Kind+":"+*entry.Reason)
		}
	}
	return out
}
