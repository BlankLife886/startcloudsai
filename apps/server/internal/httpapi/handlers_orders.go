package httpapi

import (
	"context"
	"crypto/hmac"
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func (s *Server) listPlans(c *gin.Context) {
	plans, err := store.ListPlans(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(plans))
	for _, p := range plans {
		items = append(items, planDict(p, false))
	}
	ok(c, gin.H{
		"items":          items,
		"paymentEnabled": false,
	})
}

type orderCreateIn struct {
	PlanID string `json:"planId"`
}

func (s *Server) createOrder(c *gin.Context) {
	if !s.Cfg.PaymentMockEnabled {
		fail(c, apperr.E("payment_unavailable", "支付渠道尚未配置", 503))
		return
	}
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body orderCreateIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	planID, err := uuid.Parse(body.PlanID)
	if err != nil {
		fail(c, apperr.E("validation_error", "planId: 无效的 UUID", 422))
		return
	}
	ctx := c.Request.Context()
	plan, err := store.GetActivePlan(ctx, s.St.Pool, planID)
	if err != nil {
		fail(c, err)
		return
	}
	if plan == nil {
		fail(c, apperr.E("plan_not_found", "套餐不存在或已下架", 404))
		return
	}
	order, err := store.InsertOrder(ctx, s.St.Pool, user.ID, plan.ID, plan.PriceCents, plan.GrantCents, plan.BonusCents, "mock")
	if err != nil {
		fail(c, err)
		return
	}
	// mock 渠道无真实收银台，payUrl 为空；由 mock webhook 或后台补单完成
	ok(c, orderDict(order, nil))
}

func (s *Server) listOrders(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListOrders(c.Request.Context(), s.St.Pool, &user.ID, "", nil, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(o *store.Order) gin.H { return orderDict(o, nil) }))
}

func (s *Server) getOrder(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	orderID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	order, err := store.GetUserOrder(c.Request.Context(), s.St.Pool, user.ID, orderID)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil {
		fail(c, apperr.E("order_not_found", "订单不存在", 404))
		return
	}
	ok(c, orderDict(order, nil))
}

// completeOrder 完成订单：pending/paid → completed，同一事务内按套餐类型分叉——
// kind=topup 幂等入账 grant+bonus；kind=subscription 创建/顺延订阅并发放首日额度
// （ledger 不记录订阅本金，额度发放时逐日记）。
// 已 completed 的订单视为幂等重放，直接返回成功，不重复入账
// （ledger 幂等键 ('grant','order',order_id) 双保险）。
// 通知在事务提交后尽力而为（M4 解耦）。
// 当前没有 HTTP 路由暴露支付或补单；此函数只用于历史数据兼容和迁移测试。
func (s *Server) completeOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
	if order.Status == "completed" {
		return order, nil
	}
	plan, err := store.GetPlan(ctx, s.St.Pool, order.PlanID)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, apperr.E("plan_not_found", "套餐不存在", 404)
	}
	var result *store.Order
	var sub *store.Subscription
	completedNow := false
	run := func() error {
		completedNow = false
		sub = nil
		return s.St.Tx(ctx, func(tx pgx.Tx) error {
			won, err := store.CompleteOrderUpdate(ctx, tx, order.ID, time.Now().UTC())
			if err != nil {
				return err
			}
			if !won {
				fresh, gerr := store.GetOrder(ctx, tx, order.ID)
				if gerr != nil {
					return gerr
				}
				if fresh != nil && fresh.Status == "completed" {
					result = fresh
					return nil
				}
				return apperr.E("order_not_payable", "订单当前状态不可完成", 400)
			}
			if plan.Kind == "subscription" {
				sub, err = subscription.ApplyOrder(ctx, tx, order, plan, time.Now().UTC())
				if err != nil {
					return err
				}
			} else {
				total := order.GrantCents + order.BonusCents
				reason := fmt.Sprintf("订单入账（含赠送 %d 分）", order.BonusCents)
				if _, err := wallet.Grant(ctx, tx, order.UserID, total, "grant", "order", order.ID.String(), &reason); err != nil {
					return err
				}
			}
			fresh, err := store.GetOrder(ctx, tx, order.ID)
			if err != nil {
				return err
			}
			result = fresh
			completedNow = true
			return nil
		})
	}
	err = run()
	if err != nil && store.IsUniqueViolation(err, "uq_wallet_ledger_idem") {
		// 并发补单竞态：账本唯一键冲突 → 幂等重放（重试命中前置检查）
		err = run()
	}
	if err == nil && completedNow {
		title, body := "充值到账", fmt.Sprintf("订单已完成，%d 分已入账到你的钱包。", order.GrantCents+order.BonusCents)
		if plan.Kind == "subscription" && sub != nil {
			title = "订阅开通成功"
			body = fmt.Sprintf("「%s」订阅已生效，每日发放 %d 分，有效期至 %s。",
				plan.Name, sub.DailyGrantCents, subscription.BeijingDate(sub.EndsAt))
		}
		if nerr := store.InsertNotification(ctx, s.St.Pool, &order.UserID, "order", title, &body); nerr != nil {
			log.Printf("notify order %s completed: %v", order.ID, nerr)
		}
	}
	return result, err
}

// mySubscription 保留用于历史数据兼容；当前未注册 HTTP 路由。
func (s *Server) mySubscription(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	now := time.Now().UTC()
	sub, err := store.GetCurrentSubscription(ctx, s.St.Pool, user.ID, now)
	if err != nil {
		fail(c, err)
		return
	}
	if sub == nil {
		ok(c, gin.H{"active": false, "planName": nil, "endsAt": nil, "dailyGrantCents": 0, "grantedToday": false})
		return
	}
	plan, err := store.GetPlan(ctx, s.St.Pool, sub.PlanID)
	if err != nil {
		fail(c, err)
		return
	}
	planName := ""
	if plan != nil {
		planName = plan.Name
	}
	ok(c, gin.H{
		"active":          true,
		"planName":        planName,
		"endsAt":          isoValue(sub.EndsAt),
		"dailyGrantCents": sub.DailyGrantCents,
		"grantedToday":    subscription.GrantedOn(sub, subscription.BeijingDate(now)),
	})
}

type mockWebhookIn struct {
	OrderID string `json:"orderId"`
	Secret  string `json:"secret"`
}

func (s *Server) paymentWebhook(c *gin.Context) {
	if !s.Cfg.PaymentMockEnabled {
		fail(c, apperr.E("payment_unavailable", "支付渠道尚未配置", 503))
		return
	}
	if c.Param("provider") != "mock" {
		fail(c, apperr.E("not_found", "不支持的支付渠道", 404))
		return
	}
	var body mockWebhookIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	orderID, err := uuid.Parse(body.OrderID)
	if err != nil {
		fail(c, apperr.E("validation_error", "orderId: 无效的 UUID", 422))
		return
	}
	if !hmac.Equal([]byte(body.Secret), []byte(s.Cfg.PaymentWebhookSecret)) {
		fail(c, apperr.E("auth_required", "webhook 校验失败", 401))
		return
	}
	ctx := c.Request.Context()
	order, err := store.GetOrder(ctx, s.St.Pool, orderID)
	if err != nil {
		fail(c, err)
		return
	}
	if order == nil {
		fail(c, apperr.E("order_not_found", "订单不存在", 404))
		return
	}
	order, err = s.completeOrder(ctx, order)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, orderDict(order, nil))
}
