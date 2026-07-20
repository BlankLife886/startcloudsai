// 后台扩展接口（v2 增补）：用户详情/用户账本/重置密码/全站账本/财务汇总/
// 任务 cancel+force-fail/审计日志。
package httpapi

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

// ---------- users ----------

func (s *Server) adminGetUser(c *gin.Context, _ *store.User) {
	userID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByID(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil {
		fail(c, apperr.E("not_found", "用户不存在", 404))
		return
	}
	wallet, err := store.GetWallet(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	byStatus, err := store.TaskCountsBy(ctx, s.St.Pool, userID, "status")
	if err != nil {
		fail(c, err)
		return
	}
	orders, err := store.CountOrdersByUser(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	submissions, err := store.CountSubmissionsByUser(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	var tasksTotal int64
	for _, n := range byStatus {
		tasksTotal += n
	}
	walletOut := gin.H{"balanceCents": int64(0), "frozenCents": int64(0)}
	if wallet != nil {
		walletOut = gin.H{"balanceCents": wallet.BalanceCents, "frozenCents": wallet.FrozenCents}
	}
	ok(c, gin.H{
		"user":   adminUserDict(user, nil),
		"wallet": walletOut,
		"counts": gin.H{
			"orders":         orders,
			"tasksTotal":     tasksTotal,
			"tasksSucceeded": byStatus["succeeded"],
			"tasksFailed":    byStatus["failed"],
			"tasksRunning":   byStatus["running"] + byStatus["queued"],
			"submissions":    submissions,
		},
	})
}

func (s *Server) adminUserLedger(c *gin.Context, _ *store.User) {
	userID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByID(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil {
		fail(c, apperr.E("not_found", "用户不存在", 404))
		return
	}
	rows, err := store.ListLedgerFiltered(ctx, s.St.Pool, &userID, "", "", nil, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, ledgerDict))
}

type resetPasswordIn struct {
	NewPassword string `json:"newPassword"`
}

func (s *Server) adminResetPassword(c *gin.Context, _ *store.User) {
	userID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body resetPasswordIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.NewPassword) < 8 || len(body.NewPassword) > 128 {
		fail(c, apperr.E("validation_error", "newPassword: 长度须在 8-128 之间", 422))
		return
	}
	ctx := c.Request.Context()
	user, err := store.GetUserByID(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	if user == nil {
		fail(c, apperr.E("not_found", "用户不存在", 404))
		return
	}
	passwordHash, err := auth.HashPassword(body.NewPassword)
	if err != nil {
		fail(c, err)
		return
	}
	var revoked int64
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if terr := store.UpdateUserPassword(ctx, tx, userID, passwordHash); terr != nil {
			return terr
		}
		var derr error
		revoked, derr = store.DeleteSessionsByUser(ctx, tx, userID)
		return derr
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"revokedSessions": revoked})
}

// ---------- ledger（全站） ----------

func (s *Server) adminSiteLedger(c *gin.Context, _ *store.User) {
	kind := c.Query("kind")
	if kind != "" && !store.Contains(store.LedgerKinds, kind) {
		fail(c, apperr.E("validation_error", "无效的账本类型", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	var userIDs []uuid.UUID
	if userQuery := c.Query("user"); userQuery != "" {
		userIDs, err = s.matchUserIDsOrImpossible(c, userQuery)
		if err != nil {
			fail(c, err)
			return
		}
	}
	ctx := c.Request.Context()
	rows, err := store.ListLedgerFiltered(ctx, s.St.Pool, nil, kind, c.Query("sourceType"), userIDs, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	unique := map[uuid.UUID]bool{}
	var uids []uuid.UUID
	for _, e := range rows {
		if !unique[e.UserID] {
			unique[e.UserID] = true
			uids = append(uids, e.UserID)
		}
	}
	users, err := store.GetUsersByIDs(ctx, s.St.Pool, uids)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(e *store.LedgerEntry) gin.H {
		d := ledgerDict(e)
		d["userId"] = e.UserID.String()
		if user := users[e.UserID]; user != nil {
			d["userEmail"] = user.Email
		} else {
			d["userEmail"] = nil
		}
		return d
	}))
}

// ---------- finance ----------

func (s *Server) adminFinanceSummary(c *gin.Context, _ *store.User) {
	days := 30
	if raw := c.Query("days"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			fail(c, apperr.E("validation_error", "days: 须为整数", 422))
			return
		}
		days = n
	}
	data, err := financeSummaryData(c.Request.Context(), s.St.Pool, days)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, data)
}

// financeSummaryData 聚合近 days 天（clamp 7-90）财务汇总，日期序列补零。
func financeSummaryData(ctx context.Context, q store.Q, days int) (gin.H, error) {
	if days < 7 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	now := time.Now().UTC()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	since := todayStart.AddDate(0, 0, -(days - 1))

	revenueByDay, err := store.RevenueDailySince(ctx, q, since)
	if err != nil {
		return nil, err
	}
	spendByDay, err := store.SpendDailySince(ctx, q, since)
	if err != nil {
		return nil, err
	}
	grantCents, refundCents, err := store.FinanceTotalsSince(ctx, q, since)
	if err != nil {
		return nil, err
	}

	revenueDaily := make([]gin.H, 0, days)
	spendDaily := make([]gin.H, 0, days)
	var revenueTotal, spendTotal int64
	for offset := days - 1; offset >= 0; offset-- {
		day := now.AddDate(0, 0, -offset).Format("2006-01-02")
		revenueDaily = append(revenueDaily, gin.H{"date": day, "amountCents": revenueByDay[day]})
		spendDaily = append(spendDaily, gin.H{"date": day, "amountCents": spendByDay[day]})
		revenueTotal += revenueByDay[day]
		spendTotal += spendByDay[day]
	}
	return gin.H{
		"revenueDaily": revenueDaily,
		"spendDaily":   spendDaily,
		"totals": gin.H{
			"revenueCents": revenueTotal,
			"spendCents":   spendTotal,
			"grantCents":   grantCents,
			"refundCents":  refundCents,
		},
	}, nil
}

// ---------- tasks ----------

func (s *Server) adminCancelTask(c *gin.Context, _ *store.User) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	task, err := taskflow.AdminCancelTask(c.Request.Context(), s.St, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, adminTaskDict(task, nil))
}

func (s *Server) adminForceFailTask(c *gin.Context, _ *store.User) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	task, err := taskflow.ForceFailTask(c.Request.Context(), s.St, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, adminTaskDict(task, nil))
}

// ---------- audit logs ----------

func (s *Server) adminAuditLogs(c *gin.Context, _ *store.User) {
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListAuditLogs(c.Request.Context(), s.St.Pool, c.Query("admin"), c.Query("path"), limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, auditLogDict))
}

func auditLogDict(l *store.AdminAuditLog) gin.H {
	var detail any
	if len(l.Detail) > 0 {
		detail = json.RawMessage(l.Detail)
	}
	var adminID *string
	if l.AdminID != nil {
		v := l.AdminID.String()
		adminID = &v
	}
	return gin.H{
		"id":         l.ID.String(),
		"adminId":    adminID,
		"adminEmail": l.AdminEmail,
		"method":     l.Method,
		"path":       l.Path,
		"action":     l.Action,
		"targetId":   l.TargetID,
		"status":     l.Status,
		"ip":         l.IP,
		"detail":     detail,
		"createdAt":  isoValue(l.CreatedAt),
	}
}
