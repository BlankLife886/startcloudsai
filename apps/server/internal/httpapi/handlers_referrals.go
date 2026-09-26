package httpapi

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/referral"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
)

func (s *Server) myReferrals(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	cfg, err := referral.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if !cfg.Enabled {
		fail(c, apperr.E("referrals_unavailable", "邀请好友功能暂未开放", 404))
		return
	}
	code, err := referral.Code(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	var invited, paid, points, reversed, pending, unsettled int64
	var nextSettlement *time.Time
	err = s.St.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM referral_links WHERE inviter_id=$1),
 (SELECT count(DISTINCT invitee_id) FROM referral_rewards WHERE inviter_id=$1),
 (SELECT COALESCE(sum(reward_points) FILTER(WHERE status IN ('granted','recovery_pending')),0) FROM referral_rewards WHERE inviter_id=$1),
 (SELECT COALESCE(sum(reward_points),0) FROM referral_rewards WHERE inviter_id=$1 AND status='reversed'),
 (SELECT COALESCE(sum(reward_points),0) FROM referral_rewards WHERE inviter_id=$1 AND status='recovery_pending'),
 (SELECT COALESCE(sum(reward_points),0) FROM referral_rewards WHERE inviter_id=$1 AND status='pending_settlement'),
 (SELECT min(settlement_due_at) FROM referral_rewards WHERE inviter_id=$1 AND status='pending_settlement')`, user.ID).Scan(&invited, &paid, &points, &reversed, &pending, &unsettled, &nextSettlement)
	if err != nil {
		fail(c, err)
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	page = min(max(page, 1), 1000000)
	rows, err := s.St.Pool.Query(ctx, `SELECT order_id::text,reward_points,base_points,created_at,status,decision_reason,settlement_month::text,settlement_due_at,settled_at FROM referral_rewards
 WHERE inviter_id=$1 ORDER BY created_at DESC,order_id DESC LIMIT 21 OFFSET $2`, user.ID, (page-1)*20)
	if err != nil {
		fail(c, err)
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id string
		var reward, base int64
		var at time.Time
		var status, reason string
		var month string
		var due time.Time
		var settledAt *time.Time
		if err := rows.Scan(&id, &reward, &base, &at, &status, &reason, &month, &due, &settledAt); err != nil {
			fail(c, err)
			return
		}
		items = append(items, gin.H{"id": id, "points": reward, "basePoints": base, "createdAt": at, "status": status, "decisionReason": reason, "settlementMonth": month, "settlementDueAt": due, "settledAt": settledAt})
	}
	if err := rows.Err(); err != nil {
		fail(c, err)
		return
	}
	hasMore := len(items) > 20
	if hasMore {
		items = items[:20]
	}
	c.Header("Cache-Control", "no-store")
	ok(c, gin.H{"code": code, "invitePath": "/auth?ref=" + code, "config": cfg, "invitedCount": invited, "paidCount": paid, "totalPoints": points, "reversedPoints": reversed, "pendingRecoveryPoints": pending, "pendingSettlementPoints": unsettled, "nextSettlementAt": nextSettlement, "items": items, "page": page, "hasMore": hasMore})
}
func (s *Server) adminReferralConfig(c *gin.Context, _ *store.User) {
	cfg, err := referral.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, cfg)
}
func (s *Server) adminSaveReferralConfig(c *gin.Context, _ *store.User) {
	cfg, loadErr := referral.Load(c.Request.Context(), s.St.Pool)
	if loadErr != nil {
		fail(c, loadErr)
		return
	}
	if err := bindJSON(c, &cfg); err != nil {
		fail(c, err)
		return
	}
	if err := referral.Validate(cfg); err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	cfg.Version = 3
	cfg.SettlementCycle = "monthly"
	raw, err := json.Marshal(cfg)
	if err != nil {
		fail(c, err)
		return
	}
	if err := settings.Set(c.Request.Context(), s.St.Pool, "referral_config", raw); err != nil {
		fail(c, err)
		return
	}
	ok(c, cfg)
}
