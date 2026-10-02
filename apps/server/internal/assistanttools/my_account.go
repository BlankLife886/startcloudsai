package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/useraccount"
)

const (
	ToolMyAccountOverview = "my_account_overview"
	ToolMyOrdersList      = "my_orders_list"
	ToolExplainCharge     = "explain_charge"

	PermissionAccountRead Permission = "account.read"
)

// NewMyAccountManifest exposes the user's own balance, subscriptions, orders
// and charge explanations. Like my_data, the user always comes from
// Invocation.UserID. None of these tools can buy, refund or change anything.
func NewMyAccountManifest(q store.Q, now func() time.Time) Manifest {
	if now == nil {
		now = time.Now
	}
	return Manifest{
		ID:          "my_account",
		Version:     "1",
		Description: "查询用户本人的积分余额、订阅、订单，并解释单笔扣费",
		Tools: []Definition{
			{
				Name: ToolMyAccountOverview,
				Description: "查看用户本人当前的积分余额（可用、冻结，以及普通/订阅/体验积分）、最近 90 天内的订阅（套餐名、状态、开始和到期时间、剩余天数、每日发放、下次发放时间、订阅积分余额和已用）以及订单数量概况。" +
					"用户问“我还有多少积分”“会员什么时候到期”“今天的订阅积分发了吗”时使用。数字与钱包页、订阅页一致。",
				InputSchema: map[string]any{
					"type": "object", "properties": map[string]any{}, "additionalProperties": false,
				},
				Permissions:    []Permission{PermissionAccountRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 24 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					overview, err := useraccount.GetOverview(ctx, q, invocation.UserID, now(), useraccount.Location(invocation.Timezone))
					if err != nil {
						return accountToolError(err)
					}
					return jsonResultWithMeta(overview, "account")
				},
			},
			{
				Name: ToolMyOrdersList,
				Description: "列出用户本人的订单（充值和订阅购买），最新在前，最多 20 条：订单号、套餐、金额（元）、到账积分、状态（待支付、确认中、已完成、已过期等）、支付和完成时间。" +
					"status 可选 pending / completed / failed / expired / cancelled / unsettled（待支付或已支付待确认）；query 可填用户给出的订单号或套餐名。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"status": map[string]any{"type": "string", "enum": []any{"pending", "completed", "failed", "expired", "cancelled", "unsettled"}},
						"query":  map[string]any{"type": "string", "maxLength": 100},
						"limit":  map[string]any{"type": "integer", "minimum": 1, "maximum": 20},
					},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionAccountRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 32 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var request useraccount.OrdersRequest
					if err := json.Unmarshal(invocation.Arguments, &request); err != nil {
						return Result{}, errors.New("订单查询参数格式不正确")
					}
					orders, err := useraccount.ListOrders(ctx, q, invocation.UserID, request, now(), useraccount.Location(invocation.Timezone))
					if err != nil {
						return accountToolError(err)
					}
					return jsonResultWithMeta(orders, "orders")
				},
			},
			{
				Name: ToolExplainCharge,
				Description: "解释用户本人的一笔扣费：把预留、结算扣费、退回、退款、失败补偿按时间串起来，并给出这笔实际花了多少积分和原因说明（summary 可直接引用）。" +
					"id 填 my_records_list 返回的记录 id（创作记录、消耗明细或 API 调用记录都可以）或用户给出的任务 ID；不填则解释最近一笔扣费。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id": map[string]any{"type": "string", "maxLength": 120},
					},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionAccountRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 24 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var request useraccount.ChargeRequest
					if err := json.Unmarshal(invocation.Arguments, &request); err != nil {
						return Result{}, errors.New("扣费解释参数格式不正确")
					}
					explanation, err := useraccount.ExplainCharge(ctx, q, invocation.UserID, request, useraccount.Location(invocation.Timezone))
					if err != nil {
						return accountToolError(err)
					}
					return jsonResultWithMeta(explanation, "charge")
				},
			},
		},
	}
}

func accountToolError(err error) (Result, error) {
	if errors.Is(err, useraccount.ErrInvalid) {
		content, _ := json.Marshal(map[string]any{"error": err.Error()})
		return Result{Content: string(content), Meta: map[string]any{"invalid": true}}, nil
	}
	return Result{}, err
}
