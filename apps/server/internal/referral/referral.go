// Package referral binds new accounts to inviters and grants verified top-up rewards.
package referral

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Config struct {
	Version            int    `json:"version"`
	SettlementCycle    string `json:"settlementCycle"`
	Enabled            bool   `json:"enabled"`
	SettlementPaused   bool   `json:"settlementPaused"`
	Mode               string `json:"mode"`
	Percent            int    `json:"percent"`
	FixedPoints        int    `json:"fixedPoints"`
	MinimumAmountCents int64  `json:"minimumAmountCents"`
	DailyLimitPoints   int64  `json:"dailyLimitPoints"`
	FirstRewardOnly    bool   `json:"firstRewardOnly"`
}

func Load(ctx context.Context, q store.Q) (Config, error) {
	cfg := Config{Version: 3, Enabled: false, SettlementPaused: true, Mode: "percent", Percent: 10, FixedPoints: 10, MinimumAmountCents: 100, DailyLimitPoints: 1000}
	raw, err := settings.Get(ctx, q, "referral_config")
	if err != nil {
		return cfg, err
	}
	if raw != nil {
		if err = json.Unmarshal(raw, &cfg); err != nil {
			return cfg, err
		}
	}
	cfg.Version = 3
	cfg.SettlementCycle = "monthly"
	return cfg, Validate(cfg)
}
func Validate(cfg Config) error {
	if cfg.Mode != "percent" && cfg.Mode != "fixed" {
		return fmt.Errorf("返利模式无效")
	}
	if cfg.Percent < 1 || cfg.Percent > 100 || cfg.FixedPoints < 1 || cfg.FixedPoints > 10000 {
		return fmt.Errorf("返利比例须为1-100，固定积分须为1-10000")
	}
	if cfg.MinimumAmountCents < 0 || cfg.MinimumAmountCents > 100000000 || cfg.DailyLimitPoints < 0 || cfg.DailyLimitPoints > 10000000 {
		return fmt.Errorf("最低实付金额须为0-100000000分，每日返利上限须为0-10000000积分；0表示不限制")
	}
	return nil
}
func Code(ctx context.Context, q store.Q, userID uuid.UUID) (string, error) {
	candidate := strings.ToUpper(strings.ReplaceAll(uuid.NewString(), "-", ""))[:16]
	var code string
	err := q.QueryRow(ctx, `INSERT INTO referral_codes(user_id,code) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING code`, userID, candidate).Scan(&code)
	return code, err
}

// BindNewAccount must only run in the registration transaction after account creation.
func BindNewAccount(ctx context.Context, q store.Q, invitee uuid.UUID, code string) error {
	_, err := BindNewAccountResult(ctx, q, invitee, code)
	return err
}

func BindNewAccountResult(ctx context.Context, q store.Q, invitee uuid.UUID, code string) (string, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return "none", nil
	}
	cfg, err := Load(ctx, q)
	if err != nil {
		return "", err
	}
	if !cfg.Enabled {
		return "disabled", nil
	}
	if len(code) != 16 {
		return "invalid", nil
	}
	result, err := q.Exec(ctx, `INSERT INTO referral_links(invitee_id,inviter_id)
 SELECT $1,c.user_id FROM referral_codes c JOIN users inviter ON inviter.id=c.user_id
 JOIN users invitee ON invitee.id=$1
 WHERE c.code=$2 AND c.user_id<>$1 AND inviter.status='active' AND inviter.role='user'
 AND inviter.created_at<invitee.created_at
 ON CONFLICT(invitee_id) DO NOTHING`, invitee, code)
	if err != nil {
		return "", err
	}
	if result.RowsAffected() == 0 {
		return "invalid", nil
	}
	return "bound", nil
}

func RewardPoints(base int64, cfg Config) int64 {
	if base <= 0 {
		return 0
	}
	if cfg.Mode == "fixed" {
		return int64(cfg.FixedPoints)
	}
	// Split division avoids overflowing when computing a percentage of a bigint.
	return base/100*int64(cfg.Percent) + base%100*int64(cfg.Percent)/100
}

// Accrue records the reward without funding the wallet. Month-end settlement pays it later.
func Accrue(ctx context.Context, q store.Q, order *store.Order) error {
	cfg, err := Load(ctx, q)
	if err != nil {
		return err
	}
	if !cfg.Enabled {
		return nil
	}
	if order.GrantCents <= 0 || order.AmountCents <= 0 {
		return nil
	}
	var inviter uuid.UUID
	err = q.QueryRow(ctx, `SELECT r.inviter_id FROM referral_links r JOIN users u ON u.id=r.inviter_id
 JOIN users friend ON friend.id=r.invitee_id
 WHERE r.invitee_id=$1 AND u.status='active' AND friend.status='active'`, order.UserID).Scan(&inviter)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Serializes grants/recoveries for this inviter before checking day and first-reward limits.
	var balance int64
	if err := q.QueryRow(ctx, `SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, inviter).Scan(&balance); err != nil {
		return err
	}
	var exists bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM referral_rewards WHERE order_id=$1)`, order.ID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	// Timestamp after the wallet lock, so a long-running payment cannot backdate
	// an accrual into a month whose settlement has already closed.
	var recordedAt time.Time
	if err := q.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&recordedAt); err != nil {
		return err
	}
	points := RewardPoints(order.GrantCents, cfg)
	status, decision := "pending_settlement", ""
	paidAmount := order.AmountCents
	if order.ProviderPayAmountCents != nil {
		paidAmount = *order.ProviderPayAmountCents
	}
	var hasReward, hasRecovery bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM referral_rewards WHERE invitee_id=$1 AND reward_points>0),
 EXISTS(SELECT 1 FROM referral_rewards WHERE inviter_id=$2 AND status='recovery_pending')`, order.UserID, inviter).Scan(&hasReward, &hasRecovery); err != nil {
		return err
	}
	switch {
	case !cfg.Enabled:
		decision = "disabled"
	case paidAmount < cfg.MinimumAmountCents:
		decision = "below_minimum"
	case hasRecovery:
		decision = "pending_recovery"
	case cfg.FirstRewardOnly && hasReward:
		decision = "already_rewarded"
	case points == 0:
		decision = "rounded_to_zero"
	}
	if decision == "" && cfg.DailyLimitPoints > 0 {
		var used int64
		if err := q.QueryRow(ctx, `SELECT COALESCE(sum(reward_points),0) FROM referral_rewards WHERE inviter_id=$1
 AND created_at >= (($2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date::timestamp AT TIME ZONE 'Asia/Shanghai')`, inviter, recordedAt).Scan(&used); err != nil {
			return err
		}
		remaining := max(int64(0), cfg.DailyLimitPoints-used)
		if remaining == 0 {
			decision = "daily_limit"
		} else if points > remaining {
			points = remaining
			decision = "daily_limit_partial"
		}
	}
	if decision != "" && decision != "daily_limit_partial" {
		points = 0
		status = "skipped"
	}
	snapshot, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	rate := cfg.Percent
	if cfg.Mode == "fixed" {
		rate = cfg.FixedPoints
	}
	_, err = q.Exec(ctx, `INSERT INTO referral_rewards(order_id,inviter_id,invitee_id,base_points,reward_points,mode,rate,status,decision_reason,config_snapshot,created_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(order_id) DO NOTHING`, order.ID, inviter, order.UserID, order.GrantCents, points, cfg.Mode, rate, status, decision, snapshot, recordedAt)
	return err
}

// Reverse must run in a transaction. Pending recoveries are retried explicitly by an admin.
func Reverse(ctx context.Context, q store.Q, orderID, adminID uuid.UUID, reason string) (string, error) {
	return ReverseWithExpected(ctx, q, orderID, adminID, reason, "")
}

func ReverseWithExpected(ctx context.Context, q store.Q, orderID, adminID uuid.UUID, reason, expectedStatus string) (string, error) {
	var inviter uuid.UUID
	if err := q.QueryRow(ctx, `SELECT inviter_id FROM referral_rewards WHERE order_id=$1`, orderID).Scan(&inviter); err != nil {
		return "", err
	}
	var balance int64
	if err := q.QueryRow(ctx, `SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`, inviter).Scan(&balance); err != nil {
		return "", err
	}
	var points int64
	var status, originalReason string
	var settlementID *uuid.UUID
	if err := q.QueryRow(ctx, `SELECT reward_points,status,reversal_reason,settlement_id FROM referral_rewards WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&points, &status, &originalReason, &settlementID); err != nil {
		return "", err
	}
	if status == "reversed" || status == "skipped" || status == "voided" {
		return status, nil
	}
	if expectedStatus != "" && status != expectedStatus {
		return "", apperr.E("referral_status_changed", "奖励状态已变化，请刷新并重新确认操作", 409)
	}
	grant, err := store.GetLedgerEntry(ctx, q, "grant", "referral", orderID.String())
	if err != nil {
		return "", err
	}
	if status == "pending_settlement" {
		reversal, err := store.GetLedgerEntry(ctx, q, "admin_adjust", "admin", "referral-reversal/"+orderID.String())
		if err != nil {
			return "", err
		}
		if reversal != nil {
			return "", apperr.E("referral_ledger_mismatch", "待结算奖励存在扣款记录，请人工核查", 409)
		}
		if grant != nil || settlementID != nil {
			return "", apperr.E("referral_ledger_mismatch", "待结算记录存在到账信息，请人工核查", 409)
		}
		if _, err := q.Exec(ctx, `UPDATE referral_rewards SET status='voided',voided_at=now(),reversal_reason=$2,reversal_admin_id=$3 WHERE order_id=$1`, orderID, reason, adminID); err != nil {
			return "", err
		}
		_, err = q.Exec(ctx, `INSERT INTO referral_reward_actions(order_id,admin_id,action,reason) VALUES($1,$2,'reward_voided',$3)`, orderID, adminID, reason)
		return "voided", err
	}
	expected := points
	if settlementID != nil {
		var owner uuid.UUID
		var allocated int64
		var allOwned bool
		if err := q.QueryRow(ctx, `SELECT s.inviter_id,s.points,COALESCE(sum(r.reward_points),0),bool_and(r.inviter_id=s.inviter_id AND r.settlement_month=s.settlement_month)
 FROM referral_settlements s JOIN referral_rewards r ON r.settlement_id=s.id WHERE s.id=$1 GROUP BY s.id`, *settlementID).Scan(&owner, &expected, &allocated, &allOwned); err != nil {
			return "", err
		}
		if owner != inviter || allocated != expected || !allOwned {
			return "", apperr.E("referral_ledger_mismatch", "月度结算分配不一致，请人工核查", 409)
		}
		grant, err = store.GetLedgerEntry(ctx, q, "grant", "referral_settlement", settlementID.String())
		if err != nil {
			return "", err
		}
	}
	if grant == nil || grant.UserID != inviter || grant.DeltaCents != expected {
		return "", apperr.E("referral_ledger_mismatch", "原始返利账本不一致，请先人工核查", 409)
	}
	previous, err := store.GetLedgerEntry(ctx, q, "admin_adjust", "admin", "referral-reversal/"+orderID.String())
	if err != nil {
		return "", err
	}
	if previous != nil {
		return "", apperr.E("referral_ledger_mismatch", "冲正账本与奖励状态不一致，请先人工核查", 409)
	}
	if status == "granted" {
		if _, err := q.Exec(ctx, `INSERT INTO referral_reward_actions(order_id,admin_id,action,reason) VALUES($1,$2,'reversal_requested',$3)`, orderID, adminID, reason); err != nil {
			return "", err
		}
	} else {
		reason = originalReason
	}
	if balance < points {
		_, err := q.Exec(ctx, `UPDATE referral_rewards SET status='recovery_pending',reversal_reason=$2,reversal_admin_id=COALESCE(reversal_admin_id,$3) WHERE order_id=$1`, orderID, reason, adminID)
		return "recovery_pending", err
	}
	entryReason := "邀请返利冲正：" + reason
	if _, err := wallet.AdminAdjust(ctx, q, inviter, -points, "referral-reversal/"+orderID.String(), entryReason); err != nil {
		return "", err
	}
	if _, err := q.Exec(ctx, `UPDATE referral_rewards SET status='reversed',reversed_at=$2,reversal_reason=$3,reversal_admin_id=COALESCE(reversal_admin_id,$4) WHERE order_id=$1`, orderID, time.Now().UTC(), reason, adminID); err != nil {
		return "", err
	}
	_, err = q.Exec(ctx, `INSERT INTO referral_reward_actions(order_id,admin_id,action,reason) VALUES($1,$2,'reversal_completed',$3)`, orderID, adminID, reason)
	return "reversed", err
}
