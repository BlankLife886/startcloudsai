package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAssistantAutoApproveSpendsOncePerFreshProposal(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "auto-"+uuid.NewString()+"@test.dev", "auto", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	user.AssistantAutoApprove, user.AssistantAutoApproveBudgetCents = true, 50
	var conversationID uuid.UUID
	if err := st.Pool.QueryRow(ctx, `INSERT INTO assistant_conversations (user_id) VALUES ($1) RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	newProposal := func(approvable bool) uuid.UUID {
		message, err := store.InsertAssistantMessage(ctx, st.Pool, store.AssistantMessage{
			ID: uuid.New(), ConversationID: conversationID, Role: "assistant", Kind: "proposal", Status: "complete",
			Content:   "方案已准备",
			Metadata:  map[string]any{"proposal": map[string]any{"action": "generate", "prompt": "一只橘猫", "autoApprovable": approvable}},
			CreatedAt: time.Now().UTC(),
		})
		if err != nil {
			t.Fatal(err)
		}
		return message.ID
	}
	submit := func(proposalID uuid.UUID, cost int64) error {
		tx, err := st.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if err := assistantAutoApproveRejection(ctx, tx, user, conversationID, "image", proposalID.String(), cost); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	expectRejected := func(err error, want string) {
		t.Helper()
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("err = %v, want %q", err, want)
		}
	}

	fresh := newProposal(true)
	if err := submit(fresh, 5); err != nil {
		t.Fatalf("first auto submission: %v", err)
	}
	// Deleting the turn that executed it makes the web app think it never ran.
	expectRejected(submit(fresh, 5), "已经自动生成过")

	// A rejected submission must not leave the mark behind.
	overBudget := newProposal(true)
	expectRejected(submit(overBudget, 80), "超出自动授权预算")
	if err := submit(overBudget, 5); err != nil {
		t.Fatalf("rollback left the proposal marked: %v", err)
	}

	stale := newProposal(true)
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_messages SET updated_at = now() - interval '11 minutes' WHERE id = $1`, stale); err != nil {
		t.Fatal(err)
	}
	expectRejected(submit(stale, 5), "已过自动执行时效")

	expectRejected(submit(newProposal(false), 5), "需要你确认")
}
