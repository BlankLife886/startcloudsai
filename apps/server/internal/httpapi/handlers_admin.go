package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

// ---------- stats ----------

func (s *Server) adminStats(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	now := time.Now().UTC()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	weekAgo := now.AddDate(0, 0, -7)
	monthAgo := now.AddDate(0, 0, -30)

	totalUsers, err := store.CountUsers(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	newUsersToday, err := store.CountUsersSince(ctx, s.St.Pool, todayStart)
	if err != nil {
		fail(c, err)
		return
	}
	runningTasks, err := store.CountTasksInStatuses(ctx, s.St.Pool, []string{"queued", "running"})
	if err != nil {
		fail(c, err)
		return
	}
	byDay, err := store.TaskDailySince(ctx, s.St.Pool, weekAgo)
	if err != nil {
		fail(c, err)
		return
	}
	taskDaily := make([]gin.H, 0, 7)
	for offset := 6; offset >= 0; offset-- {
		day := now.AddDate(0, 0, -offset).Format("2006-01-02")
		row := byDay[day]
		taskDaily = append(taskDaily, gin.H{"date": day, "total": row.Total, "succeeded": row.Succeeded})
	}
	revenue, err := store.RevenueSince(ctx, s.St.Pool, monthAgo)
	if err != nil {
		fail(c, err)
		return
	}
	balanceTotal, err := store.SumWalletBalance(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	byType, err := store.TaskTypeCountsSince(ctx, s.St.Pool, monthAgo)
	if err != nil {
		fail(c, err)
		return
	}
	typeDistribution := gin.H{}
	for _, t := range store.TaskTypes {
		typeDistribution[t] = byType[t]
	}
	ok(c, gin.H{
		"totalUsers":         totalUsers,
		"newUsersToday":      newUsersToday,
		"runningTasks":       runningTasks,
		"taskDaily":          taskDaily,
		"revenueCents":       revenue,
		"walletBalanceCents": balanceTotal,
		"typeDistribution":   typeDistribution,
	})
}

// ---------- users ----------

func (s *Server) adminListUsers(c *gin.Context, _ *store.User) {
	status := c.Query("status")
	if status != "" && status != "active" && status != "banned" {
		fail(c, apperr.E("validation_error", "无效的用户状态", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := store.ListUsers(ctx, s.St.Pool, strings.TrimSpace(c.Query("search")), status, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, u := range rows {
		ids = append(ids, u.ID)
	}
	wallets, err := store.GetWalletsByUserIDs(ctx, s.St.Pool, ids)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(u *store.User) gin.H {
		return adminUserDict(u, wallets[u.ID])
	}))
}

type adminUserPatchIn struct {
	Status Opt[string] `json:"status"`
}

func (s *Server) adminPatchUser(c *gin.Context, _ *store.User) {
	userID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body adminUserPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Status.Valid && body.Status.Value != "active" && body.Status.Value != "banned" {
		fail(c, apperr.E("validation_error", "status: 无效的用户状态", 422))
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
	if user.Role != "user" {
		fail(c, apperr.E("not_found", "用户不存在", 404))
		return
	}
	if err := store.UpdateUserStatus(ctx, s.St.Pool, userID, body.Status.Ptr()); err != nil {
		fail(c, err)
		return
	}
	if body.Status.Valid {
		user.Status = body.Status.Value
	}
	ok(c, adminUserDict(user, nil))
}

type walletAdjustIn struct {
	DeltaCents     *int64  `json:"deltaCents"`
	Reason         string  `json:"reason"`
	IdempotencyKey *string `json:"idempotencyKey"` // 可选：缺省随机（保持兼容）
}

func (s *Server) adminWalletAdjust(c *gin.Context, _ *store.User) {
	userID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body walletAdjustIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.DeltaCents == nil {
		fail(c, apperr.E("validation_error", "deltaCents: 必填", 422))
		return
	}
	if body.Reason == "" || len([]rune(body.Reason)) > 500 {
		fail(c, apperr.E("validation_error", "reason: 长度须在 1-500 之间", 422))
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
	if *body.DeltaCents == 0 {
		fail(c, apperr.E("validation_error", "调整金额不能为 0", 422))
		return
	}
	sourceID := uuid.NewString()
	if body.IdempotencyKey != nil && *body.IdempotencyKey != "" {
		if len([]rune(*body.IdempotencyKey)) > 128 {
			fail(c, apperr.E("validation_error", "idempotencyKey: 长度不能超过 128", 422))
			return
		}
		sourceID = *body.IdempotencyKey
	}
	var entry *store.LedgerEntry
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		var aerr error
		entry, aerr = wallet.AdminAdjust(ctx, tx, userID, *body.DeltaCents, sourceID, body.Reason)
		return aerr
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, ledgerDict(entry))
}

// ---------- orders ----------

// matchUserIDsOrImpossible search 无匹配时返回不可能命中的全零 uuid。
func (s *Server) matchUserIDsOrImpossible(c *gin.Context, keyword string) ([]uuid.UUID, error) {
	matched, err := store.MatchUserIDs(c.Request.Context(), s.St.Pool, strings.TrimSpace(keyword))
	if err != nil {
		return nil, err
	}
	if len(matched) == 0 {
		return []uuid.UUID{uuid.Nil}, nil
	}
	return matched, nil
}

func (s *Server) adminListOrders(c *gin.Context, _ *store.User) {
	status := c.Query("status")
	if status != "" && !store.Contains(store.OrderStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的订单状态", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	var userIDs []uuid.UUID
	if search := c.Query("search"); search != "" {
		userIDs, err = s.matchUserIDsOrImpossible(c, search)
		if err != nil {
			fail(c, err)
			return
		}
	}
	ctx := c.Request.Context()
	rows, err := store.ListOrders(ctx, s.St.Pool, nil, status, userIDs, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	uniqueUsers := map[uuid.UUID]bool{}
	uniquePlans := map[uuid.UUID]bool{}
	var uids, pids []uuid.UUID
	for _, o := range rows {
		if !uniqueUsers[o.UserID] {
			uniqueUsers[o.UserID] = true
			uids = append(uids, o.UserID)
		}
		if !uniquePlans[o.PlanID] {
			uniquePlans[o.PlanID] = true
			pids = append(pids, o.PlanID)
		}
	}
	users, err := store.GetUsersByIDs(ctx, s.St.Pool, uids)
	if err != nil {
		fail(c, err)
		return
	}
	plans, err := store.GetPlansByIDs(ctx, s.St.Pool, pids)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(o *store.Order) gin.H {
		user := users[o.UserID]
		plan := plans[o.PlanID]
		d := adminOrderDict(o, user)
		if user != nil {
			d["userEmail"] = user.Email
		} else {
			d["userEmail"] = nil
		}
		if plan != nil {
			d["planName"] = plan.Name
		} else {
			d["planName"] = nil
		}
		return d
	}))
}

func (s *Server) adminCompleteOrder(c *gin.Context, _ *store.User) {
	orderID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
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
	ok(c, adminOrderDict(order, nil))
}

// ---------- plans ----------

func (s *Server) adminListPlans(c *gin.Context, _ *store.User) {
	plans, err := store.ListPlans(c.Request.Context(), s.St.Pool, false)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(plans))
	for _, p := range plans {
		items = append(items, planDict(p, true))
	}
	ok(c, gin.H{"items": items})
}

type planIn struct {
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	Kind            *string  `json:"kind"`
	PriceCents      *int64   `json:"priceCents"`
	GrantCents      *int64   `json:"grantCents"`
	BonusCents      *int64   `json:"bonusCents"`
	DurationDays    *int     `json:"durationDays"`
	DailyGrantCents *int64   `json:"dailyGrantCents"`
	Features        []string `json:"features"`
	Active          *bool    `json:"active"`
	Sort            *int     `json:"sort"`
}

// validatePlanKind kind=subscription 时 durationDays 与 dailyGrantCents 必须为正。
func validatePlanKind(kind string, durationDays int, dailyGrantCents int64) error {
	if kind != "topup" && kind != "subscription" {
		return apperr.E("validation_error", "kind: 须为 topup/subscription", 422)
	}
	if kind == "subscription" {
		if durationDays <= 0 {
			return apperr.E("validation_error", "durationDays: 订阅套餐须为正整数", 422)
		}
		if dailyGrantCents <= 0 {
			return apperr.E("validation_error", "dailyGrantCents: 订阅套餐须为正整数", 422)
		}
	}
	return nil
}

func (s *Server) adminCreatePlan(c *gin.Context, _ *store.User) {
	var body planIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Code == "" || len([]rune(body.Code)) > 64 {
		fail(c, apperr.E("validation_error", "code: 长度须在 1-64 之间", 422))
		return
	}
	if body.Name == "" || len([]rune(body.Name)) > 128 {
		fail(c, apperr.E("validation_error", "name: 长度须在 1-128 之间", 422))
		return
	}
	if body.PriceCents == nil || *body.PriceCents < 0 {
		fail(c, apperr.E("validation_error", "priceCents: 须为非负整数", 422))
		return
	}
	if body.GrantCents == nil || *body.GrantCents < 0 {
		fail(c, apperr.E("validation_error", "grantCents: 须为非负整数", 422))
		return
	}
	bonus := int64(0)
	if body.BonusCents != nil {
		if *body.BonusCents < 0 {
			fail(c, apperr.E("validation_error", "bonusCents: 须为非负整数", 422))
			return
		}
		bonus = *body.BonusCents
	}
	kind := "topup"
	if body.Kind != nil {
		kind = *body.Kind
	}
	durationDays := 0
	if body.DurationDays != nil {
		if *body.DurationDays < 0 {
			fail(c, apperr.E("validation_error", "durationDays: 须为非负整数", 422))
			return
		}
		durationDays = *body.DurationDays
	}
	dailyGrant := int64(0)
	if body.DailyGrantCents != nil {
		if *body.DailyGrantCents < 0 {
			fail(c, apperr.E("validation_error", "dailyGrantCents: 须为非负整数", 422))
			return
		}
		dailyGrant = *body.DailyGrantCents
	}
	if err := validatePlanKind(kind, durationDays, dailyGrant); err != nil {
		fail(c, err)
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	sortVal := 0
	if body.Sort != nil {
		sortVal = *body.Sort
	}
	ctx := c.Request.Context()
	existing, err := store.GetPlanByCode(ctx, s.St.Pool, body.Code)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("validation_error", "套餐 code 已存在", 409))
		return
	}
	plan, err := store.InsertPlan(ctx, s.St.Pool, &store.Plan{
		Code:            body.Code,
		Name:            body.Name,
		Kind:            kind,
		PriceCents:      *body.PriceCents,
		GrantCents:      *body.GrantCents,
		BonusCents:      bonus,
		DurationDays:    durationDays,
		DailyGrantCents: dailyGrant,
		Features:        body.Features,
		Active:          active,
		Sort:            sortVal,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("validation_error", "套餐 code 已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	ok(c, planDict(plan, true))
}

type planPatchIn struct {
	Code            Opt[string]   `json:"code"`
	Name            Opt[string]   `json:"name"`
	Kind            Opt[string]   `json:"kind"`
	PriceCents      Opt[int64]    `json:"priceCents"`
	GrantCents      Opt[int64]    `json:"grantCents"`
	BonusCents      Opt[int64]    `json:"bonusCents"`
	DurationDays    Opt[int]      `json:"durationDays"`
	DailyGrantCents Opt[int64]    `json:"dailyGrantCents"`
	Features        Opt[[]string] `json:"features"`
	Active          Opt[bool]     `json:"active"`
	Sort            Opt[int]      `json:"sort"`
}

func (s *Server) adminPatchPlan(c *gin.Context, _ *store.User) {
	planID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body planPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Code.Valid && (body.Code.Value == "" || len([]rune(body.Code.Value)) > 64) {
		fail(c, apperr.E("validation_error", "code: 长度须在 1-64 之间", 422))
		return
	}
	if body.Name.Valid && (body.Name.Value == "" || len([]rune(body.Name.Value)) > 128) {
		fail(c, apperr.E("validation_error", "name: 长度须在 1-128 之间", 422))
		return
	}
	for name, v := range map[string]Opt[int64]{"priceCents": body.PriceCents, "grantCents": body.GrantCents, "bonusCents": body.BonusCents, "dailyGrantCents": body.DailyGrantCents} {
		if v.Valid && v.Value < 0 {
			fail(c, apperr.E("validation_error", name+": 须为非负整数", 422))
			return
		}
	}
	if body.DurationDays.Valid && body.DurationDays.Value < 0 {
		fail(c, apperr.E("validation_error", "durationDays: 须为非负整数", 422))
		return
	}
	ctx := c.Request.Context()
	plan, err := store.GetPlan(ctx, s.St.Pool, planID)
	if err != nil {
		fail(c, err)
		return
	}
	if plan == nil {
		fail(c, apperr.E("plan_not_found", "套餐不存在", 404))
		return
	}
	if body.Code.Valid && body.Code.Value != plan.Code {
		existing, gerr := store.GetPlanByCode(ctx, s.St.Pool, body.Code.Value)
		if gerr != nil {
			fail(c, gerr)
			return
		}
		if existing != nil {
			fail(c, apperr.E("validation_error", "套餐 code 已存在", 409))
			return
		}
	}
	if body.Code.Valid {
		plan.Code = body.Code.Value
	}
	if body.Name.Valid {
		plan.Name = body.Name.Value
	}
	if body.Kind.Valid {
		plan.Kind = body.Kind.Value
	}
	if body.PriceCents.Valid {
		plan.PriceCents = body.PriceCents.Value
	}
	if body.GrantCents.Valid {
		plan.GrantCents = body.GrantCents.Value
	}
	if body.BonusCents.Valid {
		plan.BonusCents = body.BonusCents.Value
	}
	if body.DurationDays.Valid {
		plan.DurationDays = body.DurationDays.Value
	}
	if body.DailyGrantCents.Valid {
		plan.DailyGrantCents = body.DailyGrantCents.Value
	}
	if body.Features.Valid {
		plan.Features = body.Features.Value
	}
	if body.Active.Valid {
		plan.Active = body.Active.Value
	}
	if body.Sort.Valid {
		plan.Sort = body.Sort.Value
	}
	// patch 后按最终值整体校验 kind 组合
	if err := validatePlanKind(plan.Kind, plan.DurationDays, plan.DailyGrantCents); err != nil {
		fail(c, err)
		return
	}
	if err := store.UpdatePlan(ctx, s.St.Pool, plan); err != nil {
		fail(c, err)
		return
	}
	ok(c, planDict(plan, true))
}

func (s *Server) adminDeletePlan(c *gin.Context, _ *store.User) {
	planID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	plan, err := store.GetPlan(ctx, s.St.Pool, planID)
	if err != nil {
		fail(c, err)
		return
	}
	if plan == nil {
		fail(c, apperr.E("plan_not_found", "套餐不存在", 404))
		return
	}
	// 有历史订单外键引用，下架而非物理删除
	plan.Active = false
	if err := store.UpdatePlan(ctx, s.St.Pool, plan); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}

// ---------- tasks ----------

func (s *Server) adminListTasks(c *gin.Context, _ *store.User) {
	taskType := c.Query("type")
	status := c.Query("status")
	if taskType != "" && !store.Contains(store.TaskTypes, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	if status != "" && !store.Contains(store.TaskStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的任务状态", 422))
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
	rows, err := store.ListTasks(ctx, s.St.Pool, nil, taskType, status, userIDs, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	unique := map[uuid.UUID]bool{}
	var uids []uuid.UUID
	for _, t := range rows {
		if !unique[t.UserID] {
			unique[t.UserID] = true
			uids = append(uids, t.UserID)
		}
	}
	users, err := store.GetUsersByIDs(ctx, s.St.Pool, uids)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(t *store.Task) gin.H {
		user := users[t.UserID]
		d := adminTaskDict(t, user)
		if user != nil {
			d["userEmail"] = user.Email
		} else {
			d["userEmail"] = nil
		}
		return d
	}))
}

func (s *Server) adminRequeueTask(c *gin.Context, _ *store.User) {
	taskID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	task, err := taskflow.RequeueTask(c.Request.Context(), s.St, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if err := s.Queue.EnqueueRunTaskRecovery(c.Request.Context(), task.ID.String()); err != nil {
		// C1 补偿：重跑入队失败 → queued→failed + 解冻，返回 500 让管理员重试
		log.Printf("task %s requeue enqueue failed, compensating: %v", task.ID, err)
		if _, cerr := taskflow.FailQueuedEnqueue(c.Request.Context(), s.St, task.ID); cerr != nil {
			log.Printf("task %s requeue compensation failed (queued reaper will pick up): %v", task.ID, cerr)
		}
		fail(c, apperr.E("enqueue_failed", "任务入队失败，费用已退回，请重试", 500))
		return
	}
	ok(c, adminTaskDict(task, nil))
}

// ---------- gallery ----------

func (s *Server) adminSubmissions(c *gin.Context, _ *store.User) {
	status := c.Query("status")
	if status != "" && !store.Contains(store.SubmissionStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的投稿状态", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := store.ListSubmissions(ctx, s.St.Pool, store.SubmissionFilter{Status: status}, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	unique := map[uuid.UUID]bool{}
	var uids []uuid.UUID
	for _, sub := range rows {
		if !unique[sub.UserID] {
			unique[sub.UserID] = true
			uids = append(uids, sub.UserID)
		}
	}
	users, err := store.GetUsersByIDs(ctx, s.St.Pool, uids)
	if err != nil {
		fail(c, err)
		return
	}
	categories, err := s.categoriesFor(ctx, rows)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(sub *store.GallerySubmission) gin.H {
		d := submissionDict(sub, s.mediaURLsFor(c, sub.MediaKeys))
		d["coverUrl"] = s.presignSafe(c, sub.CoverKey)
		d["category"] = nil
		if sub.CategoryID != nil {
			if category := categories[*sub.CategoryID]; category != nil {
				d["category"] = gin.H{"id": category.ID.String(), "name": category.Name}
			}
		}
		if author := users[sub.UserID]; author != nil {
			d["user"] = gin.H{"id": author.ID.String(), "email": author.Email, "username": author.Username}
			d["author"] = gin.H{"id": author.ID.String(), "username": author.Username}
			d["userEmail"] = author.Email
		} else {
			d["user"] = nil
			d["author"] = nil
			d["userEmail"] = nil
		}
		return d
	}))
}

type galleryReviewIn struct {
	Action string  `json:"action"`
	Reason *string `json:"reason"`
}

func (s *Server) adminReviewSubmission(c *gin.Context, admin *store.User) {
	submissionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body galleryReviewIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	statusMap := map[string]string{"approve": "approved", "reject": "rejected", "remove": "removed"}
	newStatus, valid := statusMap[body.Action]
	if !valid {
		fail(c, apperr.E("validation_error", "action: 须为 approve/reject/remove", 422))
		return
	}
	if body.Reason != nil && len([]rune(*body.Reason)) > 500 {
		fail(c, apperr.E("validation_error", "reason: 长度不能超过 500", 422))
		return
	}
	ctx := c.Request.Context()
	submission, err := store.GetSubmission(ctx, s.St.Pool, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	if submission == nil {
		fail(c, apperr.E("not_found", "投稿不存在", 404))
		return
	}
	var rejectReason *string
	if body.Action == "reject" || body.Action == "remove" {
		rejectReason = body.Reason
	}
	now := time.Now().UTC()
	title := ""
	if submission.Title != nil {
		title = *submission.Title
	}
	notifyBody := fmt.Sprintf("你的投稿「%s」审核结果：%s。", title, newStatus)
	if body.Reason != nil && *body.Reason != "" {
		notifyBody += fmt.Sprintf(" 原因：%s", *body.Reason)
	}
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if terr := store.ReviewSubmission(ctx, tx, submission.ID, newStatus, rejectReason, admin.ID, now); terr != nil {
			return terr
		}
		return store.InsertNotification(ctx, tx, &submission.UserID, "system", "投稿审核结果", &notifyBody)
	})
	if err != nil {
		fail(c, err)
		return
	}
	submission.Status = newStatus
	submission.RejectReason = rejectReason
	submission.ReviewedBy = &admin.ID
	submission.ReviewedAt = &now
	ok(c, submissionDict(submission, nil))
}

// ---------- announcements ----------

func (s *Server) adminAnnouncements(c *gin.Context, _ *store.User) {
	rows, err := store.ListAnnouncements(c.Request.Context(), s.St.Pool, nil)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, a := range rows {
		items = append(items, announcementDict(a))
	}
	ok(c, gin.H{"items": items})
}

// parseDatetime 接受 RFC3339 或无时区的 ISO8601（按 UTC）。
func parseDatetime(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, nil
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("invalid datetime %q", s)
}

type announcementIn struct {
	Title    string  `json:"title"`
	Body     *string `json:"body"`
	Active   *bool   `json:"active"`
	StartsAt *string `json:"startsAt"`
	EndsAt   *string `json:"endsAt"`
}

func parseOptDatetime(s *string, field string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := parseDatetime(*s)
	if err != nil {
		return nil, apperr.E("validation_error", field+": 无效的时间格式", 422)
	}
	return &t, nil
}

func (s *Server) adminCreateAnnouncement(c *gin.Context, _ *store.User) {
	var body announcementIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Title == "" || len([]rune(body.Title)) > 200 {
		fail(c, apperr.E("validation_error", "title: 长度须在 1-200 之间", 422))
		return
	}
	startsAt, err := parseOptDatetime(body.StartsAt, "startsAt")
	if err != nil {
		fail(c, err)
		return
	}
	endsAt, err := parseOptDatetime(body.EndsAt, "endsAt")
	if err != nil {
		fail(c, err)
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	ctx := c.Request.Context()
	var announcement *store.Announcement
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		var ierr error
		announcement, ierr = store.InsertAnnouncement(ctx, tx, body.Title, body.Body, active, startsAt, endsAt)
		if ierr != nil {
			return ierr
		}
		// 同步生成一条全站通知（user_id NULL），进入用户通知合并流
		return store.InsertNotification(ctx, tx, nil, "announcement", body.Title, body.Body)
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, announcementDict(announcement))
}

type announcementPatchIn struct {
	Title    Opt[string] `json:"title"`
	Body     Opt[string] `json:"body"`
	Active   Opt[bool]   `json:"active"`
	StartsAt Opt[string] `json:"startsAt"`
	EndsAt   Opt[string] `json:"endsAt"`
}

func (s *Server) adminPatchAnnouncement(c *gin.Context, _ *store.User) {
	announcementID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body announcementPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Title.Valid && (body.Title.Value == "" || len([]rune(body.Title.Value)) > 200) {
		fail(c, apperr.E("validation_error", "title: 长度须在 1-200 之间", 422))
		return
	}
	ctx := c.Request.Context()
	announcement, err := store.GetAnnouncement(ctx, s.St.Pool, announcementID)
	if err != nil {
		fail(c, err)
		return
	}
	if announcement == nil {
		fail(c, apperr.E("not_found", "公告不存在", 404))
		return
	}
	if body.Title.Valid {
		announcement.Title = body.Title.Value
	}
	if body.Body.Set {
		announcement.Body = body.Body.Ptr()
	}
	if body.Active.Valid {
		announcement.Active = body.Active.Value
	}
	if body.StartsAt.Set {
		t, perr := parseOptDatetime(body.StartsAt.Ptr(), "startsAt")
		if perr != nil {
			fail(c, perr)
			return
		}
		announcement.StartsAt = t
	}
	if body.EndsAt.Set {
		t, perr := parseOptDatetime(body.EndsAt.Ptr(), "endsAt")
		if perr != nil {
			fail(c, perr)
			return
		}
		announcement.EndsAt = t
	}
	if err := store.UpdateAnnouncement(ctx, s.St.Pool, announcement); err != nil {
		fail(c, err)
		return
	}
	ok(c, announcementDict(announcement))
}

func (s *Server) adminDeleteAnnouncement(c *gin.Context, _ *store.User) {
	announcementID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	announcement, err := store.GetAnnouncement(ctx, s.St.Pool, announcementID)
	if err != nil {
		fail(c, err)
		return
	}
	if announcement == nil {
		fail(c, apperr.E("not_found", "公告不存在", 404))
		return
	}
	if err := store.DeleteAnnouncement(ctx, s.St.Pool, announcementID); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}

// ---------- changelog ----------

func (s *Server) adminChangelog(c *gin.Context, _ *store.User) {
	rows, err := store.ListChangelog(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, entry := range rows {
		items = append(items, changelogDict(entry))
	}
	ok(c, gin.H{"items": items})
}

type changelogIn struct {
	Version   string   `json:"version"`
	Date      string   `json:"date"`
	Tag       string   `json:"tag"`
	Title     string   `json:"title"`
	Summary   *string  `json:"summary"`
	Items     []string `json:"items"`
	Highlight *bool    `json:"highlight"`
	Sort      *int     `json:"sort"`
}

func validateChangelogIn(version, date, tag, title string) (time.Time, error) {
	if version == "" || len([]rune(version)) > 32 {
		return time.Time{}, apperr.E("validation_error", "version: 长度须在 1-32 之间", 422)
	}
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Time{}, apperr.E("validation_error", "date: 须为 YYYY-MM-DD", 422)
	}
	if tag != "feature" && tag != "experience" {
		return time.Time{}, apperr.E("validation_error", "tag: 须为 feature/experience", 422)
	}
	if title == "" || len([]rune(title)) > 200 {
		return time.Time{}, apperr.E("validation_error", "title: 长度须在 1-200 之间", 422)
	}
	return d, nil
}

func (s *Server) adminCreateChangelog(c *gin.Context, _ *store.User) {
	var body changelogIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	date, err := validateChangelogIn(body.Version, body.Date, body.Tag, body.Title)
	if err != nil {
		fail(c, err)
		return
	}
	highlight := false
	if body.Highlight != nil {
		highlight = *body.Highlight
	}
	sortVal := 0
	if body.Sort != nil {
		sortVal = *body.Sort
	}
	entry, err := store.InsertChangelog(c.Request.Context(), s.St.Pool, &store.ChangelogEntry{
		Version:   body.Version,
		Date:      date,
		Tag:       body.Tag,
		Title:     body.Title,
		Summary:   body.Summary,
		Items:     body.Items,
		Highlight: highlight,
		Sort:      sortVal,
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, changelogDict(entry))
}

type changelogPatchIn struct {
	Version   Opt[string]   `json:"version"`
	Date      Opt[string]   `json:"date"`
	Tag       Opt[string]   `json:"tag"`
	Title     Opt[string]   `json:"title"`
	Summary   Opt[string]   `json:"summary"`
	Items     Opt[[]string] `json:"items"`
	Highlight Opt[bool]     `json:"highlight"`
	Sort      Opt[int]      `json:"sort"`
}

func (s *Server) adminPatchChangelog(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body changelogPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Version.Valid && (body.Version.Value == "" || len([]rune(body.Version.Value)) > 32) {
		fail(c, apperr.E("validation_error", "version: 长度须在 1-32 之间", 422))
		return
	}
	if body.Tag.Valid && body.Tag.Value != "feature" && body.Tag.Value != "experience" {
		fail(c, apperr.E("validation_error", "tag: 须为 feature/experience", 422))
		return
	}
	if body.Title.Valid && (body.Title.Value == "" || len([]rune(body.Title.Value)) > 200) {
		fail(c, apperr.E("validation_error", "title: 长度须在 1-200 之间", 422))
		return
	}
	ctx := c.Request.Context()
	entry, err := store.GetChangelog(ctx, s.St.Pool, entryID)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil {
		fail(c, apperr.E("not_found", "更新说明不存在", 404))
		return
	}
	if body.Version.Valid {
		entry.Version = body.Version.Value
	}
	if body.Date.Valid {
		d, derr := time.Parse("2006-01-02", body.Date.Value)
		if derr != nil {
			fail(c, apperr.E("validation_error", "date: 须为 YYYY-MM-DD", 422))
			return
		}
		entry.Date = d
	}
	if body.Tag.Valid {
		entry.Tag = body.Tag.Value
	}
	if body.Title.Valid {
		entry.Title = body.Title.Value
	}
	if body.Summary.Set {
		entry.Summary = body.Summary.Ptr()
	}
	if body.Items.Valid {
		entry.Items = body.Items.Value
	}
	if body.Highlight.Valid {
		entry.Highlight = body.Highlight.Value
	}
	if body.Sort.Valid {
		entry.Sort = body.Sort.Value
	}
	if err := store.UpdateChangelog(ctx, s.St.Pool, entry); err != nil {
		fail(c, err)
		return
	}
	ok(c, changelogDict(entry))
}

func (s *Server) adminDeleteChangelog(c *gin.Context, _ *store.User) {
	entryID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	entry, err := store.GetChangelog(ctx, s.St.Pool, entryID)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil {
		fail(c, apperr.E("not_found", "更新说明不存在", 404))
		return
	}
	if err := store.DeleteChangelog(ctx, s.St.Pool, entryID); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}

// ---------- settings ----------

var settingsCamel = map[string]string{
	"task_prices":            "taskPrices",
	"user_max_running_tasks": "userMaxRunningTasks",
	"signup_bonus_cents":     "signupBonusCents",
	"registration_enabled":   "registrationEnabled",
	"task_models":            "taskModels",
	"free_daily_cents":       "freeDailyCents",
	"submission_enabled":     "submissionEnabled",
	"auto_approve":           "autoApprove",
	"daily_limit":            "dailyLimit",
	"c2a_base_url":           "c2aBaseUrl",
	"c2a_api_key":            "c2aApiKey",
	"c2a_timeout_secs":       "c2aTimeoutSecs",
	"sub2api_base_url":       "sub2apiBaseUrl",
	"sub2api_api_key":        "sub2apiApiKey",
	"sub2api_chat_model":     "sub2apiChatModel",
	"sub2api_image_model":    "sub2apiImageModel",
	"sub2api_timeout_secs":   "sub2apiTimeoutSecs",
}

// maskSecret 敏感值掩码：保留末 4 位，返回 "****abcd"；空值原样。
func maskSecret(v string) string {
	if v == "" {
		return ""
	}
	r := []rune(v)
	if len(r) <= 4 {
		return "****"
	}
	return "****" + string(r[len(r)-4:])
}

var settingsSnake = func() map[string]string {
	m := map[string]string{}
	for snake, camel := range settingsCamel {
		m[camel] = snake
	}
	return m
}()

func (s *Server) settingsToCamel(c *gin.Context) (gin.H, error) {
	all, err := settings.GetAll(c.Request.Context(), s.St.Pool)
	if err != nil {
		return nil, err
	}
	out := gin.H{}
	for k, v := range all {
		camel := settingsCamel[k]
		if camel == "" {
			camel = k
		}
		if k == "c2a_api_key" || k == "sub2api_api_key" {
			// Key 永不明文回传，只返回掩码（前端留空或提交掩码 = 不修改）
			var stored string
			_ = json.Unmarshal(v, &stored)
			plain, derr := settings.DecryptSecret(stored, s.Cfg.AppSecret)
			if derr != nil {
				return nil, derr
			}
			masked, _ := json.Marshal(maskSecret(plain))
			out[camel] = json.RawMessage(masked)
			continue
		}
		out[camel] = v
	}
	return out, nil
}

func (s *Server) adminGetSettings(c *gin.Context, _ *store.User) {
	out, err := s.settingsToCamel(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (s *Server) adminPutSettings(c *gin.Context, _ *store.User) {
	var body map[string]json.RawMessage
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	// extra="forbid"：未知字段直接 422
	for key := range body {
		if _, known := settingsSnake[key]; !known {
			fail(c, apperr.E("validation_error", key+": 未知字段", 422))
			return
		}
	}
	updates := map[string]json.RawMessage{}
	for camel, raw := range body {
		if string(raw) == "null" {
			continue // exclude_none
		}
		snake := settingsSnake[camel]
		switch snake {
		case "task_prices":
			var prices map[string]int64
			if err := json.Unmarshal(raw, &prices); err != nil {
				fail(c, apperr.E("validation_error", "taskPrices: 格式不正确", 422))
				return
			}
			var invalid []string
			for t, v := range prices {
				if !store.Contains(store.TaskTypes, t) {
					invalid = append(invalid, t)
				}
				if v < 0 {
					fail(c, apperr.E("validation_error", "任务单价不能为负", 422))
					return
				}
			}
			if len(invalid) > 0 {
				sort.Strings(invalid)
				fail(c, apperr.E("validation_error", "未知任务类型："+strings.Join(invalid, ", "), 422))
				return
			}
		case "user_max_running_tasks":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 100 {
				fail(c, apperr.E("validation_error", "userMaxRunningTasks: 须在 1-100 之间", 422))
				return
			}
		case "signup_bonus_cents", "free_daily_cents", "daily_limit":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 {
				fail(c, apperr.E("validation_error", camel+": 须为非负整数", 422))
				return
			}
		case "registration_enabled", "submission_enabled", "auto_approve":
			var v bool
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 须为布尔值", 422))
				return
			}
		case "task_models":
			var v map[string]string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", "taskModels: 格式不正确", 422))
				return
			}
		case "c2a_base_url", "sub2api_base_url":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			v = strings.TrimRight(strings.TrimSpace(v), "/")
			if v != "" && netguard.ValidateURL(v, s.Cfg.AppEnv == "development", false) != nil {
				fail(c, apperr.E("validation_error", camel+": 地址无效或指向受限网络", 422))
				return
			}
			normalized, _ := json.Marshal(v)
			raw = normalized
		case "c2a_api_key", "sub2api_api_key":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			// 掩码值 = 前端原样回传未修改的 Key，跳过更新
			if strings.HasPrefix(v, "****") {
				continue
			}
			encrypted, eerr := settings.EncryptSecret(v, s.Cfg.AppSecret)
			if eerr != nil {
				fail(c, eerr)
				return
			}
			raw, _ = json.Marshal(encrypted)
		case "c2a_timeout_secs", "sub2api_timeout_secs":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 || v > 600 {
				fail(c, apperr.E("validation_error", camel+": 须在 0-600 之间（0 = 使用默认）", 422))
				return
			}
		case "sub2api_chat_model", "sub2api_image_model":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			v = strings.TrimSpace(v)
			if len([]rune(v)) > 120 {
				fail(c, apperr.E("validation_error", camel+": 长度不能超过 120", 422))
				return
			}
			raw, _ = json.Marshal(v)
		}
		updates[snake] = raw
	}
	ctx := c.Request.Context()
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		for key, value := range updates {
			if terr := settings.Set(ctx, tx, key, value); terr != nil {
				return terr
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	out, err := s.settingsToCamel(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (s *Server) adminTestC2A(c *gin.Context, _ *store.User) {
	// 可选 body：用表单中尚未保存的值测试；缺省用「后台设置 → 环境变量」的生效配置
	var override struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
	}
	_ = c.ShouldBindJSON(&override)

	ctx := c.Request.Context()
	resolved, rerr := settings.ResolveC2A(ctx, s.St.Pool, s.Cfg.C2ABaseURL, s.Cfg.C2AAPIKey, s.Cfg.C2ATimeoutSecs, s.Cfg.AppSecret)
	if rerr != nil {
		fail(c, rerr)
		return
	}
	if v := strings.TrimRight(strings.TrimSpace(override.BaseURL), "/"); v != "" {
		if netguard.ValidateURL(v, s.Cfg.AppEnv == "development", false) != nil {
			fail(c, apperr.E("validation_error", "baseUrl: 地址无效或指向受限网络", 422))
			return
		}
		resolved.BaseURL = v
	}
	if v := strings.TrimSpace(override.APIKey); v != "" && !strings.HasPrefix(v, "****") {
		resolved.APIKey = v
	}
	client := c2a.NewWithPolicy(resolved.BaseURL, resolved.APIKey, resolved.TimeoutSecs, s.Cfg.AppEnv == "development")
	result, err := client.ListModels(ctx)
	if err != nil {
		msg := err.Error()
		r := []rune(msg)
		if len(r) > 500 {
			msg = string(r[:500])
		}
		if msg == "" {
			msg = "chatgpt2api 连接失败"
		}
		var netErr *c2a.NetworkError
		var upErr *c2a.UpstreamError
		if errors.As(err, &netErr) || errors.As(err, &upErr) {
			fail(c, apperr.E("c2a_test_failed", msg, 502))
			return
		}
		fail(c, err)
		return
	}
	var models []string
	if data, isList := result["data"].([]any); isList {
		for _, item := range data {
			if m, isMap := item.(map[string]any); isMap {
				if id, isStr := m["id"].(string); isStr {
					models = append(models, id)
				} else {
					models = append(models, "")
				}
			}
		}
	}
	top := models
	if len(top) > 20 {
		top = top[:20]
	}
	if top == nil {
		top = []string{}
	}
	ok(c, gin.H{"ok": true, "modelCount": len(models), "models": top})
}

func (s *Server) adminTestSub2API(c *gin.Context, _ *store.User) {
	var override struct {
		BaseURL    string `json:"baseUrl"`
		APIKey     string `json:"apiKey"`
		ChatModel  string `json:"chatModel"`
		ImageModel string `json:"imageModel"`
	}
	_ = c.ShouldBindJSON(&override)

	ctx := c.Request.Context()
	resolved, err := settings.ResolveSub2API(ctx, s.St.Pool, settings.Sub2APIConfig{
		BaseURL: s.Cfg.Sub2APIBaseURL, APIKey: s.Cfg.Sub2APIAPIKey,
		ChatModel: s.Cfg.Sub2APIChatModel, ImageModel: s.Cfg.Sub2APIImageModel,
		TimeoutSecs: s.Cfg.Sub2APITimeoutSecs,
	}, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	if value := strings.TrimRight(strings.TrimSpace(override.BaseURL), "/"); value != "" {
		if netguard.ValidateURL(value, s.Cfg.AppEnv == "development", false) != nil {
			fail(c, apperr.E("validation_error", "baseUrl: 地址无效或指向受限网络", 422))
			return
		}
		resolved.BaseURL = value
	}
	if value := strings.TrimSpace(override.APIKey); value != "" && !strings.HasPrefix(value, "****") {
		resolved.APIKey = value
	}
	if value := strings.TrimSpace(override.ChatModel); value != "" {
		resolved.ChatModel = value
	}
	if value := strings.TrimSpace(override.ImageModel); value != "" {
		resolved.ImageModel = value
	}
	client, err := sub2api.New(resolved.BaseURL, resolved.APIKey, resolved.ChatModel, resolved.ImageModel, resolved.TimeoutSecs)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	models, err := client.ListModels(ctx)
	if err != nil {
		message := err.Error()
		if runes := []rune(message); len(runes) > 500 {
			message = string(runes[:500])
		}
		fail(c, apperr.E("sub2api_test_failed", message, 502))
		return
	}
	top := models
	if len(top) > 20 {
		top = top[:20]
	}
	ok(c, gin.H{"ok": true, "modelCount": len(models), "models": top})
}
