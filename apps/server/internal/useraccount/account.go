// Package useraccount answers questions about one user's own account: points
// balance, subscriptions, orders, and where a particular charge went. Every
// function takes the user from the caller's session and only reads, using the
// same store functions as the wallet, subscription and order pages so the
// assistant never disagrees with them.
package useraccount

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ErrInvalid marks a request the caller should fix.
var ErrInvalid = errors.New("invalid account request")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Location resolves an IANA name, falling back to Beijing time like the
// profile and wallet pages.
func Location(name string) *time.Location {
	name = strings.TrimSpace(name)
	if name != "" && name != "Local" && len(name) <= 64 {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	if loc, err := time.LoadLocation("Asia/Shanghai"); err == nil {
		return loc
	}
	return time.FixedZone("Asia/Shanghai", 8*3600)
}

func formatTime(t *time.Time, loc *time.Location) string {
	if t == nil || t.IsZero() {
		return ""
	}
	return t.In(loc).Format("2006-01-02 15:04")
}

func yuan(cents int64) float64 { return math.Round(float64(cents)) / 100 }

// Balance mirrors the wallet page's headline numbers.
type Balance struct {
	AvailablePoints    int64 `json:"availablePoints"`
	FrozenPoints       int64 `json:"frozenPoints"`
	NormalPoints       int64 `json:"normalPoints"`
	SubscriptionPoints int64 `json:"subscriptionPoints"`
	TrialPoints        int64 `json:"trialPoints"`
}

// Subscription is one subscription as the subscriptions page shows it.
type Subscription struct {
	PlanName      string `json:"planName"`
	Status        string `json:"status"`
	StatusLabel   string `json:"statusLabel"`
	StartsAt      string `json:"startsAt"`
	EndsAt        string `json:"endsAt"`
	DaysLeft      int    `json:"daysLeft,omitempty"`
	DailyPoints   int64  `json:"dailyPoints"`
	NextGrantAt   string `json:"nextGrantAt,omitempty"`
	GrantedCycles int    `json:"grantedCycles"`
	TotalCycles   int    `json:"totalCycles,omitempty"`
	// AvailablePoints is omitted for legacy subscriptions that never
	// tracked their own balance.
	AvailablePoints *int64 `json:"availablePoints,omitempty"`
	IssuedPoints    int64  `json:"issuedPoints"`
	SpentPoints     int64  `json:"spentPoints"`
	ExpiredPoints   int64  `json:"expiredPoints,omitempty"`
	Upgrading       bool   `json:"upgrading,omitempty"`
}

// Overview is the answer to "我的会员/积分现在什么情况".
type Overview struct {
	Timezone      string             `json:"timezone"`
	Balance       Balance            `json:"balance"`
	Subscriptions []Subscription     `json:"subscriptions"`
	Orders        store.OrderSummary `json:"orders"`
	Links         map[string]string  `json:"links"`
}

// subscriptionWindow keeps ended subscriptions in the overview for a while so
// "我的会员什么时候到期的" still has an answer after it lapses.
const (
	subscriptionWindow   = 90 * 24 * time.Hour
	maxOverviewSubscribe = 5
)

// GetOverview reads the balance, recent subscriptions and order counts.
// The wallet read settles expired subscription credits first, exactly as
// opening the wallet page does; it changes nothing else.
func GetOverview(ctx context.Context, q store.Q, userID uuid.UUID, now time.Time, loc *time.Location) (*Overview, error) {
	if userID == uuid.Nil {
		return nil, invalid("缺少用户")
	}
	out := &Overview{
		Timezone:      loc.String(),
		Subscriptions: []Subscription{},
		Links:         map[string]string{"wallet": "/wallet", "subscriptions": "/subscriptions", "orders": "/orders", "pricing": "/pricing"},
	}
	wallet, err := store.GetWallet(store.WithBillingTime(ctx, now), q, userID)
	if err != nil {
		return nil, err
	}
	if wallet != nil {
		out.Balance = Balance{
			AvailablePoints:    wallet.AvailablePoints(),
			FrozenPoints:       wallet.FrozenPoints(),
			NormalPoints:       wallet.BalanceCents,
			SubscriptionPoints: wallet.SubscriptionBalanceCents,
			TrialPoints:        wallet.TrialBalanceCents,
		}
	}
	subscriptions, err := store.ListUserSubscriptions(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	for _, sub := range subscriptions {
		if len(out.Subscriptions) >= maxOverviewSubscribe {
			break
		}
		if !sub.EndsAt.After(now.Add(-subscriptionWindow)) {
			continue
		}
		item, err := describeSubscription(ctx, q, sub, now, loc)
		if err != nil {
			return nil, err
		}
		out.Subscriptions = append(out.Subscriptions, item)
	}
	summary, err := store.GetUserOrderSummary(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	out.Orders = *summary
	return out, nil
}

func describeSubscription(ctx context.Context, q store.Q, sub *store.Subscription, now time.Time, loc *time.Location) (Subscription, error) {
	name := sub.PlanName
	if name == "" {
		plan, err := store.GetPlan(ctx, q, sub.PlanID)
		if err != nil {
			return Subscription{}, err
		}
		if plan != nil {
			name = plan.Name
		}
	}
	progress, err := store.GetSubscriptionProgress(ctx, q, sub, now)
	if err != nil {
		return Subscription{}, err
	}
	status := sub.Status
	if status == "active" && !sub.EndsAt.After(now) {
		status = "expired"
	}
	label := map[string]string{"active": "生效中", "expired": "已到期"}[status]
	if label == "" {
		label = "已结束"
	}
	item := Subscription{
		PlanName: name, Status: status, StatusLabel: label,
		StartsAt: formatTime(&sub.StartsAt, loc), EndsAt: formatTime(&sub.EndsAt, loc),
		DailyPoints: sub.DailyGrantCents, NextGrantAt: formatTime(progress.NextGrantAt, loc),
		GrantedCycles: progress.GrantedCycles, TotalCycles: progress.TotalCycles,
		IssuedPoints: progress.IssuedPoints, SpentPoints: progress.SpentPoints,
		ExpiredPoints: progress.ExpiredPoints, Upgrading: progress.Upgrading,
	}
	if status == "active" {
		item.DaysLeft = int(math.Ceil(sub.EndsAt.Sub(now).Hours() / 24))
	}
	if progress.AvailableKnown {
		available := progress.AvailablePoints
		item.AvailablePoints = &available
	}
	return item, nil
}

// OrdersRequest lists the user's orders.
type OrdersRequest struct {
	// Status is one of the order page filters: pending, completed, failed,
	// expired, cancelled, unsettled (awaiting payment or confirmation).
	Status string `json:"status,omitempty"`
	// Query matches an order number, provider order number, or plan name.
	Query string `json:"query,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// Order is one order as the orders page describes it.
type Order struct {
	OrderNo        string  `json:"orderNo"`
	ProviderNo     string  `json:"providerOrderNo,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	PlanName       string  `json:"planName"`
	PlanKind       string  `json:"planKind"`
	AmountYuan     float64 `json:"amountYuan"`
	PaidYuan       float64 `json:"paidYuan,omitempty"`
	Points         int64   `json:"points"`
	BonusPoints    int64   `json:"bonusPoints,omitempty"`
	Status         string  `json:"status"`
	StatusLabel    string  `json:"statusLabel"`
	PaidAt         string  `json:"paidAt,omitempty"`
	CompletedAt    string  `json:"completedAt,omitempty"`
	SubscriptionTo string  `json:"subscriptionEndsAt,omitempty"`
	Link           string  `json:"link"`
}

// OrdersResult is the answer to an OrdersRequest.
type OrdersResult struct {
	Timezone string             `json:"timezone"`
	Orders   []Order            `json:"orders"`
	HasMore  bool               `json:"hasMore"`
	Summary  store.OrderSummary `json:"summary"`
}

const maxOrders = 20

// orderState is the orders page's wording for where an order stands.
func orderState(order *store.Order, now time.Time) (string, string) {
	switch {
	case order.Status == "completed":
		return "completed", "已完成，积分或套餐已到账"
	case order.PaidAt != nil:
		return "confirming", "已支付，正在确认到账"
	case order.Status == "pending" && order.ProviderExpiresAt != nil && !order.ProviderExpiresAt.After(now):
		return "timed_out", "支付已超时，等待渠道确认关闭"
	case order.Status == "pending":
		return "awaiting_payment", "待支付"
	case order.Status == "expired":
		return "expired", "已过期，未支付"
	case order.Status == "failed":
		return "failed", "支付失败"
	case order.Status == "cancelled":
		return "cancelled", "已取消"
	}
	return order.Status, order.Status
}

// ListOrders returns the user's orders, newest first.
func ListOrders(ctx context.Context, q store.Q, userID uuid.UUID, req OrdersRequest, now time.Time, loc *time.Location) (*OrdersResult, error) {
	if userID == uuid.Nil {
		return nil, invalid("缺少用户")
	}
	status := strings.TrimSpace(req.Status)
	if status != "" && status != "unsettled" && !store.Contains(store.OrderStatuses, status) {
		return nil, invalid("不支持的订单状态：%s", status)
	}
	query := strings.TrimSpace(req.Query)
	if len([]rune(query)) > 100 {
		return nil, invalid("搜索内容不能超过 100 个字符")
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 10
	}
	limit = min(limit, maxOrders)
	rows, err := store.SearchUserOrders(ctx, q, userID, status, query, limit, nil)
	if err != nil {
		return nil, err
	}
	result := &OrdersResult{Timezone: loc.String(), Orders: []Order{}}
	if len(rows) > limit {
		rows, result.HasMore = rows[:limit], true
	}
	planIDs := []uuid.UUID{}
	for _, order := range rows {
		if order.PlanKind == nil {
			planIDs = append(planIDs, order.PlanID)
		}
	}
	plans, err := store.GetPlansByIDs(ctx, q, planIDs)
	if err != nil {
		return nil, err
	}
	for _, order := range rows {
		item := Order{
			OrderNo: order.ID.String(), CreatedAt: formatTime(&order.CreatedAt, loc),
			AmountYuan: yuan(order.AmountCents), Points: order.GrantCents, BonusPoints: order.BonusCents,
			PaidAt: formatTime(order.PaidAt, loc), CompletedAt: formatTime(order.CompletedAt, loc),
			SubscriptionTo: formatTime(order.SubscriptionEndsAt, loc), Link: "/orders",
		}
		if order.ProviderOrderID != nil {
			item.ProviderNo = *order.ProviderOrderID
		}
		if order.ProviderPayAmountCents != nil && order.PaidAt != nil {
			item.PaidYuan = yuan(*order.ProviderPayAmountCents)
		}
		if order.PlanName != nil {
			item.PlanName = *order.PlanName
		}
		if order.PlanKind != nil {
			item.PlanKind = *order.PlanKind
		} else if plan := plans[order.PlanID]; plan != nil {
			item.PlanName, item.PlanKind = plan.Name, plan.Kind
		}
		item.PlanKind = map[string]string{"subscription": "订阅套餐", "topup": "积分充值"}[item.PlanKind]
		item.Status, item.StatusLabel = orderState(order, now)
		result.Orders = append(result.Orders, item)
	}
	summary, err := store.GetUserOrderSummary(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	result.Summary = *summary
	return result, nil
}
