package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestDashboardOrderStatsCountsReceiptsByConfirmationDay(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	loc := time.FixedZone("Asia/Shanghai", 8*3600)
	nowLocal := time.Now().In(loc)
	today := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, loc)
	last7, last30 := today.AddDate(0, 0, -6), today.AddDate(0, 0, -29)

	user, err := store.InsertUser(ctx, st.Pool, "orders-"+uuid.NewString()+"@test.dev", "buyer", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.InsertUser(ctx, st.Pool, "orders-"+uuid.NewString()+"@test.dev", "buyer2", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	topup, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: "t-" + uuid.NewString()[:6], Name: "充值", Kind: "topup", PriceCents: 990, GrantCents: 1000, Active: true})
	if err != nil {
		t.Fatal(err)
	}
	sub, err := store.InsertPlan(ctx, st.Pool, &store.Plan{Code: "s-" + uuid.NewString()[:6], Name: "订阅", Kind: "subscription", PriceCents: 2900, DurationDays: 30, DailyGrantCents: 100, Active: true})
	if err != nil {
		t.Fatal(err)
	}
	// created is relative to today's start; paidAfter is the gap to payment (nil = unpaid).
	add := func(userID uuid.UUID, plan *store.Plan, method, status string, created time.Duration, paidAfter *time.Duration, deleted bool) {
		t.Helper()
		order, err := store.InsertOrder(ctx, st.Pool, userID, plan.ID, plan.PriceCents, plan.GrantCents, 0, "lanjing")
		if err != nil {
			t.Fatal(err)
		}
		createdAt := today.Add(created)
		var paidAt *time.Time
		if paidAfter != nil {
			v := createdAt.Add(*paidAfter)
			paidAt = &v
		}
		var deletedAt *time.Time
		if deleted {
			deletedAt = &createdAt
		}
		if _, err := st.Pool.Exec(ctx, `UPDATE orders SET created_at=$2::timestamptz,status=$3::text,payment_method=$4,paid_at=$5::timestamptz,
 completed_at=CASE WHEN $3::text='completed' THEN $5::timestamptz END,provider_expires_at=$2::timestamptz+interval '5 minutes',admin_deleted_at=$6 WHERE id=$1`,
			order.ID, createdAt, status, method, paidAt, deletedAt); err != nil {
			t.Fatal(err)
		}
	}
	minutes := func(n int) *time.Duration { d := time.Duration(n) * time.Minute; return &d }

	add(user.ID, topup, "alipay", "completed", time.Hour, minutes(1), false)        // today, paid in 1 min
	add(other.ID, sub, "wechat", "completed", 2*time.Hour, minutes(30), false)      // today, late payment
	add(user.ID, topup, "alipay", "pending", 3*time.Hour, nil, false)               // awaiting payment
	add(user.ID, topup, "alipay", "expired", 4*time.Hour, nil, false)               // closed today
	add(user.ID, topup, "alipay", "expired", 5*time.Hour, nil, true)                // removed: ignored
	add(user.ID, topup, "wechat", "pending", 6*time.Hour, minutes(2), false)        // paid, delivery pending
	add(user.ID, topup, "alipay", "completed", -3*24*time.Hour, minutes(2), false)  // 3 days ago
	add(other.ID, sub, "alipay", "completed", -20*24*time.Hour, minutes(2), false)  // 20 days ago
	add(user.ID, topup, "alipay", "completed", -40*24*time.Hour, minutes(2), false) // outside 30 days
	add(other.ID, topup, "alipay", "completed", -2*time.Minute, minutes(5), false)  // created yesterday, paid today

	stats, err := store.GetDashboardOrderStats(ctx, st.Pool, today.UTC(), last7.UTC(), last30.UTC(), loc, 14)
	if err != nil {
		t.Fatal(err)
	}
	d := stats.Today
	if d.CreatedOrders != 5 || d.CreatedPaidOrders != 3 || d.PaidOrders != 4 || d.PayingUsers != 2 {
		t.Fatalf("today counts: %+v", d)
	}
	if d.ReceivedCents != 990*3+2900 || d.TopupCents != 990*3 || d.SubscriptionCents != 2900 ||
		d.AlipayCents != 990*2 || d.WechatCents != 990+2900 {
		t.Fatalf("today amounts: %+v", d)
	}
	if d.LatePaidOrders != 1 || d.MedianPaySeconds <= 0 || d.P95PaySeconds < d.MedianPaySeconds {
		t.Fatalf("today timing: %+v", d)
	}
	if stats.Last7Days.PaidOrders != 5 || stats.Last30Days.PaidOrders != 6 || stats.Last30Days.ReceivedCents != 990*4+2900*2 {
		t.Fatalf("periods: 7d=%+v 30d=%+v", stats.Last7Days, stats.Last30Days)
	}
	if stats.AwaitingPayment != 1 || stats.Confirming != 1 || stats.ClosedToday != 1 || stats.TotalPaid != 7 {
		t.Fatalf("current: %+v", stats)
	}
	if len(stats.Daily) != 14 || stats.Daily[13].Date != today.Format("2006-01-02") ||
		stats.Daily[13].PaidOrders != 4 || stats.Daily[13].CreatedOrders != 5 || stats.Daily[12].CreatedOrders != 1 || stats.Daily[12].PaidOrders != 0 {
		t.Fatalf("daily: %+v", stats.Daily[12:])
	}
}
