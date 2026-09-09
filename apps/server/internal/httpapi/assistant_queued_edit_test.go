package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func TestAssistantQueuedHistoryEditPreservesActiveRunAndReservation(t *testing.T) {
	for _, status := range []string{"queued", "running", "succeeded"} {
		t.Run(status, func(t *testing.T) {
			env := newCommunityEnv(t)
			env.cfg.Sub2APIAPIKey = "test-key"
			env.cfg.Sub2APIBaseURL = "http://127.0.0.1:1"
			ctx := context.Background()
			user, token := env.newUserSession(t, "user")
			must := func(err error) {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
			}
			must(store.InsertWallet(ctx, env.st.Pool, user.ID))
			must(env.st.Tx(ctx, func(tx pgx.Tx) error {
				_, err := wallet.Grant(ctx, tx, user.ID, 100, "grant", "test", uuid.NewString(), nil)
				return err
			}))
			now := time.Now().UTC().Add(-time.Minute)
			conversation, err := store.InsertAssistantConversation(ctx, env.st.Pool, uuid.New(), user.ID, "History edit", now)
			must(err)
			userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
				ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "old prompt",
				Kind: "chat", Status: "complete", CreatedAt: now,
			})
			must(err)
			assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
				ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "chat",
				Status: "queued", CreatedAt: now.Add(time.Millisecond),
			})
			must(err)
			var original *store.AssistantRun
			must(env.st.Tx(ctx, func(tx pgx.Tx) error {
				var err error
				original, err = store.InsertAssistantRun(ctx, tx, store.AssistantRun{
					ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
					UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
					Mode: "chat", Prompt: "old prompt", Params: map[string]any{"_chatCostCents": int64(20)}, ReservedCents: 20,
				})
				if err != nil {
					return err
				}
				return assistantbilling.Reserve(ctx, tx, original)
			}))
			if status != "queued" {
				claimed, err := store.ClaimAssistantRunWithLease(ctx, env.st.Pool, original.ID, "test-worker", time.Now().UTC(), 10*time.Minute, 4)
				must(err)
				if claimed == nil {
					t.Fatal("fixture run was not claimed")
				}
				if status == "succeeded" {
					completed, err := assistantbilling.CompleteAttempt(ctx, env.st, original.ID, claimed.Attempt, "chat")
					must(err)
					if !completed {
						t.Fatal("fixture run was not settled")
					}
				}
			}
			response := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
				"conversationId": conversation.ID.String(), "sourceUserMessageId": userMessage.ID.String(),
				"prompt": "new prompt", "mode": "chat", "count": 1, "queue": true,
			}, token)
			if status == "succeeded" {
				if response.Code != http.StatusCreated {
					t.Fatalf("settled history edit: status=%d body=%s", response.Code, response.Body.String())
				}
				return
			}
			_, code := decode(t, response)
			if response.Code != http.StatusConflict || code != "assistant_conversation_busy" {
				t.Fatalf("active history edit: status=%d code=%s body=%s", response.Code, code, response.Body.String())
			}
			preserved, err := store.GetAssistantRun(ctx, env.st.Pool, original.ID)
			must(err)
			if preserved == nil || preserved.Status != status {
				t.Fatalf("active run was removed or changed: %#v", preserved)
			}
			message, err := store.GetAssistantMessage(ctx, env.st.Pool, userMessage.ID)
			must(err)
			if message == nil || message.Content != "old prompt" {
				t.Fatalf("rejected edit changed original prompt: %#v", message)
			}
			balance, err := store.GetWallet(ctx, env.st.Pool, user.ID)
			must(err)
			if balance.BalanceCents != 80 || balance.FrozenCents != 20 {
				t.Fatalf("rejected edit changed reservation: %#v", balance)
			}
			var ledgerCount, runCount int
			must(env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM wallet_ledger WHERE source_type='assistant_run' AND source_id=$1`, original.ID.String()).Scan(&ledgerCount))
			must(env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM assistant_runs WHERE conversation_id=$1`, conversation.ID).Scan(&runCount))
			if ledgerCount != 1 || runCount != 1 {
				t.Fatalf("rejected edit wrote new billing or run: ledger=%d runs=%d", ledgerCount, runCount)
			}
		})
	}
}
