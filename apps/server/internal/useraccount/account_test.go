package useraccount

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

type fixture struct {
	t   *testing.T
	st  *store.Store
	ctx context.Context
}

func setup(t *testing.T) fixture {
	return fixture{t: t, st: testdb.Setup(t), ctx: context.Background()}
}

func (f fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.st.Pool.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("exec %q: %v", strings.SplitN(strings.TrimSpace(sql), "\n", 2)[0], err)
	}
}

func (f fixture) user(name string) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO users (email, username, password_hash, role, status)
		VALUES ($1, $2, 'x', 'user', 'active') RETURNING id`, name+"@example.com", name).Scan(&id); err != nil {
		f.t.Fatalf("insert user: %v", err)
	}
	f.exec(`INSERT INTO wallets (user_id, balance_cents, frozen_cents) VALUES ($1, 0, 0) ON CONFLICT (user_id) DO NOTHING`, id)
	return id
}

func (f fixture) ledger(user uuid.UUID, kind string, delta int64, sourceType, sourceID string, settled *int64, at time.Time) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO wallet_ledger (user_id, kind, delta_cents, balance_after_cents, source_type, source_id, settled_points, created_at)
		VALUES ($1, $2, $3, 0, $4, NULLIF($5, ''), $6, $7) RETURNING id`, user, kind, delta, sourceType, sourceID, settled, at).Scan(&id); err != nil {
		f.t.Fatalf("insert ledger: %v", err)
	}
	return id
}

func (f fixture) task(user uuid.UUID, status string, count, images int, at time.Time) uuid.UUID {
	f.t.Helper()
	outputs := make([]string, images)
	for index := range outputs {
		outputs[index] = `"k` + uuid.NewString() + `.png"`
	}
	var id uuid.UUID
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO tasks (user_id, type, status, prompt, params, count, output_keys, cost_cents, model, created_at)
		VALUES ($1, 'ecommerce_design', $2, '白底主图', '{"_modelDisplayName":"高清模型"}'::jsonb, $3, $4::jsonb, 0, 'm', $5) RETURNING id`,
		user, status, count, "["+strings.Join(outputs, ",")+"]", at).Scan(&id); err != nil {
		f.t.Fatalf("insert task: %v", err)
	}
	return id
}

func points(value int64) *int64 { return &value }

var shanghai = time.FixedZone("CST", 8*3600)

func TestOverviewMatchesWalletAndSubscriptionPages(t *testing.T) {
	f := setup(t)
	user := f.user("member")
	now := time.Now()
	f.exec(`UPDATE wallets SET balance_cents = 500, frozen_cents = 40, trial_balance_cents = 20 WHERE user_id = $1`, user)

	plan, err := store.InsertPlan(f.ctx, f.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "月度会员", Kind: "subscription", PriceCents: 3000, DailyGrantCents: 100, DurationDays: 30})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertSubscription(f.ctx, f.st.Pool, &store.Subscription{UserID: user, PlanID: plan.ID,
		StartsAt: now.Add(-48 * time.Hour), EndsAt: now.Add(10*24*time.Hour + time.Hour), DailyGrantCents: 100}); err != nil {
		t.Fatal(err)
	}
	// Long gone: outside the 90-day window.
	if _, err := store.InsertSubscription(f.ctx, f.st.Pool, &store.Subscription{UserID: user, PlanID: plan.ID,
		StartsAt: now.Add(-200 * 24 * time.Hour), EndsAt: now.Add(-170 * 24 * time.Hour), DailyGrantCents: 100}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertOrder(f.ctx, f.st.Pool, user, plan.ID, 3000, 0, 0, "mock"); err != nil {
		t.Fatal(err)
	}

	overview, err := GetOverview(f.ctx, f.st.Pool, user, now, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := store.GetWallet(f.ctx, f.st.Pool, user)
	if err != nil {
		t.Fatal(err)
	}
	if overview.Balance.AvailablePoints != wallet.AvailablePoints() || overview.Balance.AvailablePoints != 520 || overview.Balance.FrozenPoints != 40 {
		t.Fatalf("balance = %+v", overview.Balance)
	}
	if len(overview.Subscriptions) != 1 {
		t.Fatalf("subscriptions = %+v", overview.Subscriptions)
	}
	sub := overview.Subscriptions[0]
	if sub.PlanName != "月度会员" || sub.Status != "active" || sub.StatusLabel != "生效中" || sub.DaysLeft != 11 || sub.DailyPoints != 100 {
		t.Fatalf("subscription = %+v", sub)
	}
	if overview.Orders.Pending != 1 || overview.Links["subscriptions"] != "/subscriptions" {
		t.Fatalf("orders = %+v links = %v", overview.Orders, overview.Links)
	}
}

func TestListOrdersDescribesStatesAndStaysWithinTheUser(t *testing.T) {
	f := setup(t)
	user := f.user("buyer")
	other := f.user("stranger")
	now := time.Now()
	plan, err := store.InsertPlan(f.ctx, f.st.Pool, &store.Plan{Code: uuid.NewString(), Name: "1000 积分", Kind: "topup", PriceCents: 1000, GrantCents: 1000, BonusCents: 100})
	if err != nil {
		t.Fatal(err)
	}
	done, err := store.InsertOrder(f.ctx, f.st.Pool, user, plan.ID, 1000, 1000, 100, "mock")
	if err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE orders SET status = 'completed', paid_at = now(), completed_at = now() WHERE id = $1`, done.ID)
	paid, err := store.InsertOrder(f.ctx, f.st.Pool, user, plan.ID, 1000, 1000, 100, "mock")
	if err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE orders SET paid_at = now() WHERE id = $1`, paid.ID)
	if _, err := store.InsertOrder(f.ctx, f.st.Pool, other, plan.ID, 1000, 1000, 100, "mock"); err != nil {
		t.Fatal(err)
	}

	result, err := ListOrders(f.ctx, f.st.Pool, user, OrdersRequest{}, now, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Orders) != 2 || result.Summary.Total != 2 {
		t.Fatalf("orders = %+v summary = %+v", result.Orders, result.Summary)
	}
	states := map[string]string{}
	for _, order := range result.Orders {
		states[order.OrderNo] = order.Status
		if order.PlanName != "1000 积分" || order.PlanKind != "积分充值" || order.AmountYuan != 10 || order.Points != 1000 || order.BonusPoints != 100 {
			t.Fatalf("order = %+v", order)
		}
	}
	if states[done.ID.String()] != "completed" || states[paid.ID.String()] != "confirming" {
		t.Fatalf("states = %v", states)
	}

	unsettled, err := ListOrders(f.ctx, f.st.Pool, user, OrdersRequest{Status: "unsettled"}, now, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if len(unsettled.Orders) != 1 || unsettled.Orders[0].OrderNo != paid.ID.String() {
		t.Fatalf("unsettled = %+v", unsettled.Orders)
	}
	if _, err := ListOrders(f.ctx, f.st.Pool, user, OrdersRequest{Status: "bogus"}, now, shanghai); err == nil {
		t.Fatal("bogus status accepted")
	}
}

func TestExplainChargeWalksTheTaskLedger(t *testing.T) {
	f := setup(t)
	user := f.user("payer")
	at := time.Date(2026, 3, 10, 9, 0, 0, 0, shanghai)

	// Four images requested, three delivered: 40 reserved, 30 charged, 10 back.
	partial := f.task(user, "succeeded", 4, 3, at)
	f.ledger(user, "freeze", -40, "task", partial.String(), nil, at)
	spend := f.ledger(user, "spend", 0, "task", partial.String(), points(30), at.Add(time.Minute))
	f.ledger(user, "release", 10, "task", partial.String()+"/1", nil, at.Add(time.Minute))

	for _, id := range []string{partial.String(), spend.String()} {
		explained, err := ExplainCharge(f.ctx, f.st.Pool, user, ChargeRequest{ID: id}, shanghai)
		if err != nil {
			t.Fatal(err)
		}
		if !explained.Found || explained.Source.Type != "task" || explained.Source.WorkspaceLabel != "AI 电商" || explained.Source.Model != "高清模型" {
			t.Fatalf("%s: source = %+v", id, explained.Source)
		}
		want := ChargeTotals{ReservedPoints: 40, ChargedPoints: 30, ReturnedPoints: 10, NetPoints: 30}
		if explained.Totals != want {
			t.Fatalf("%s: totals = %+v", id, explained.Totals)
		}
		summary := strings.Join(explained.Summary, "")
		for _, part := range []string{"预留了 40 积分", "扣费 30 积分", "10 积分已退回", "请求 4 张，实际产出 3 张", "合计实际花费 30 积分"} {
			if !strings.Contains(summary, part) {
				t.Fatalf("%s: summary %q missing %q", id, summary, part)
			}
		}
	}

	// A failed task: everything returned, plus failure compensation.
	failed := f.task(user, "failed", 1, 0, at.Add(time.Hour))
	f.ledger(user, "freeze", -10, "task", failed.String(), nil, at.Add(time.Hour))
	f.ledger(user, "release", 10, "task", failed.String(), nil, at.Add(time.Hour+time.Minute))
	f.ledger(user, "grant", 3, "task_failure_bonus", failed.String(), nil, at.Add(time.Hour+time.Minute))
	explained, err := ExplainCharge(f.ctx, f.st.Pool, user, ChargeRequest{}, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if explained.Totals != (ChargeTotals{ReservedPoints: 10, ReturnedPoints: 10, CompensationPoints: 3, NetPoints: -3}) {
		t.Fatalf("latest charge totals = %+v (source %+v)", explained.Totals, explained.Source)
	}
	if summary := strings.Join(explained.Summary, ""); !strings.Contains(summary, "全部退回，没有扣费") || !strings.Contains(summary, "3 积分失败补偿") {
		t.Fatalf("summary = %q", summary)
	}

	// Someone else's task is not found.
	stranger := f.user("snoop")
	other, err := ExplainCharge(f.ctx, f.st.Pool, stranger, ChargeRequest{ID: partial.String()}, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if other.Found || len(other.Entries) != 0 {
		t.Fatalf("stranger saw %+v", other)
	}
}

func TestExplainChargeCoversAPICallsAndPlainWalletEntries(t *testing.T) {
	f := setup(t)
	user := f.user("dev")
	at := time.Date(2026, 3, 10, 9, 0, 0, 0, shanghai)
	f.exec(`INSERT INTO developer_api_billing_requests (billing_id, source_type, user_id, price_cents, status, expires_at, created_at, api_model_name)
		VALUES ('bill-1', $1, $2, 25, 'succeeded', $3, $3, 'gpt-x')`, store.DeveloperAPIChatLedgerSource, user, at)
	f.ledger(user, "freeze", -25, store.DeveloperAPIChatLedgerSource, "bill-1", nil, at)
	f.ledger(user, "spend", 0, store.DeveloperAPIChatLedgerSource, "bill-1", points(25), at)

	api, err := ExplainCharge(f.ctx, f.st.Pool, user, ChargeRequest{ID: "bill-1"}, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if !api.Found || api.Source.TypeLabel != "API 调用（对话）" || api.Source.Model != "gpt-x" || api.Totals.NetPoints != 25 {
		t.Fatalf("api = %+v / %+v", api.Source, api.Totals)
	}

	checkin := f.ledger(user, "grant", 10, "daily_checkin", "2026-03-10", nil, at)
	plain, err := ExplainCharge(f.ctx, f.st.Pool, user, ChargeRequest{ID: checkin.String()}, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if !plain.Found || plain.Source.TypeLabel != "签到奖励" || len(plain.Entries) != 1 || plain.Entries[0].Points != 10 {
		t.Fatalf("plain = %+v", plain)
	}
}
