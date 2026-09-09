package referral

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func SettlementDueAt(at time.Time) time.Time {
	local := at.In(time.FixedZone("Asia/Shanghai", 8*60*60))
	return time.Date(local.Year(), local.Month()+1, 1, 0, 5, 0, 0, local.Location()).UTC()
}

var ErrSettledMonthPending = errors.New("settled referral month contains pending rewards")

// SettleDue pays closed months only. A wallet lock and a unique month record
// serialize competing workers and administrative cancellations.
func SettleDue(ctx context.Context, st *store.Store) (int, error) {
	cfg, err := Load(ctx, st.Pool)
	if err != nil {
		return 0, err
	}
	if cfg.SettlementPaused {
		return 0, nil
	}
	// Accruals use the database clock as well. A fast or slow worker clock must
	// never decide whether the accounting month has closed.
	var at time.Time
	if err := st.Pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&at); err != nil {
		return 0, err
	}
	rows, err := st.Pool.Query(ctx, `SELECT r.inviter_id,r.settlement_month::text FROM referral_rewards r
 JOIN users u ON u.id=r.inviter_id
 WHERE r.status='pending_settlement' AND r.settlement_due_at<=$1 AND COALESCE(r.settlement_retry_at,r.settlement_due_at)<=$1
 AND u.status='active' AND u.role='user'
 AND NOT EXISTS(SELECT 1 FROM referral_rewards debt WHERE debt.inviter_id=r.inviter_id AND debt.status='recovery_pending')
 GROUP BY r.inviter_id,r.settlement_month ORDER BY r.settlement_month,r.inviter_id LIMIT 50`, at)
	if err != nil {
		return 0, err
	}
	type group struct {
		User  uuid.UUID
		Month string
	}
	groups := []group{}
	for rows.Next() {
		var g group
		if err := rows.Scan(&g.User, &g.Month); err != nil {
			rows.Close()
			return 0, err
		}
		groups = append(groups, g)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	settled := 0
	var firstErr error
	for _, g := range groups {
		if ctx.Err() != nil {
			return settled, ctx.Err()
		}
		paid := false
		err := st.Tx(ctx, func(tx pgx.Tx) error {
			var balance int64
			if err := tx.QueryRow(ctx, `SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE SKIP LOCKED`, g.User).Scan(&balance); errors.Is(err, pgx.ErrNoRows) {
				return nil
			} else if err != nil {
				return err
			}
			current, err := Load(ctx, tx)
			if err != nil {
				return err
			}
			if current.SettlementPaused {
				return nil
			}
			var eligible bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND status='active' AND role='user')
 AND NOT EXISTS(SELECT 1 FROM referral_rewards WHERE inviter_id=$1 AND status='recovery_pending')`, g.User).Scan(&eligible); err != nil {
				return err
			}
			if !eligible {
				return nil
			}
			var points, count int64
			if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(reward_points),0),count(*) FROM referral_rewards
 WHERE inviter_id=$1 AND settlement_month=$2::date AND status='pending_settlement' AND settlement_due_at<=$3`, g.User, g.Month, at).Scan(&points, &count); err != nil {
				return err
			}
			if points == 0 {
				return nil
			}
			var alreadySettled bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM referral_settlements WHERE inviter_id=$1 AND settlement_month=$2::date)`, g.User, g.Month).Scan(&alreadySettled); err != nil {
				return err
			}
			if alreadySettled {
				return ErrSettledMonthPending
			}
			var settledAt time.Time
			if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&settledAt); err != nil {
				return err
			}
			id := uuid.New()
			if _, err := tx.Exec(ctx, `INSERT INTO referral_settlements(id,inviter_id,settlement_month,points,reward_count,settled_at) VALUES($1,$2,$3::date,$4,$5,$6)`, id, g.User, g.Month, points, count, settledAt); err != nil {
				return err
			}
			reason := fmt.Sprintf("邀请返利月度结算（%s，%d 笔）：%d 积分", g.Month[:7], count, points)
			if _, err := wallet.Grant(ctx, tx, g.User, points, "grant", "referral_settlement", id.String(), &reason); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE referral_rewards SET status='granted',settlement_id=$3,settled_at=$4,settlement_error='',settlement_retry_at=NULL
 WHERE inviter_id=$1 AND settlement_month=$2::date AND status='pending_settlement' AND settlement_due_at<=$5`, g.User, g.Month, id, settledAt, at); err != nil {
				return err
			}
			paid = true
			return nil
		})
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("settle referral month %s/%s: %w", g.User, g.Month, err)
			}
			blocked := errors.Is(err, ErrSettledMonthPending)
			message := "月度结算失败，等待自动重试"
			if blocked {
				message = "该月份已有结算批次但仍有待结算记录，已停止自动发放，请人工核对"
			}
			retryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			_, _ = st.Pool.Exec(retryCtx, `UPDATE referral_rewards SET settlement_retry_at=CASE WHEN $3 THEN 'infinity'::timestamptz ELSE clock_timestamp()+interval '15 minutes' END,settlement_error=$4
 WHERE inviter_id=$1 AND settlement_month=$2::date AND status='pending_settlement'`, g.User, g.Month, blocked, message)
			cancel()
		} else if paid {
			settled++
		}
	}
	return settled, firstErr
}
