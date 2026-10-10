package store

import (
	"context"
	"time"
)

// Dashboard order statistics. Receipts are dated by when the payment was
// confirmed (paid_at, or completed_at for orders settled before paid_at was
// recorded), so a late payment counts on the day it arrived. Orders an
// administrator removed (expired, never paid) are left out of every count.

// receiptAtSQL is when an order's payment was confirmed; NULL while unpaid.
const receiptAtSQL = `COALESCE(paid_at,CASE WHEN status='completed' THEN completed_at END)`

type DashboardOrderPeriod struct {
	CreatedOrders int64 `json:"createdOrders"`
	// Orders created in the period that have been paid so far.
	CreatedPaidOrders int64 `json:"createdPaidOrders"`
	PaidOrders        int64 `json:"paidOrders"`
	PayingUsers       int64 `json:"payingUsers"`
	ReceivedCents     int64 `json:"receivedCents"`
	TopupCents        int64 `json:"topupCents"`
	SubscriptionCents int64 `json:"subscriptionCents"`
	AlipayCents       int64 `json:"alipayCents"`
	WechatCents       int64 `json:"wechatCents"`
	// Paid after the QR code had expired, found by the callback or reconciler.
	LatePaidOrders int64 `json:"latePaidOrders"`
	// Seconds from order creation to confirmed payment.
	MedianPaySeconds float64 `json:"medianPaySeconds"`
	P95PaySeconds    float64 `json:"p95PaySeconds"`
	RefundedCents    int64   `json:"refundedCents"`
}

type DashboardOrderDay struct {
	Date          string `json:"date"`
	CreatedOrders int64  `json:"createdOrders"`
	PaidOrders    int64  `json:"paidOrders"`
	ReceivedCents int64  `json:"receivedCents"`
}

type DashboardOrderStats struct {
	Today      DashboardOrderPeriod `json:"today"`
	Last7Days  DashboardOrderPeriod `json:"last7Days"`
	Last30Days DashboardOrderPeriod `json:"last30Days"`
	// Current state.
	AwaitingPayment int64 `json:"awaitingPayment"`
	// Paid but not yet delivered.
	Confirming int64 `json:"confirming"`
	// Unpaid orders that closed today (expired, cancelled or failed).
	ClosedToday int64               `json:"closedToday"`
	Daily       []DashboardOrderDay `json:"daily"`
	TotalPaid   int64               `json:"totalPaidOrders"`
	TotalCents  int64               `json:"totalReceivedCents"`
}

// GetDashboardOrderStats summarizes orders for the admin dashboard. Period
// starts are business-day boundaries; dailyDays days of history end today in
// the given location.
func GetDashboardOrderStats(ctx context.Context, q Q, todayStart, last7Start, last30Start time.Time, loc *time.Location, dailyDays int) (DashboardOrderStats, error) {
	out := DashboardOrderStats{}
	periods := []struct {
		start time.Time
		dest  *DashboardOrderPeriod
	}{{todayStart, &out.Today}, {last7Start, &out.Last7Days}, {last30Start, &out.Last30Days}}
	for _, period := range periods {
		p := period.dest
		err := q.QueryRow(ctx, `WITH live AS (SELECT * FROM orders WHERE admin_deleted_at IS NULL),
 created AS (SELECT * FROM live WHERE created_at>=$1),
 paid AS (SELECT *,COALESCE(provider_pay_amount_cents,amount_cents) AS cents,`+receiptAtSQL+` AS receipt_at FROM live WHERE `+receiptAtSQL+`>=$1)
 SELECT (SELECT count(*) FROM created),
 (SELECT count(*) FROM created WHERE `+receiptAtSQL+` IS NOT NULL),
 count(*),count(DISTINCT user_id),COALESCE(sum(cents),0),
 COALESCE(sum(cents) FILTER(WHERE plan_kind_snapshot='topup' OR recharge_policy_snapshot IS NOT NULL),0),
 COALESCE(sum(cents) FILTER(WHERE plan_kind_snapshot='subscription' AND recharge_policy_snapshot IS NULL),0),
 COALESCE(sum(cents) FILTER(WHERE payment_method='alipay'),0),
 COALESCE(sum(cents) FILTER(WHERE payment_method='wechat'),0),
 count(*) FILTER(WHERE provider_expires_at IS NOT NULL AND receipt_at>provider_expires_at),
 COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM receipt_at-created_at)),0),
 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM receipt_at-created_at)),0),
 (SELECT COALESCE(sum(amount_cents),0) FROM subscription_changes WHERE kind='refund' AND status='completed' AND completed_at>=$1)
 FROM paid`, period.start).Scan(&p.CreatedOrders, &p.CreatedPaidOrders, &p.PaidOrders, &p.PayingUsers, &p.ReceivedCents,
			&p.TopupCents, &p.SubscriptionCents, &p.AlipayCents, &p.WechatCents, &p.LatePaidOrders,
			&p.MedianPaySeconds, &p.P95PaySeconds, &p.RefundedCents)
		if err != nil {
			return out, err
		}
	}
	if err := q.QueryRow(ctx, `SELECT
 count(*) FILTER(WHERE status='pending' AND paid_at IS NULL),
 count(*) FILTER(WHERE paid_at IS NOT NULL AND status<>'completed'),
 count(*) FILTER(WHERE status IN ('expired','cancelled','failed') AND `+receiptAtSQL+` IS NULL AND created_at>=$1),
 count(*) FILTER(WHERE `+receiptAtSQL+` IS NOT NULL),
 COALESCE(sum(COALESCE(provider_pay_amount_cents,amount_cents)) FILTER(WHERE `+receiptAtSQL+` IS NOT NULL),0)
 FROM orders WHERE admin_deleted_at IS NULL`, todayStart).Scan(&out.AwaitingPayment, &out.Confirming, &out.ClosedToday, &out.TotalPaid, &out.TotalCents); err != nil {
		return out, err
	}

	dailyDays = max(1, dailyDays)
	todayLocal := todayStart.In(loc)
	firstDay := todayLocal.AddDate(0, 0, -(dailyDays - 1))
	byDay := map[string]*DashboardOrderDay{}
	rows, err := q.Query(ctx, `SELECT day,sum(created),sum(paid),sum(cents) FROM (
 SELECT (created_at AT TIME ZONE $2)::date::text AS day,1 AS created,0 AS paid,0::bigint AS cents FROM orders
  WHERE admin_deleted_at IS NULL AND created_at>=$1
 UNION ALL
 SELECT (`+receiptAtSQL+` AT TIME ZONE $2)::date::text,0,1,COALESCE(provider_pay_amount_cents,amount_cents) FROM orders
  WHERE admin_deleted_at IS NULL AND `+receiptAtSQL+`>=$1
 ) t GROUP BY day`, firstDay.UTC(), loc.String())
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var day DashboardOrderDay
		if err := rows.Scan(&day.Date, &day.CreatedOrders, &day.PaidOrders, &day.ReceivedCents); err != nil {
			return out, err
		}
		byDay[day.Date] = &day
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	out.Daily = make([]DashboardOrderDay, 0, dailyDays)
	for i := 0; i < dailyDays; i++ {
		date := firstDay.AddDate(0, 0, i).Format("2006-01-02")
		if day := byDay[date]; day != nil {
			out.Daily = append(out.Daily, *day)
		} else {
			out.Daily = append(out.Daily, DashboardOrderDay{Date: date})
		}
	}
	return out, nil
}
