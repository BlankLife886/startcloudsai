package httpapi

import (
	"context"
	"crypto/hmac"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
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
	ok(c, gin.H{"items": items})
}

type orderCreateIn struct {
	PlanID string `json:"planId"`
}

func (s *Server) createOrder(c *gin.Context) {
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

// completeOrder 完成订单：pending/paid → completed，入账 grant+bonus（幂等）。
// 已 completed 的订单视为幂等重放，直接返回成功，不重复入账
// （ledger 幂等键 ('grant','order',order_id) 双保险）。
func (s *Server) completeOrder(ctx context.Context, order *store.Order) (*store.Order, error) {
	if order.Status == "completed" {
		return order, nil
	}
	var result *store.Order
	run := func() error {
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
			total := order.GrantCents + order.BonusCents
			reason := fmt.Sprintf("订单入账（含赠送 %d 分）", order.BonusCents)
			if _, err := wallet.Grant(ctx, tx, order.UserID, total, "grant", "order", order.ID.String(), &reason); err != nil {
				return err
			}
			body := fmt.Sprintf("订单已完成，%d 分已入账到你的钱包。", total)
			if err := store.InsertNotification(ctx, tx, &order.UserID, "order", "充值到账", &body); err != nil {
				return err
			}
			fresh, err := store.GetOrder(ctx, tx, order.ID)
			if err != nil {
				return err
			}
			result = fresh
			return nil
		})
	}
	err := run()
	if err != nil && store.IsUniqueViolation(err, "uq_wallet_ledger_idem") {
		// 并发补单竞态：账本唯一键冲突 → 幂等重放（重试命中前置检查）
		err = run()
	}
	return result, err
}

type mockWebhookIn struct {
	OrderID string `json:"orderId"`
	Secret  string `json:"secret"`
}

func (s *Server) paymentWebhook(c *gin.Context) {
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
	if !hmac.Equal([]byte(body.Secret), []byte(s.Cfg.AppSecret)) {
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
