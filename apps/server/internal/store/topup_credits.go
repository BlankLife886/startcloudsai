package store

import (
	"context"
	"fmt"
	"github.com/google/uuid"
)

func RecordTopupCreditLot(ctx context.Context, q Q, order *Order) error {
	points := order.GrantCents + order.BonusCents
	if points <= 0 {
		return nil
	}
	name := "额度包"
	if order.PlanName != nil {
		name = *order.PlanName
	}
	_, err := q.Exec(ctx, `INSERT INTO topup_credit_lots(user_id,order_id,plan_id,plan_name,plan_revision,price_lock_eligible,granted_points,available_points) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT(order_id) DO NOTHING`, order.UserID, order.ID, order.PlanID, name, order.PlanRevision, order.PriceLockEligible, points)
	return err
}

// Raw wallet balance already contains top-up lots. Tracking never adds a second balance.
func ReserveTopupCredits(ctx context.Context, q Q, userID uuid.UUID, amount int64, sourceType, sourceID string, protected bool) (int64, error) {
	if amount <= 0 {
		return 0, nil
	}
	var balance, total int64
	if err := q.QueryRow(ctx, `SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return 0, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(available_points),0) FROM topup_credit_lots WHERE user_id=$1`, userID).Scan(&total); err != nil {
		return 0, err
	}
	remaining := amount
	if !protected {
		remaining = max(amount-max(balance+amount-total, 0), 0)
	}
	rows, err := q.Query(ctx, `SELECT id,available_points FROM topup_credit_lots WHERE user_id=$1 AND available_points>0 AND (NOT $2 OR price_lock_eligible) ORDER BY price_lock_eligible,created_at,id FOR UPDATE`, userID, protected)
	if err != nil {
		return 0, err
	}
	type lot struct {
		id     uuid.UUID
		points int64
	}
	var lots []lot
	for rows.Next() {
		var l lot
		if err := rows.Scan(&l.id, &l.points); err != nil {
			rows.Close()
			return 0, err
		}
		lots = append(lots, l)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var used int64
	for _, l := range lots {
		points := min(remaining, l.points)
		if points <= 0 {
			break
		}
		if _, err := q.Exec(ctx, `UPDATE topup_credit_lots SET available_points=available_points-$2,frozen_points=frozen_points+$2 WHERE id=$1`, l.id, points); err != nil {
			return 0, err
		}
		if _, err := q.Exec(ctx, `INSERT INTO topup_credit_allocations(lot_id,source_type,source_id,allocated_points,remaining_points) VALUES($1,$2,$3,$4,$4)`, l.id, sourceType, sourceID, points); err != nil {
			return 0, err
		}
		used += points
		remaining -= points
	}
	if protected && remaining > 0 {
		return 0, fmt.Errorf("符合锁价条件的额度包积分不足，请重新报价")
	}
	return used, nil
}

func FinishTopupCredits(ctx context.Context, q Q, userID uuid.UUID, amount int64, sourceType, sourceID, operation string) (int64, error) {
	rows, err := q.Query(ctx, `SELECT a.lot_id,a.remaining_points FROM topup_credit_allocations a JOIN topup_credit_lots l ON l.id=a.lot_id WHERE l.user_id=$1 AND a.source_type=$2 AND a.source_id=$3 AND a.remaining_points>0 ORDER BY l.price_lock_eligible,l.created_at,l.id FOR UPDATE OF a,l`, userID, sourceType, sourceID)
	if err != nil {
		return 0, err
	}
	type lot struct {
		id     uuid.UUID
		points int64
	}
	var lots []lot
	for rows.Next() {
		var l lot
		if err := rows.Scan(&l.id, &l.points); err != nil {
			rows.Close()
			return 0, err
		}
		lots = append(lots, l)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var used int64
	for _, l := range lots {
		points := min(amount-used, l.points)
		if points <= 0 {
			break
		}
		column := "spent_points"
		allocation := "settled_points"
		if operation == "release" {
			column = "available_points"
			allocation = "released_points"
		}
		if _, err := q.Exec(ctx, `UPDATE topup_credit_lots SET frozen_points=frozen_points-$2,`+column+`=`+column+`+$2 WHERE id=$1`, l.id, points); err != nil {
			return 0, err
		}
		if _, err := q.Exec(ctx, `UPDATE topup_credit_allocations SET remaining_points=remaining_points-$4,`+allocation+`=`+allocation+`+$4 WHERE lot_id=$1 AND source_type=$2 AND source_id=$3`, l.id, sourceType, sourceID, points); err != nil {
			return 0, err
		}
		used += points
	}
	return used, nil
}
