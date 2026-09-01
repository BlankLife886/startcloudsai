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
	if err := store.MergeAssistantMessageMetadata(ctx, st.Pool, assistantMessage.ID, map[string]any{
		"pendingTool": map[string]any{"requestId": "tool-request", "name": "canvas_apply_ops"},
	}); err != nil {
		t.Fatal(err)
	}
	if claimed, err := store.ClaimAssistantMessagePendingTool(ctx, st.Pool, assistantMessage.ID, "tool-request", "browser-a"); err != nil || !claimed {
		t.Fatalf("first tool claim = %v err=%v", claimed, err)
	}
	if claimed, err := store.ClaimAssistantMessagePendingTool(ctx, st.Pool, assistantMessage.ID, "tool-request", "browser-b"); err != nil || claimed {
		t.Fatalf("competing tool claim = %v err=%v", claimed, err)
	}
	if claimed, err := store.ClaimAssistantMessagePendingTool(ctx, st.Pool, assistantMessage.ID, "tool-request", "browser-a"); err != nil || !claimed {
		t.Fatalf("idempotent tool claim = %v err=%v", claimed, err)
	}
	if cleared, err := store.ClearAssistantMessagePendingTool(ctx, st.Pool, assistantMessage.ID, "wrong-request"); err != nil || cleared {
		t.Fatalf("stale tool clear = %v err=%v", cleared, err)
	}
	if cleared, err := store.ClearAssistantMessagePendingTool(ctx, st.Pool, assistantMessage.ID, "tool-request"); err != nil || !cleared {
		t.Fatalf("matching tool clear = %v err=%v", cleared, err)
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
	if updated, err := store.SetQueuedAssistantRunExecutionRoute(ctx, st.Pool, run.ID, map[string]any{
		"_chatProviderConfigId": "provider", "_chatProviderRouteKey": "provider/route-a",
	}); err != nil || !updated {
		t.Fatalf("set route = %v err=%v", updated, err)
	}
	found, err := store.GetUserAssistantRunByIdempotencyKey(ctx, st.Pool, user.ID, key)
	if err != nil || found == nil || found.ID != run.ID || found.RequestFingerprint == nil || *found.RequestFingerprint != fingerprint {
		t.Fatalf("idempotent run = %#v err=%v", found, err)
	}
	ready, err := store.ListReadyAssistantRunOutboxIDs(ctx, st.Pool, now.Add(time.Second), 10)
	if err != nil || len(ready) != 1 || ready[0] != run.ID {
		t.Fatalf("ready outbox = %#v err=%v", ready, err)
	}

	claimed, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, run.ID, "worker-a", now, time.Minute, 4)
	if err != nil || claimed == nil || claimed.Attempt != 1 || claimed.LeaseOwner == nil || *claimed.LeaseOwner != "worker-a" {
		t.Fatalf("claimed run = %#v err=%v", claimed, err)
	}
	if err := store.BeginAssistantRunAttempt(ctx, st.Pool, claimed); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordAssistantRunExecutionRoute(ctx, st.Pool, claimed.ID, claimed.Attempt, map[string]any{
		"_imageProviderRouteKey": "provider/route-a",
		"_imageProviderEndpoint": "https://enabled.example.com/v1",
	}, "provider/route-a", "Enabled Provider", "image-model"); err != nil {
		t.Fatal(err)
	}
	recorded, err := store.GetAssistantRun(ctx, st.Pool, claimed.ID)
	if err != nil || recorded == nil || recorded.Params["_imageProviderEndpoint"] != "https://enabled.example.com/v1" {
		t.Fatalf("recorded execution route = %#v err=%v", recorded, err)
	}
	var attemptProvider, attemptModel string
	if err := st.Pool.QueryRow(ctx, `SELECT provider_name, model FROM assistant_run_attempts
		WHERE run_id = $1 AND attempt = $2`, claimed.ID, claimed.Attempt).Scan(&attemptProvider, &attemptModel); err != nil {
		t.Fatal(err)
	}
	if attemptProvider != "Enabled Provider" || attemptModel != "image-model" {
		t.Fatalf("attempt route provider=%q model=%q", attemptProvider, attemptModel)
	}
	running, err := store.RunningAssistantRunsByProvider(ctx, st.Pool, []string{"provider/route-a", "provider/route-b"})
	if err != nil || running["provider/route-a"] != 1 || running["provider/route-b"] != 0 {
		t.Fatalf("running routes = %#v err=%v", running, err)
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
	second, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, run.ID, "worker-b", now.Add(2*time.Minute), time.Minute, 4)
	if err != nil || second == nil || second.Attempt != 2 {
		t.Fatalf("second claim = %#v err=%v", second, err)
	}
	if err := store.BeginAssistantRunAttempt(ctx, st.Pool, second); err != nil {
		t.Fatal(err)
	}
	if changed, err := store.CompleteAssistantRunAttempt(ctx, st.Pool, run.ID, claimed.Attempt, "chat", 0); err != nil || changed {
		t.Fatalf("stale completion = %v err=%v", changed, err)
	}
	if changed, err := store.RequeueRunningAssistantRunForRouteFailover(
		ctx, st.Pool, run.ID, second.Attempt, []string{"provider/route-a"},
	); err != nil || !changed {
		t.Fatalf("route failover requeue = %v err=%v", changed, err)
	}
	if changed, err := store.FinishAssistantRunAttempt(ctx, st.Pool, run.ID, second.Attempt,
		"requeued", "chat", "provider_route_failed", "temporary upstream failure"); err != nil || !changed {
		t.Fatalf("finish attempt trace = %v err=%v", changed, err)
	}
	var firstStatus, secondStatus, routeKey string
	var firstFinished, secondFinished bool
	if err := st.Pool.QueryRow(ctx, `SELECT
		max(status) FILTER (WHERE attempt = 1),
		max(status) FILTER (WHERE attempt = 2),
		COALESCE(max(provider_route_key) FILTER (WHERE attempt = 1), ''),
		bool_and(finished_at IS NOT NULL) FROM assistant_run_attempts WHERE run_id = $1`, run.ID).
		Scan(&firstStatus, &secondStatus, &routeKey, &firstFinished); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT finished_at IS NOT NULL FROM assistant_run_attempts
		WHERE run_id = $1 AND attempt = 2`, run.ID).Scan(&secondFinished); err != nil {
		t.Fatal(err)
	}
	if firstStatus != "interrupted" || secondStatus != "requeued" || routeKey != "provider/route-a" || !firstFinished || !secondFinished {
		t.Fatalf("attempt traces first=%q second=%q route=%q finished=%v/%v",
			firstStatus, secondStatus, routeKey, firstFinished, secondFinished)
	}
	reloaded, err = store.GetAssistantRun(ctx, st.Pool, run.ID)
	if err != nil || reloaded == nil {
		t.Fatalf("load failover run = %#v err=%v", reloaded, err)
	}
	failedRoutes, _ := reloaded.Params["_failedChatProviderRouteKeys"].([]any)
	if reloaded.Status != "queued" || len(failedRoutes) != 1 || failedRoutes[0] != "provider/route-a" {
		t.Fatalf("failover run = %#v routes=%#v err=%v", reloaded, failedRoutes, err)
	}
	if changed, err := store.FailAssistantRun(ctx, st.Pool, run.ID, "test", "done"); err != nil || !changed {
		t.Fatalf("cleanup failure = %v err=%v", changed, err)
	}
	if err := store.DeleteAssistantRunOutbox(ctx, st.Pool, run.ID); err != nil {
		t.Fatal(err)
	}
}

func TestAssistantConversationQueueIsStrictlySerialAndEditable(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "assistant-queue-"+uuid.NewString()+"@test.dev", "queue-user", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "队列测试", now)
	if err != nil {
		t.Fatal(err)
	}
	insertRun := func(conversationID uuid.UUID, prompt string, offset time.Duration) *store.AssistantRun {
		t.Helper()
		userMessage, insertErr := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversationID, Role: "user", Content: prompt,
			Kind: "chat", Status: "queued", CreatedAt: now.Add(offset),
		})
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		assistantMessage, insertErr := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversationID, Role: "assistant", Kind: "chat",
			Status: "queued", CreatedAt: now.Add(offset + time.Millisecond),
		})
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		run, insertErr := store.InsertAssistantRun(ctx, st.Pool, store.AssistantRun{
			ID: uuid.New(), UserID: user.ID, ConversationID: conversationID,
			UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
			Mode: "chat", Prompt: prompt,
		})
		if insertErr != nil {
			t.Fatal(insertErr)
		}
		return run
	}

	first := insertRun(conversation.ID, "第一项", 0)
	second := insertRun(conversation.ID, "第二项", 10*time.Millisecond)
	third := insertRun(conversation.ID, "第三项", 20*time.Millisecond)
	if !(first.QueuePosition < second.QueuePosition && second.QueuePosition < third.QueuePosition) {
		t.Fatalf("initial positions = %d, %d, %d", first.QueuePosition, second.QueuePosition, third.QueuePosition)
	}
	if updated, err := store.UpdateQueuedAssistantRunPrompt(ctx, st.Pool, user.ID, third.ID, "第三项（已修改）", "第三项（已修改）"); err != nil || !updated {
		t.Fatalf("edit third = %v err=%v", updated, err)
	}
	thirdMessage, err := store.GetAssistantMessage(ctx, st.Pool, third.UserMessageID)
	if err != nil || thirdMessage == nil || thirdMessage.Content != "第三项（已修改）" {
		t.Fatalf("edited user message = %#v err=%v", thirdMessage, err)
	}
	if moved, err := store.MoveQueuedAssistantRun(ctx, st.Pool, user.ID, third.ID, -1); err != nil || !moved {
		t.Fatalf("move third up = %v err=%v", moved, err)
	}
	second, _ = store.GetAssistantRun(ctx, st.Pool, second.ID)
	third, _ = store.GetAssistantRun(ctx, st.Pool, third.ID)
	if third.QueuePosition >= second.QueuePosition {
		t.Fatalf("reordered positions third=%d second=%d", third.QueuePosition, second.QueuePosition)
	}

	for _, item := range []*store.AssistantRun{second, third} {
		if ready, err := store.AssistantRunDispatchable(ctx, st.Pool, item.ID, 4); err != nil || ready {
			t.Fatalf("non-head run %s dispatchable=%v err=%v", item.ID, ready, err)
		}
	}
	claimed, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, first.ID, "queue-worker", now, time.Minute, 4)
	if err != nil || claimed == nil {
		t.Fatalf("claim first = %#v err=%v", claimed, err)
	}
	if blocked, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, third.ID, "queue-worker", now, time.Minute, 4); err != nil || blocked != nil {
		t.Fatalf("claim while conversation running = %#v err=%v", blocked, err)
	}
	if changed, err := store.CompleteAssistantRun(ctx, st.Pool, first.ID, "chat", 0); err != nil || !changed {
		t.Fatalf("complete first = %v err=%v", changed, err)
	}
	if ready, err := store.AssistantRunDispatchable(ctx, st.Pool, third.ID, 4); err != nil || !ready {
		t.Fatalf("reordered head dispatchable=%v err=%v", ready, err)
	}
	if ready, err := store.AssistantRunDispatchable(ctx, st.Pool, second.ID, 4); err != nil || ready {
		t.Fatalf("last item dispatchable=%v err=%v", ready, err)
	}
	claimed, err = store.ClaimAssistantRunWithLease(ctx, st.Pool, third.ID, "queue-worker", now, time.Minute, 4)
	if err != nil || claimed == nil || claimed.Prompt != "第三项（已修改）" {
		t.Fatalf("claim edited third = %#v err=%v", claimed, err)
	}
	claimedUserMessage, err := store.GetAssistantMessage(ctx, st.Pool, third.UserMessageID)
	if err != nil || claimedUserMessage == nil || claimedUserMessage.Status != "complete" {
		t.Fatalf("claimed user message = %#v err=%v", claimedUserMessage, err)
	}
	queuedUserMessage, err := store.GetAssistantMessage(ctx, st.Pool, second.UserMessageID)
	if err != nil || queuedUserMessage == nil || queuedUserMessage.Status != "queued" {
		t.Fatalf("waiting user message = %#v err=%v", queuedUserMessage, err)
	}

	otherConversation, err := store.InsertAssistantConversation(ctx, st.Pool, uuid.New(), user.ID, "另一对话", now)
	if err != nil {
		t.Fatal(err)
	}
	other := insertRun(otherConversation.ID, "另一项", 30*time.Millisecond)
	if blocked, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, other.ID, "queue-worker", now, time.Minute, 1); err != nil || blocked != nil {
		t.Fatalf("user running limit = %#v err=%v", blocked, err)
	}
	if changed, err := store.CompleteAssistantRun(ctx, st.Pool, third.ID, "chat", 0); err != nil || !changed {
		t.Fatalf("complete third = %v err=%v", changed, err)
	}
	if claimed, err := store.ClaimAssistantRunWithLease(ctx, st.Pool, other.ID, "queue-worker", now, time.Minute, 1); err != nil || claimed == nil {
		t.Fatalf("claim after capacity frees = %#v err=%v", claimed, err)
	}
}
