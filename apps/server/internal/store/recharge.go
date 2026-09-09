package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const MaxRechargeYuan int64 = 1000

type RechargePolicy struct {
	PointsPerYuan    int64 `json:"pointsPerYuan"`
	PriceLockMinYuan int64 `json:"priceLockMinYuan"`
}

func (p RechargePolicy) MaxYuan() int64 {
	if p.PointsPerYuan <= 0 {
		return 0
	}
	return min(MaxRechargeYuan, 1000000000/p.PointsPerYuan)
}

func (p RechargePolicy) Validate() error {
	if p.PointsPerYuan < 1 || p.PointsPerYuan > 1000000 {
		return fmt.Errorf("每元积分须为1-1000000的整数")
	}
	if p.PriceLockMinYuan < 1 || p.PriceLockMinYuan > p.MaxYuan() {
		return fmt.Errorf("锁价门槛须为1-%d元的整数", p.MaxYuan())
	}
	return nil
}

func QuoteRecharge(plan *Plan, amountYuan int64) (*Plan, error) {
	if plan == nil || plan.Kind != "topup" || plan.RechargePolicy == nil {
		return nil, fmt.Errorf("该套餐不支持自定义充值")
	}
	if err := plan.RechargePolicy.Validate(); err != nil {
		return nil, err
	}
	if amountYuan < 1 || amountYuan > plan.RechargePolicy.MaxYuan() {
		return nil, fmt.Errorf("充值金额须为1-%d元的整数", plan.RechargePolicy.MaxYuan())
	}
	quoted := *plan
	quoted.PriceCents = amountYuan * 100
	quoted.GrantCents = amountYuan * plan.RechargePolicy.PointsPerYuan
	quoted.BonusCents = 0
	quoted.PriceLockEligible = plan.PriceLockEligible && amountYuan >= plan.RechargePolicy.PriceLockMinYuan
	return &quoted, nil
}

func GetOrInsertRechargeOrder(ctx context.Context, st *Store, userID, planID uuid.UUID, amountYuan int64, expectedRevision int, provider string) (*Order, bool, error) {
	if amountYuan < 1 || amountYuan > MaxRechargeYuan {
		return nil, false, fmt.Errorf("充值金额须为1-%d元的整数", MaxRechargeYuan)
	}
	var order *Order
	created := false
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, userID.String()); err != nil {
			return err
		}
		existing, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE user_id=$1 AND status IN ('pending','uncertain','paid') ORDER BY created_at DESC LIMIT 1`, userID))
		if err == nil {
			if existing.PlanID != planID || existing.RechargePolicy == nil || existing.AmountCents != amountYuan*100 {
				return ErrUserUnsettledOrder
			}
			order = existing
			return nil
		}
		if err != pgx.ErrNoRows {
			return err
		}
		plan, err := scanPlan(tx.QueryRow(ctx, `SELECT `+planCols+` FROM plans WHERE id=$1 FOR SHARE`, planID))
		if err == pgx.ErrNoRows {
			return ErrOrderPlanChanged
		}
		if err != nil {
			return err
		}
		if !plan.Active || plan.Revision != expectedRevision || plan.RechargePolicy == nil {
			return ErrOrderPlanChanged
		}
		quote, err := QuoteRecharge(plan, amountYuan)
		if err != nil {
			return err
		}
		order, err = InsertOrder(ctx, tx, userID, planID, quote.PriceCents, quote.GrantCents, 0, provider)
		if err != nil {
			return err
		}
		// Amount eligibility and conversion rules belong to this order, not the mutable catalog.
		if _, err := tx.Exec(ctx, `UPDATE orders SET price_lock_eligible_snapshot=$2,recharge_policy_snapshot=$3 WHERE id=$1`, order.ID, quote.PriceLockEligible, quote.RechargePolicy); err != nil {
			return err
		}
		order.PriceLockEligible = quote.PriceLockEligible
		order.RechargePolicy = quote.RechargePolicy
		created = true
		return nil
	})
	return order, created, err
}
