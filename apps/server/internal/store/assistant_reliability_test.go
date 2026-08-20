package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAssistantRunIdempotencyLeaseAndOutbox(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "assistant-reliability-"+uuid.NewString()+"@test.dev", "assistant-user", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "可靠性测试", now)
	if err != nil {
		t.Fatal(err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "问题", Kind: "chat", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "chat", Status: "queued", CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	key, fingerprint := "request-key", "fingerprint"
	run, err := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		IdempotencyKey: &key, RequestFingerprint: &fingerprint,
		Mode: "chat", Prompt: "问题",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertAssistantRunOutbox(ctx, st.Pool, run.ID); err != nil {
		t.Fatal(err)
	}
	found, err := store.GetUserAssistantRunByIdempotencyKey(ctx, st.Pool, user.ID, key)
	if err != nil || found == nil || found.ID != run.ID || found.RequestFingerprint == nil || *found.RequestFingerprint != fingerprint {
		t.Fatalf("idempotent run = %#v err=%v", found, err)
	}
	ready, err := store.ListReadyAssistantRunOutboxIDs(ctx, st.Pool, now.Add(time.Second), 10)
	if err != nil || len(ready) != 1 || ready[0] != run.ID {
		t.Fatalf("ready outbox = %#v err=%v", ready, err)
	}

	claimed, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, run.ID, "worker-a", now, time.Minute)
	if err != nil || claimed == nil || claimed.Attempt != 1 || claimed.LeaseOwner == nil || *claimed.LeaseOwner != "worker-a" {
		t.Fatalf("claimed run = %#v err=%v", claimed, err)
	}
	if renewed, err := store.RenewAssistantRunLease(ctx, st.Pool, run.ID, claimed.Attempt, "wrong-worker", now, time.Minute); err != nil || renewed {
		t.Fatalf("wrong-owner renewal = %v err=%v", renewed, err)
	}
	if renewed, err := store.RenewAssistantRunLease(ctx, st.Pool, run.ID, claimed.Attempt, "worker-a", now.Add(10*time.Second), time.Minute); err != nil || !renewed {
		t.Fatalf("lease renewal = %v err=%v", renewed, err)
	}

	requeued, err := store.RequeueExpiredAssistantRuns(ctx, st.Pool, now.Add(2*time.Minute))
	if err != nil || len(requeued) != 1 || requeued[0] != run.ID {
		t.Fatalf("requeued = %#v err=%v", requeued, err)
	}
	reloaded, err := store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil || reloaded == nil || reloaded.Status != "queued" || reloaded.LeaseOwner != nil {
		t.Fatalf("reloaded run = %#v err=%v", reloaded, err)
	}
	ready, err = store.ListReadyAssistantRunOutboxIDs(ctx, st.Pool, now.Add(2*time.Minute), 10)
	if err != nil || len(ready) != 1 || ready[0] != run.ID {
		t.Fatalf("requeued outbox = %#v err=%v", ready, err)
	}
	second, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, run.ID, "worker-b", now.Add(2*time.Minute), time.Minute)
	if err != nil || second == nil || second.Attempt != 2 {
		t.Fatalf("second claim = %#v err=%v", second, err)
	}
	if changed, err := store.CompleteAssistantRunAttempt(ctx, st.Pool, run.ID, claimed.Attempt, "chat", 0); err != nil || changed {
		t.Fatalf("stale completion = %v err=%v", changed, err)
	}
	if changed, err := store.FailAssistantRunAttempt(ctx, st.Pool, run.ID, second.Attempt, "test", "done"); err != nil || !changed {
		t.Fatalf("current failure = %v err=%v", changed, err)
	}
	if err := store.DeleteAssistantRunOutbox(ctx, st.Pool, run.ID); err != nil {
		t.Fatal(err)
	}
}
