package httpapi

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

// The manual grant stacks on top of the base setting and the plan bonus, and it
// must reach the same UserConcurrency projection the workers admit against.
func TestAdminManualConcurrencyBonusStacksOnBaseAndPlan(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, admin := env.newUserSession(t, "admin")
	u, _ := env.newUserSession(t, "user")
	path := "/api/v1/admin/users/" + u.ID.String()

	base, err := store.BaseUserConcurrency(ctx, env.st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	before, err := store.GetUserConcurrency(ctx, env.st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if before.ManualBonus != 0 || before.Limit != base+before.PlanBonus {
		t.Fatalf("fresh account already carried a manual grant: %+v", before)
	}

	if r := env.do(t, "PATCH", path, map[string]any{"concurrencyBonus": 7}, admin); r.Code != 200 {
		t.Fatalf("grant bonus: %d %s", r.Code, r.Body.String())
	}
	after, err := store.GetUserConcurrency(ctx, env.st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.ManualBonus != 7 || after.PlanBonus != before.PlanBonus {
		t.Fatalf("manual grant must not disturb the plan bonus: %+v", after)
	}
	if after.Bonus != before.PlanBonus+7 || after.Limit != base+before.PlanBonus+7 || after.ImageLimit != after.Limit {
		t.Fatalf("limit did not absorb the manual grant: %+v base=%d", after, base)
	}

	// A batch that only fits inside the widened limit must now be admitted.
	units := int64(base + before.PlanBonus + 7)
	if err := store.ValidateExecutionBatchCapacity(ctx, env.st.Pool, u.ID, true, units, 0); err != nil {
		t.Fatalf("widened account rejected a batch it can hold: %v", err)
	}
	if err := store.ValidateExecutionBatchCapacity(ctx, env.st.Pool, u.ID, true, units+1, 0); err == nil {
		t.Fatal("account accepted a batch above the widened limit")
	}

	// Zero is a real value, not "unset": it revokes the grant.
	if r := env.do(t, "PATCH", path, map[string]any{"concurrencyBonus": 0}, admin); r.Code != 200 {
		t.Fatalf("revoke bonus: %d %s", r.Code, r.Body.String())
	}
	revoked, err := store.GetUserConcurrency(ctx, env.st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if revoked.ManualBonus != 0 || revoked.Limit != base+before.PlanBonus {
		t.Fatalf("revoked grant still widened the limit: %+v", revoked)
	}
}

// Workers project concurrency from a task's user_id; a vanished row must read as
// "no grant" rather than failing the scan and stalling admission.
func TestUserConcurrencyProjectionToleratesMissingUser(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	account, err := store.GetUserConcurrency(ctx, env.st.Pool, uuid.New())
	if err != nil {
		t.Fatalf("unknown user broke the concurrency projection: %v", err)
	}
	if account.ManualBonus != 0 || account.Limit != account.Base {
		t.Fatalf("unknown user got a grant: %+v", account)
	}
}

func TestAdminManualConcurrencyBonusRejectsOutOfRangeAndPreservesStatus(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	_, admin := env.newUserSession(t, "admin")
	u, _ := env.newUserSession(t, "user")
	path := "/api/v1/admin/users/" + u.ID.String()

	if r := env.do(t, "PATCH", path, map[string]any{"concurrencyBonus": 3}, admin); r.Code != 200 {
		t.Fatalf("seed bonus: %d %s", r.Code, r.Body.String())
	}
	for _, bonus := range []any{-1, store.MaxUserConcurrencyBonus + 1, nil} {
		if r := env.do(t, "PATCH", path, map[string]any{"concurrencyBonus": bonus}, admin); r.Code != 422 {
			t.Fatalf("accepted bonus %v: %d %s", bonus, r.Code, r.Body.String())
		}
	}
	held, err := store.GetUserConcurrencyBonus(ctx, env.st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if held != 3 {
		t.Fatalf("rejected patch mutated the grant: %d", held)
	}

	// Omitting the field leaves the grant alone while other edits still apply.
	if r := env.do(t, "PATCH", path, map[string]any{"status": "banned"}, admin); r.Code != 200 {
		t.Fatalf("ban: %d %s", r.Code, r.Body.String())
	}
	held, err = store.GetUserConcurrencyBonus(ctx, env.st.Pool, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if held != 3 {
		t.Fatalf("unrelated patch cleared the grant: %d", held)
	}
	user, err := store.GetUserByID(ctx, env.st.Pool, u.ID)
	if err != nil || user == nil || user.Status != "banned" {
		t.Fatalf("status edit lost: %+v %v", user, err)
	}
}
