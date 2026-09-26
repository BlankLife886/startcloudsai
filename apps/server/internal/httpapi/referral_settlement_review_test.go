package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func makeReferralReviewAccruals(t *testing.T, count int) (*store.Store, *store.User, []*store.Order) {
	t.Helper()
	st := testdb.Setup(t)
	ctx := context.Background()
	inviter, _ := makeOrder(t, st)
	friend, seed := makeOrder(t, st)
	saveReferralControls(t, st, referral.Config{Enabled: true, Mode: "percent", Percent: 10, FixedPoints: 10})
	code, err := referral.Code(ctx, st.Pool, inviter.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := referral.BindNewAccountResult(ctx, st.Pool, friend.ID, code)
	if err != nil || result != "bound" {
		t.Fatalf("bind review fixture: status=%s err=%v", result, err)
	}
	s := &Server{St: st, Cfg: config.Load()}
	orders := make([]*store.Order, 0, count)
	for i := 0; i < count; i++ {
		order := seed
		if i > 0 {
			order, err = store.InsertOrder(ctx, st.Pool, friend.ID, seed.PlanID, 990, 1000, 200, "mock")
			if err != nil {
				t.Fatal(err)
			}
		}
		order = prepareLanjingOrder(t, st, order, uuid.NewString(), 990, "alipay")
		if _, err := s.completeVerifiedOrder(ctx, order); err != nil {
			t.Fatal(err)
		}
		orders = append(orders, order)
	}
	return st, inviter, orders
}

func assertReferralReviewWallet(t *testing.T, st *store.Store, userID uuid.UUID, wantBalance int64, wantGrants, wantReversals int) {
	t.Helper()
	ctx := context.Background()
	balance, err := store.GetWallet(ctx, st.Pool, userID)
	if err != nil || balance == nil {
		t.Fatalf("read review wallet: wallet=%+v err=%v", balance, err)
	}
	if balance.BalanceCents != wantBalance {
		t.Fatalf("wallet balance=%d want=%d", balance.BalanceCents, wantBalance)
	}
	var grants, reversals int
	if err := st.Pool.QueryRow(ctx, `SELECT
 count(*) FILTER(WHERE kind='grant' AND source_type='referral_settlement'),
 count(*) FILTER(WHERE kind='admin_adjust' AND source_type='admin' AND source_id LIKE 'referral-reversal/%')
 FROM wallet_ledger WHERE user_id=$1`, userID).Scan(&grants, &reversals); err != nil {
		t.Fatal(err)
	}
	if grants != wantGrants || reversals != wantReversals {
		t.Fatalf("ledger entries: grants=%d reversals=%d want=%d/%d", grants, reversals, wantGrants, wantReversals)
	}
}

func TestReferralMonthlyBatchReversalOnlyDebitsOneOrder(t *testing.T) {
	st, inviter, orders := makeReferralReviewAccruals(t, 2)
	ctx := context.Background()
	assertReferralReviewWallet(t, st, inviter.ID, 0, 0, 0)
	settleAllReferralRewards(t, st)
	assertReferralReviewWallet(t, st, inviter.ID, 200, 1, 0)

	var settlementID uuid.UUID
	var batchPoints, rewardCount int64
	if err := st.Pool.QueryRow(ctx, `SELECT s.id,s.points,s.reward_count FROM referral_settlements s
 JOIN referral_rewards r ON r.settlement_id=s.id WHERE r.order_id=$1`, orders[0].ID).
		Scan(&settlementID, &batchPoints, &rewardCount); err != nil {
		t.Fatal(err)
	}
	if batchPoints != 200 || rewardCount != 2 {
		t.Fatalf("monthly batch: points=%d rewards=%d want=200/2", batchPoints, rewardCount)
	}
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "referral-batch-review@example.com", "admin", "test-only-hash")
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		var status string
		err := st.Tx(ctx, func(tx pgx.Tx) error {
			var inner error
			status, inner = referral.ReverseWithExpected(ctx, tx, orders[0].ID, admin.ID, "核实仅追回本批次第一笔邀请奖励", "granted")
			return inner
		})
		if err != nil || status != "reversed" {
			t.Fatalf("single-order reversal attempt=%d status=%s err=%v", attempt, status, err)
		}
	}
	assertReferralReviewWallet(t, st, inviter.ID, 100, 1, 1)
	for i, order := range orders {
		var status string
		var owner uuid.UUID
		if err := st.Pool.QueryRow(ctx, `SELECT status,settlement_id FROM referral_rewards WHERE order_id=$1`, order.ID).Scan(&status, &owner); err != nil {
			t.Fatal(err)
		}
		wantStatus := "granted"
		if i == 0 {
			wantStatus = "reversed"
		}
		if status != wantStatus || owner != settlementID {
			t.Fatalf("order %d changed another allocation: status=%s settlement=%s", i, status, owner)
		}
	}
	var unchanged bool
	if err := st.Pool.QueryRow(ctx, `SELECT points=200 AND reward_count=2 FROM referral_settlements WHERE id=$1`, settlementID).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("reversal rewrote original monthly batch: unchanged=%v err=%v", unchanged, err)
	}
}

func TestReferralCancellationAfterSettlementReturnsConflictWithoutDebit(t *testing.T) {
	st, inviter, orders := makeReferralReviewAccruals(t, 1)
	ctx := context.Background()
	var viewedStatus string
	if err := st.Pool.QueryRow(ctx, `SELECT status FROM referral_rewards WHERE order_id=$1`, orders[0].ID).Scan(&viewedStatus); err != nil || viewedStatus != "pending_settlement" {
		t.Fatalf("reviewed cancellation state=%s err=%v", viewedStatus, err)
	}
	// Model the deterministic race: the administrator views a pending reward,
	// settlement commits, and only then does the old cancellation request arrive.
	settleAllReferralRewards(t, st)
	admin, err := store.UpsertAdminAccount(ctx, st.Pool, "referral-conflict-review@example.com", "admin", "test-only-hash")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Params = gin.Params{{Key: "id", Value: orders[0].ID.String()}}
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/referral-rewards/"+orders[0].ID.String()+"/reversal",
		strings.NewReader(`{"reason":"核实取消尚未到账的邀请奖励","confirmed":true,"expectedStatus":"pending_settlement"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	s := &Server{St: st, Cfg: config.Load()}
	s.adminReverseReferralReward(c, &store.User{ID: admin.ID})
	if response.Code != http.StatusConflict {
		t.Fatalf("stale cancellation status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Code != "referral_status_changed" {
		t.Fatalf("stale cancellation code=%s err=%v body=%s", body.Code, err, response.Body.String())
	}
	assertReferralReviewWallet(t, st, inviter.ID, 100, 1, 0)
	var status string
	var actionCount int
	if err := st.Pool.QueryRow(ctx, `SELECT status,(SELECT count(*) FROM referral_reward_actions WHERE order_id=$1)
 FROM referral_rewards WHERE order_id=$1`, orders[0].ID).Scan(&status, &actionCount); err != nil {
		t.Fatal(err)
	}
	if status != "granted" || actionCount != 0 {
		t.Fatalf("rejected cancellation changed reward: status=%s actions=%d", status, actionCount)
	}
}

func TestReferralClosedMonthWithNewPendingRewardCannotPayAgain(t *testing.T) {
	st, inviter, orders := makeReferralReviewAccruals(t, 1)
	ctx := context.Background()
	settleAllReferralRewards(t, st)
	assertReferralReviewWallet(t, st, inviter.ID, 100, 1, 0)

	next, err := store.InsertOrder(ctx, st.Pool, orders[0].UserID, orders[0].PlanID, 990, 1000, 200, "mock")
	if err != nil {
		t.Fatal(err)
	}
	next = prepareLanjingOrder(t, st, next, uuid.NewString(), 990, "alipay")
	s := &Server{St: st, Cfg: config.Load()}
	if _, err := s.completeVerifiedOrder(ctx, next); err != nil {
		t.Fatal(err)
	}
	// Corrupt only this isolated test fixture to represent a historic bad clock
	// or backfill: a newly accrued reward appears inside an already paid month.
	if _, err := st.Pool.Exec(ctx, `UPDATE referral_rewards r SET created_at=prior.created_at,
 settlement_retry_at=NULL,settlement_error='' FROM referral_rewards prior
 WHERE r.order_id=$1 AND prior.order_id=$2`, next.ID, orders[0].ID); err != nil {
		t.Fatal(err)
	}
	count, err := referral.SettleDue(ctx, st)
	if !errors.Is(err, referral.ErrSettledMonthPending) || count != 0 {
		t.Fatalf("closed month was silently paid or accepted: count=%d err=%v", count, err)
	}
	assertReferralReviewWallet(t, st, inviter.ID, 100, 1, 0)
	var status, settlementError string
	var settlementID *uuid.UUID
	var retryPaused bool
	if err := st.Pool.QueryRow(ctx, `SELECT status,settlement_id,settlement_error,
 COALESCE(settlement_retry_at='infinity'::timestamptz,false) FROM referral_rewards WHERE order_id=$1`, next.ID).
		Scan(&status, &settlementID, &settlementError, &retryPaused); err != nil {
		t.Fatal(err)
	}
	if status != "pending_settlement" || settlementID != nil || settlementError == "" || !retryPaused {
		t.Fatalf("closed-month anomaly was lost: status=%s batch=%v error=%q paused=%v", status, settlementID, settlementError, retryPaused)
	}
	var batchCount int
	var batchPoints, rewardCount int64
	if err := st.Pool.QueryRow(ctx, `SELECT count(*),COALESCE(sum(points),0),COALESCE(sum(reward_count),0)
 FROM referral_settlements WHERE inviter_id=$1`, inviter.ID).Scan(&batchCount, &batchPoints, &rewardCount); err != nil {
		t.Fatal(err)
	}
	if batchCount != 1 || batchPoints != 100 || rewardCount != 1 {
		t.Fatalf("original batch changed: batches=%d points=%d rewards=%d", batchCount, batchPoints, rewardCount)
	}
	if count, err := referral.SettleDue(ctx, st); err != nil || count != 0 {
		t.Fatalf("manual-review anomaly reentered automatic settlement: count=%d err=%v", count, err)
	}
	assertReferralReviewWallet(t, st, inviter.ID, 100, 1, 0)
}
