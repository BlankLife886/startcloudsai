// 后台扩展接口（v2 增补）：用户详情/用户账本/全站账本/财务汇总/
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
	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

// ---------- users ----------

type adminTaskPatchIn struct {
	Status string `json:"status"`
}

func (s *Server) adminPatchTask(c *gin.Context, admin *store.User) {
	var body adminTaskPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	switch body.Status {
	case "queued":
		s.adminRequeueTask(c, admin)
	case "canceled":
		s.adminCancelTask(c, admin)
	case "failed":
		s.adminForceFailTask(c, admin)
	default:
		fail(c, apperr.E("validation_error", "status: 操作不受支持", 422))
	}
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
	tasksByID, runsByID, err := loadLedgerRelated(ctx, s.St.Pool, rows)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(entry *store.LedgerEntry) gin.H {
		return decorateLedgerEntry(entry, tasksByID, runsByID)
	}))
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
	tasksByID, runsByID, err := loadLedgerRelated(ctx, s.St.Pool, rows)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(e *store.LedgerEntry) gin.H {
		d := decorateLedgerEntry(e, tasksByID, runsByID)
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

func adminAssistantRunDict(run *store.AssistantRun) gin.H {
	params := make(map[string]any, len(run.Params)+4)
	for key, value := range run.Params {
		if key != "referenceImages" {
			params[key] = value
		}
	}
	params["conversationId"] = run.ConversationID.String()
	params["mode"] = run.Mode
	params["resolvedMode"] = run.ResolvedMode
	params["stage"] = run.Stage
	return gin.H{
		"id": run.ID.String(), "userId": run.UserID.String(), "type": "assistant",
		"source": assistantRunTaskSource(params), "model": run.Params["model"], "status": run.Status,
		"prompt": run.Prompt, "params": params, "count": run.Params["count"],
		"inputKeys": []string{}, "outputKeys": []string{}, "outputUrls": []string{},
		"costCents": run.CostCents, "reservedCents": run.ReservedCents,
		"errorCode": run.ErrorCode, "errorMessage": run.ErrorMessage,
		"attempt": 0, "createdAt": isoValue(run.CreatedAt), "startedAt": iso(run.StartedAt),
		"finishedAt": iso(run.FinishedAt),
	}
}

func assistantAdminMetadata(message *store.AssistantMessage, run *store.AssistantRun, stage, errorMessage string) map[string]any {
	metadata := assistantMessageMetadataWithoutOutputs(message)
	metadata["runId"] = run.ID.String()
	metadata["statusStage"] = stage
	metadata["pending"] = stage == "queued"
	metadata["routing"] = stage == "queued" && run.Mode == "agent"
	metadata["error"] = errorMessage
	return metadata
}

func (s *Server) adminRequeueAssistantRun(ctx context.Context, id uuid.UUID) (*store.AssistantRun, error) {
	var run *store.AssistantRun
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		var err error
		run, err = store.GetAssistantRunForUpdate(ctx, tx, id)
		if err != nil {
			return err
		}
		if run == nil {
			return apperr.E("task_not_found", "任务不存在", 404)
		}
		if err := store.LockAssistantRunsForUser(ctx, tx, run.UserID); err != nil {
			return err
		}
		active, err := store.ListActiveUserAssistantRuns(ctx, tx, run.UserID)
		if err != nil {
			return err
		}
		if err := validateAssistantRunCapacity(active, run.ConversationID); err != nil {
			return err
		}
		changed, err := assistantbilling.Requeue(ctx, tx, run)
		if err != nil {
			return err
		}
		if !changed {
			return apperr.E("task_not_cancelable", "仅失败任务可以重新入队", 400)
		}
		message, err := store.GetAssistantMessage(ctx, tx, run.AssistantMessageID)
		if err != nil {
			return err
		}
		if message != nil {
			if err := store.EnqueueAssistantMessageOutputCleanup(ctx, tx, run.UserID, message.ID); err != nil {
				return err
			}
			metadata := assistantAdminMetadata(message, run, "queued", "")
			if err := store.UpdateAssistantMessage(ctx, tx, message.ID, "", run.Mode, "queued", metadata); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.Queue.EnqueueAssistantRunRecovery(ctx, id.String()); err != nil {
		message := "任务入队失败，请稍后重试"
		if _, failErr := assistantbilling.Fail(ctx, s.St, id, "queue_error", message); failErr != nil {
			return nil, failErr
		}
		if assistantMessage, getErr := store.GetAssistantMessage(ctx, s.St.Pool, run.AssistantMessageID); getErr == nil && assistantMessage != nil {
			_ = store.UpdateAssistantMessage(ctx, s.St.Pool, assistantMessage.ID, message, run.Mode, "failed",
				assistantAdminMetadata(assistantMessage, run, "failed", message))
		}
		return nil, apperr.E("queue_error", message, 503)
	}
	return store.GetAssistantRun(ctx, s.St.Pool, id)
}

func (s *Server) adminCancelAssistantRun(ctx context.Context, id uuid.UUID) (*store.AssistantRun, error) {
	var run *store.AssistantRun
	var changed bool
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		var txErr error
		run, changed, txErr = assistantbilling.CancelAdminQueuedTx(ctx, tx, id)
		if txErr != nil || !changed || run == nil {
			return txErr
		}
		message, messageErr := store.GetAssistantMessage(ctx, tx, run.AssistantMessageID)
		if messageErr != nil || message == nil {
			return messageErr
		}
		content := message.Content
		if content == "" {
			content = "已停止生成"
		}
		return store.ClearAssistantMessageOutputMetadata(ctx, tx, run.UserID, message.ID, content,
			message.Kind, "stopped", assistantAdminMetadata(message, run, "stopped", ""))
	})
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, apperr.E("task_not_found", "任务不存在", 404)
	}
	if !changed {
		return nil, apperr.E("task_not_cancelable", "仅排队中的任务可以取消", 400)
	}
	if s.Queue != nil {
		s.Queue.CancelAssistantRun(id.String())
	}
	return store.GetAssistantRun(ctx, s.St.Pool, id)
}

func (s *Server) adminForceFailAssistantRun(ctx context.Context, id uuid.UUID) (*store.AssistantRun, error) {
	var run *store.AssistantRun
	var changed bool
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		var txErr error
		run, changed, txErr = assistantbilling.ForceFailAdminTx(ctx, tx, id)
		if txErr != nil || !changed || run == nil {
			return txErr
		}
		message, messageErr := store.GetAssistantMessage(ctx, tx, run.AssistantMessageID)
		if messageErr != nil || message == nil {
			return messageErr
		}
		content := message.Content
		if content == "" {
			content = "管理员已终止任务"
		}
		return store.ClearAssistantMessageOutputMetadata(ctx, tx, run.UserID, message.ID, content,
			message.Kind, "failed", assistantAdminMetadata(message, run, "failed", "管理员强制终止任务"))
	})
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, apperr.E("task_not_found", "任务不存在", 404)
	}
	if !changed {
		return nil, apperr.E("task_not_cancelable", "仅运行中的任务可以强制失败", 400)
	}
	if s.Queue != nil {
		s.Queue.CancelAssistantRun(id.String())
	}
	return store.GetAssistantRun(ctx, s.St.Pool, id)
}

func (s *Server) adminCancelTask(c *gin.Context, _ *store.User) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	regularTask, err := store.GetTask(c.Request.Context(), s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if regularTask == nil {
		run, assistantErr := s.adminCancelAssistantRun(c.Request.Context(), taskID)
		if assistantErr != nil {
			fail(c, assistantErr)
			return
		}
		ok(c, adminAssistantRunDict(run))
		return
	}
	task, err := taskflow.AdminCancelTask(c.Request.Context(), s.St, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	streamEvent := taskstream.Event{TaskID: task.ID.String(), Stage: "canceled", Status: "canceled", Done: true}
	streamClient := s.assistantStreamRedis()
	taskstream.Publish(c.Request.Context(), streamClient, task.ID.String(), streamEvent)
	taskstream.PublishUser(c.Request.Context(), streamClient, task.UserID.String(), streamEvent)
	ok(c, adminTaskDict(task, nil))
}

func (s *Server) adminForceFailTask(c *gin.Context, _ *store.User) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	regularTask, err := store.GetTask(c.Request.Context(), s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if regularTask == nil {
		run, assistantErr := s.adminForceFailAssistantRun(c.Request.Context(), taskID)
		if assistantErr != nil {
			fail(c, assistantErr)
			return
		}
		ok(c, adminAssistantRunDict(run))
		return
	}
	task, err := taskflow.ForceFailTask(c.Request.Context(), s.St, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	streamEvent := taskstream.Event{TaskID: task.ID.String(), Stage: "failed", Status: "failed", Done: true}
	streamClient := s.assistantStreamRedis()
	taskstream.Publish(c.Request.Context(), streamClient, task.ID.String(), streamEvent)
	taskstream.PublishUser(c.Request.Context(), streamClient, task.UserID.String(), streamEvent)
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
