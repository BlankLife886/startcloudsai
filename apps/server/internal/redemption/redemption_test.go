// 兑换码：码格式 / 条件更新兑换 / 幂等 / 各类失败错误码 / 防爆破限流参数。
package redemption_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/redemption"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func newUser(t *testing.T, st *store.Store) *store.User {
	t.Helper()
	ctx := context.Background()
	email := fmt.Sprintf("u-%s@test.dev", uuid.NewString()[:8])
	user, err := store.InsertUser(ctx, st.Pool, email, "tester", "x", "user", nil)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatalf("insert wallet: %v", err)
	}
	return user
}

func insertCode(t *testing.T, st *store.Store, grantCents int64, expiresAt *time.Time, createdBy uuid.UUID) *store.RedemptionCode {
	t.Helper()
	code, err := redemption.NewCode()
	if err != nil {
		t.Fatalf("new code: %v", err)
	}
	r, err := store.InsertRedemptionCode(context.Background(), st.Pool, code, grantCents, "batch1", nil, expiresAt, createdBy)
	if err != nil {
		t.Fatalf("insert code: %v", err)
	}
	return r
}

func mustCode(t *testing.T, err error, code string) {
	t.Helper()
	e, isApp := apperr.As(err)
	if !isApp {
		t.Fatalf("expected apperr %q, got %v", code, err)
	}
	if e.Code != code {
		t.Fatalf("expected code %q, got %q", code, e.Code)
	}
}

func TestNewCodeFormat(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		code, err := redemption.NewCode()
		if err != nil {
			t.Fatalf("new code: %v", err)
		}
		if len(code) != 17 || !strings.HasPrefix(code, "SC-") {
			t.Fatalf("bad format: %q", code)
		}
		for _, part := range strings.Split(code, "-")[1:] {
			for _, ch := range part {
				if strings.ContainsRune("0O1IL", ch) {
					t.Fatalf("code %q contains confusable char %c", code, ch)
				}
				if !strings.ContainsRune("ABCDEFGHJKMNPQRSTUVWXYZ23456789", ch) {
					t.Fatalf("code %q contains invalid char %c", code, ch)
				}
			}
		}
		if seen[code] {
			t.Fatalf("duplicate code %q in 100 draws", code)
		}
		seen[code] = true
	}
}

func TestRedeemSuccessAndReplay(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	admin := newUser(t, st)
	user := newUser(t, st)
	r := insertCode(t, st, 500, nil, admin.ID)

	redeemed, entry, err := redemption.Redeem(ctx, st, user.ID, r.Code)
	if err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if redeemed.GrantCents != 500 || entry.BalanceAfterCents != 500 {
		t.Fatalf("redeem = (%d, %d), want (500, 500)", redeemed.GrantCents, entry.BalanceAfterCents)
	}
	w, _ := store.GetWallet(ctx, st.Pool, user.ID)
	if w.BalanceCents != 500 {
		t.Fatalf("balance = %d, want 500", w.BalanceCents)
	}

	// 同一用户重复兑换：条件更新抢不到 → code_redeemed，不重复入账
	_, _, err = redemption.Redeem(ctx, st, user.ID, r.Code)
	mustCode(t, err, "code_redeemed")
	// 其他用户兑换已用码：同样 409
	other := newUser(t, st)
	_, _, err = redemption.Redeem(ctx, st, other.ID, r.Code)
	mustCode(t, err, "code_redeemed")

	var grants int
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM wallet_ledger WHERE kind = 'grant' AND source_type = 'redeem_code' AND source_id = $1`,
		r.ID.String()).Scan(&grants); err != nil {
		t.Fatalf("count grants: %v", err)
	}
	if grants != 1 {
		t.Fatalf("grants = %d, want 1", grants)
	}
	// 兑换归属正确落库
	fresh, _ := store.GetRedemptionCode(ctx, st.Pool, r.ID)
	if fresh.Status != "redeemed" || fresh.RedeemedBy == nil || *fresh.RedeemedBy != user.ID {
		t.Fatalf("code = (%s, %v), want (redeemed, %s)", fresh.Status, fresh.RedeemedBy, user.ID)
	}
}

func TestRedeemErrors(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	admin := newUser(t, st)
	user := newUser(t, st)

	// 不存在
	_, _, err := redemption.Redeem(ctx, st, user.ID, "SC-XXXX-XXXX-XXXX")
	mustCode(t, err, "code_invalid")

	// 已禁用
	disabled := insertCode(t, st, 100, nil, admin.ID)
	if won, derr := store.DisableRedemptionCode(ctx, st.Pool, disabled.ID); derr != nil || !won {
		t.Fatalf("disable: %v (won=%v)", derr, won)
	}
	_, _, err = redemption.Redeem(ctx, st, user.ID, disabled.Code)
	mustCode(t, err, "code_disabled")

	// 已过期（status 仍 active，兑换时判定）
	past := time.Now().UTC().Add(-time.Hour)
	expired := insertCode(t, st, 100, &past, admin.ID)
	_, _, err = redemption.Redeem(ctx, st, user.ID, expired.Code)
	mustCode(t, err, "code_expired")

	// 禁用条件更新：非 active 不可再禁用
	won, err := store.DisableRedemptionCode(ctx, st.Pool, disabled.ID)
	if err != nil {
		t.Fatalf("re-disable: %v", err)
	}
	if won {
		t.Fatal("re-disable should not win")
	}

	w, _ := store.GetWallet(ctx, st.Pool, user.ID)
	if w.BalanceCents != 0 {
		t.Fatalf("balance = %d, want 0 (no grants on failures)", w.BalanceCents)
	}
}

func TestRedeemLimiterLocksAfterTenFails(t *testing.T) {
	limiter := auth.NewRedeemLimiter()
	key := uuid.NewString()
	for i := 0; i < 9; i++ {
		limiter.Fail(key, "")
		if _, allowed := limiter.Check(key, ""); !allowed {
			t.Fatalf("locked too early after %d fails", i+1)
		}
	}
	limiter.Fail(key, "")
	remain, allowed := limiter.Check(key, "")
	if allowed {
		t.Fatal("expected locked after 10 fails")
	}
	if remain <= 55*time.Minute || remain > time.Hour {
		t.Fatalf("lock duration = %v, want ~1h", remain)
	}
	// 其他用户不受影响
	if _, allowed := limiter.Check(uuid.NewString(), ""); !allowed {
		t.Fatal("other user should not be locked")
	}
}
