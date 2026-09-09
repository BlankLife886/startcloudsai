package httpapi

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func referralListParams(c *gin.Context) (string, int, error) {
	query := strings.TrimSpace(c.Query("q"))
	if len([]rune(query)) > 100 {
		return "", 0, apperr.E("validation_error", "搜索内容不能超过100字", 422)
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 10000 {
		return "", 0, apperr.E("validation_error", "页码无效", 422)
	}
	return query, page, nil
}

func (s *Server) adminReferralRelations(c *gin.Context, _ *store.User) {
	query, page, err := referralListParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := s.St.Pool.Query(c.Request.Context(), `SELECT r.invitee_id,r.inviter_id,a.email,b.email,r.created_at,
 (SELECT count(*) FROM referral_rewards x WHERE x.invitee_id=r.invitee_id),
 (SELECT COALESCE(sum(reward_points) FILTER(WHERE status IN ('granted','recovery_pending')),0) FROM referral_rewards x WHERE x.invitee_id=r.invitee_id)
 FROM referral_links r JOIN users a ON a.id=r.inviter_id JOIN users b ON b.id=r.invitee_id
 WHERE $1='' OR a.email ILIKE '%'||$1||'%' OR b.email ILIKE '%'||$1||'%' OR r.invitee_id::text=$1 OR r.inviter_id::text=$1
 ORDER BY r.created_at DESC,r.invitee_id DESC LIMIT 21 OFFSET $2`, query, (page-1)*20)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var invitee, inviter uuid.UUID
		var a, b string
		var at time.Time
		var orders, points int64
		if err := rows.Scan(&invitee, &inviter, &a, &b, &at, &orders, &points); err != nil {
			fail(c, err)
			return
		}
		items = append(items, gin.H{"inviteeId": invitee, "inviterId": inviter, "inviterEmail": a, "inviteeEmail": b, "createdAt": at, "orderCount": orders, "netPoints": points})
	}
	if err := rows.Err(); err != nil {
		fail(c, err)
		return
	}
	more := len(items) > 20
	if more {
		items = items[:20]
	}
	ok(c, gin.H{"items": items, "page": page, "hasMore": more})
}

func (s *Server) adminReferralRewards(c *gin.Context, _ *store.User) {
	query, page, err := referralListParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	status := c.Query("status")
	if status != "" && !store.Contains([]string{"pending_settlement", "voided", "granted", "skipped", "recovery_pending", "reversed"}, status) {
		fail(c, apperr.E("validation_error", "奖励状态无效", 422))
		return
	}
	month := strings.TrimSpace(c.Query("month"))
	if month != "" {
		if _, err := time.Parse("2006-01", month); err != nil {
			fail(c, apperr.E("validation_error", "结算月份格式须为YYYY-MM", 422))
			return
		}
	}
	rows, err := s.St.Pool.Query(c.Request.Context(), `SELECT r.order_id,r.inviter_id,r.invitee_id,a.email,b.email,r.base_points,r.reward_points,r.mode,r.rate,r.status,r.decision_reason,r.config_snapshot,r.created_at,r.reversed_at,r.reversal_reason,
 COALESCE(CASE WHEN r.status IN ('pending_settlement','voided','skipped') THEN g.id IS NULL AND m.id IS NULL AND v.id IS NULL AND r.settlement_id IS NULL
 ELSE (CASE WHEN r.settlement_id IS NULL THEN g.delta_cents=r.reward_points AND g.user_id=r.inviter_id
 ELSE m.delta_cents=s.points AND m.user_id=r.inviter_id AND s.inviter_id=r.inviter_id AND s.settlement_month=r.settlement_month
 AND (SELECT sum(x.reward_points) FROM referral_rewards x WHERE x.settlement_id=s.id)=s.points
 AND NOT EXISTS(SELECT 1 FROM referral_rewards x WHERE x.settlement_id=s.id AND x.inviter_id<>s.inviter_id) END)
 AND COALESCE(v.delta_cents,0)=CASE WHEN r.status='reversed' THEN -r.reward_points ELSE 0 END
 AND (r.status<>'reversed' OR v.user_id=r.inviter_id) END,false) AS ledger_consistent,
 r.settlement_month::text,r.settlement_due_at,r.settled_at,r.settlement_id,r.settlement_error,r.voided_at
 FROM referral_rewards r JOIN users a ON a.id=r.inviter_id JOIN users b ON b.id=r.invitee_id
 LEFT JOIN wallet_ledger g ON g.kind='grant' AND g.source_type='referral' AND g.source_id=r.order_id::text
	LEFT JOIN wallet_ledger v ON v.kind='admin_adjust' AND v.source_type='admin' AND v.source_id='referral-reversal/'||r.order_id::text
 LEFT JOIN referral_settlements s ON s.id=r.settlement_id
 LEFT JOIN wallet_ledger m ON m.kind='grant' AND m.source_type='referral_settlement' AND m.source_id=s.id::text
 WHERE ($1='' OR a.email ILIKE '%'||$1||'%' OR b.email ILIKE '%'||$1||'%' OR r.order_id::text=$1 OR r.inviter_id::text=$1 OR r.invitee_id::text=$1)
	AND ($2='' OR r.status=$2)
 AND ($4='' OR to_char(r.settlement_month,'YYYY-MM')=$4)
 ORDER BY r.created_at DESC,r.order_id DESC LIMIT 21 OFFSET $3`, query, status, (page-1)*20, month)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var order, inviter, invitee uuid.UUID
		var a, b, mode, state, decision, reason string
		var base, points int64
		var rate int
		var snapshot json.RawMessage
		var at time.Time
		var reversed *time.Time
		var consistent bool
		var period, settlementError string
		var due time.Time
		var settledAt, voidedAt *time.Time
		var settlementID *uuid.UUID
		if err := rows.Scan(&order, &inviter, &invitee, &a, &b, &base, &points, &mode, &rate, &state, &decision, &snapshot, &at, &reversed, &reason, &consistent, &period, &due, &settledAt, &settlementID, &settlementError, &voidedAt); err != nil {
			fail(c, err)
			return
		}
		items = append(items, gin.H{"orderId": order, "inviterId": inviter, "inviteeId": invitee, "inviterEmail": a, "inviteeEmail": b, "basePoints": base, "points": points, "mode": mode, "rate": rate, "status": state, "decisionReason": decision, "configSnapshot": snapshot, "createdAt": at, "reversedAt": reversed, "reversalReason": reason, "ledgerConsistent": consistent, "settlementMonth": period, "settlementDueAt": due, "settledAt": settledAt, "settlementId": settlementID, "settlementError": settlementError, "voidedAt": voidedAt})
	}
	if err := rows.Err(); err != nil {
		fail(c, err)
		return
	}
	more := len(items) > 20
	if more {
		items = items[:20]
	}
	var granted, reversed, pending, unsettled int64
	if err := s.St.Pool.QueryRow(c.Request.Context(), `SELECT COALESCE(sum(reward_points) FILTER(WHERE status IN ('granted','reversed','recovery_pending')),0),COALESCE(sum(reward_points) FILTER(WHERE status='reversed'),0),COALESCE(sum(reward_points) FILTER(WHERE status='recovery_pending'),0),COALESCE(sum(reward_points) FILTER(WHERE status='pending_settlement'),0) FROM referral_rewards`).Scan(&granted, &reversed, &pending, &unsettled); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items, "page": page, "hasMore": more, "summary": gin.H{"grantedPoints": granted, "reversedPoints": reversed, "pendingRecoveryPoints": pending, "pendingSettlementPoints": unsettled, "netPoints": granted - reversed}})
}

func (s *Server) adminReferralRewardActions(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := s.St.Pool.Query(c.Request.Context(), `SELECT x.id,x.action,x.reason,x.created_at,a.email FROM referral_reward_actions x JOIN admin_accounts a ON a.id=x.admin_id WHERE order_id=$1 ORDER BY x.created_at,x.id LIMIT 200`, id)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id uuid.UUID
		var action, reason, email string
		var at time.Time
		if err := rows.Scan(&id, &action, &reason, &at, &email); err != nil {
			fail(c, err)
			return
		}
		items = append(items, gin.H{"id": id, "action": action, "reason": reason, "createdAt": at, "adminEmail": email})
	}
	if err := rows.Err(); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) adminReverseReferralReward(c *gin.Context, admin *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		Reason         string `json:"reason"`
		Confirmed      bool   `json:"confirmed"`
		ExpectedStatus string `json:"expectedStatus"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if !store.Contains([]string{"pending_settlement", "granted", "recovery_pending"}, body.ExpectedStatus) {
		fail(c, apperr.E("validation_error", "请提交已确认的奖励状态expectedStatus", 422))
		return
	}
	if !body.Confirmed || len([]rune(body.Reason)) < 6 || len([]rune(body.Reason)) > 300 {
		fail(c, apperr.E("validation_error", "请确认冲正并填写6-300字的核查依据", 422))
		return
	}
	var status string
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		var inner error
		status, inner = referral.ReverseWithExpected(c.Request.Context(), tx, id, admin.ID, body.Reason, body.ExpectedStatus)
		return inner
	})
	if errors.Is(err, pgx.ErrNoRows) {
		err = apperr.E("not_found", "奖励或钱包不存在", 404)
	}
	if err != nil {
		fail(c, err)
		return
	}
	message := "返利已冲正，不代表支付退款已完成"
	if status == "recovery_pending" {
		message = "普通积分余额不足，已标记待追回；新返利暂停计提，已有待结算暂缓到账"
	}
	if status == "skipped" {
		message = "该记录未发放积分，无需冲正"
	}
	if status == "voided" {
		message = "待结算奖励已取消，未扣减钱包积分"
	}
	ok(c, gin.H{"status": status, "message": message})
}
