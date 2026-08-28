package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

// ---------- stats ----------

var dashboardDayLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func dashboardPeriodStarts(now time.Time) (today, last7Days, last30Days time.Time) {
	businessNow := now.In(dashboardDayLocation)
	businessToday := time.Date(
		businessNow.Year(), businessNow.Month(), businessNow.Day(), 0, 0, 0, 0, dashboardDayLocation,
	)
	return businessToday.UTC(), businessToday.AddDate(0, 0, -6).UTC(), businessToday.AddDate(0, 0, -29).UTC()
}

func (s *Server) adminStats(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	now := time.Now().UTC()
	todayStart, last7DaysStart, last30DaysStart := dashboardPeriodStarts(now)
	weekAgo := now.AddDate(0, 0, -7)
	monthAgo := now.AddDate(0, 0, -30)
	dayAgo := now.Add(-24 * time.Hour)

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
	performance, err := store.GetTaskPerformanceSummary(ctx, s.St.Pool, dayAgo)
	if err != nil {
		fail(c, err)
		return
	}
	providerPerformance, err := store.TaskProviderPerformanceSince(ctx, s.St.Pool, dayAgo)
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
		taskDaily = append(taskDaily, gin.H{
			"date": day, "total": row.Total, "succeeded": row.Succeeded, "failed": row.Failed,
		})
	}
	revenue, err := store.RevenueSince(ctx, s.St.Pool, monthAgo)
	if err != nil {
		fail(c, err)
		return
	}
	usageMetrics, err := store.GetDashboardUsageMetrics(
		ctx, s.St.Pool, todayStart, last7DaysStart, last30DaysStart,
	)
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
		"totalUsers":          totalUsers,
		"newUsersToday":       newUsersToday,
		"runningTasks":        performance.QueuedNow + performance.RunningNow,
		"taskPerformance":     performance,
		"providerPerformance": providerPerformance,
		"taskDaily":           taskDaily,
		"revenueCents":        revenue,
		"usageMetrics":        usageMetrics,
		"walletBalanceCents":  balanceTotal,
		"typeDistribution":    typeDistribution,
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
	usage, err := store.UsageSummariesByUserIDs(ctx, s.St.Pool, ids)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(u *store.User) gin.H {
		d := adminUserDict(u, wallets[u.ID])
		summary := usage[u.ID]
		d["usage"] = gin.H{
			"tasksTotal":     summary.TasksTotal,
			"tasksSucceeded": summary.TasksSucceeded,
			"tasksFailed":    summary.TasksFailed,
			"tasksRunning":   summary.TasksRunning,
			"tasksCanceled":  summary.TasksCanceled,
			"submissions":    summary.Submissions,
			"assets":         summary.Assets,
			"orders":         summary.Orders,
		}
		return d
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
	respondCreated(c, ledgerDict(entry))
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
	usageByPlan, err := store.ListPlanUsage(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(plans))
	for _, p := range plans {
		items = append(items, adminPlanDict(p, usageByPlan[p.ID]))
	}
	ok(c, gin.H{"items": items})
}

func adminPlanDict(plan *store.Plan, usage store.PlanUsage) gin.H {
	dict := planDict(plan, true)
	dict["orderCount"] = usage.OrderCount
	dict["subscriptionCount"] = usage.SubscriptionCount
	dict["deletable"] = usage.OrderCount == 0 && usage.SubscriptionCount == 0
	return dict
}

type planIn struct {
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Badge           string   `json:"badge"`
	Kind            *string  `json:"kind"`
	PriceCents      *int64   `json:"priceCents"`
	GrantCents      *int64   `json:"grantCents"`
	BonusCents      *int64   `json:"bonusCents"`
	DurationDays    *int     `json:"durationDays"`
	DailyGrantCents *int64   `json:"dailyGrantCents"`
	Features        []string `json:"features"`
	Active          *bool    `json:"active"`
	Recommended     *bool    `json:"recommended"`
	Sort            *int     `json:"sort"`
}

func cleanPlanFeatures(features []string) ([]string, error) {
	if len(features) > 12 {
		return nil, apperr.E("validation_error", "features: 最多配置 12 条权益", 422)
	}
	out := make([]string, 0, len(features))
	seen := make(map[string]struct{}, len(features))
	for _, feature := range features {
		feature = strings.TrimSpace(feature)
		if feature == "" {
			continue
		}
		if len([]rune(feature)) > 120 {
			return nil, apperr.E("validation_error", "features: 单条权益最多 120 字", 422)
		}
		if _, ok := seen[feature]; ok {
			continue
		}
		seen[feature] = struct{}{}
		out = append(out, feature)
	}
	return out, nil
}

func validPlanCode(code string) bool {
	if len(code) < 1 || len(code) > 64 {
		return false
	}
	for index, char := range code {
		valid := char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || (index > 0 && (char == '-' || char == '_'))
		if !valid {
			return false
		}
	}
	return true
}

func normalizePlan(plan *store.Plan) error {
	plan.Code = strings.ToLower(strings.TrimSpace(plan.Code))
	plan.Name = strings.TrimSpace(plan.Name)
	plan.Description = strings.TrimSpace(plan.Description)
	plan.Badge = strings.TrimSpace(plan.Badge)
	plan.Kind = strings.ToLower(strings.TrimSpace(plan.Kind))
	features, err := cleanPlanFeatures(plan.Features)
	if err != nil {
		return err
	}
	plan.Features = features
	if !validPlanCode(plan.Code) {
		return apperr.E("validation_error", "code: 仅支持小写字母、数字、短横线和下划线，长度 1-64", 422)
	}
	if plan.Name == "" || len([]rune(plan.Name)) > 128 {
		return apperr.E("validation_error", "name: 长度须在 1-128 之间", 422)
	}
	if len([]rune(plan.Description)) > 500 {
		return apperr.E("validation_error", "description: 最多 500 字", 422)
	}
	if len([]rune(plan.Badge)) > 24 {
		return apperr.E("validation_error", "badge: 最多 24 字", 422)
	}
	if plan.Kind != "topup" && plan.Kind != "subscription" {
		return apperr.E("validation_error", "kind: 须为 topup/subscription", 422)
	}
	if plan.PriceCents < 0 || plan.PriceCents > 1000000000 {
		return apperr.E("validation_error", "priceCents: 须在 0-1000000000 之间", 422)
	}
	for name, value := range map[string]int64{
		"grantCents": plan.GrantCents, "bonusCents": plan.BonusCents, "dailyGrantCents": plan.DailyGrantCents,
	} {
		if value < 0 || value > 1000000000 {
			return apperr.E("validation_error", name+": 须在 0-1000000000 之间", 422)
		}
	}
	if plan.DurationDays < 0 || plan.DurationDays > 3650 {
		return apperr.E("validation_error", "durationDays: 须在 0-3650 之间", 422)
	}
	if plan.Sort < 0 || plan.Sort > 1000000 {
		return apperr.E("validation_error", "sort: 须在 0-1000000 之间", 422)
	}
	if plan.Kind == "subscription" {
		if plan.DurationDays <= 0 {
			return apperr.E("validation_error", "durationDays: 订阅套餐须为正整数", 422)
		}
		if plan.DailyGrantCents <= 0 {
			return apperr.E("validation_error", "dailyGrantCents: 订阅套餐须为正整数", 422)
		}
	} else {
		plan.DurationDays = 0
		plan.DailyGrantCents = 0
		if plan.GrantCents+plan.BonusCents <= 0 {
			return apperr.E("validation_error", "topup 套餐的发放积分必须大于 0", 422)
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
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	sortVal := 0
	if body.Sort != nil {
		sortVal = *body.Sort
	}
	recommended := false
	if body.Recommended != nil {
		recommended = *body.Recommended
	}
	planInput := &store.Plan{
		Code:            body.Code,
		Name:            body.Name,
		Description:     body.Description,
		Badge:           body.Badge,
		Kind:            kind,
		PriceCents:      *body.PriceCents,
		GrantCents:      *body.GrantCents,
		BonusCents:      bonus,
		DurationDays:    durationDays,
		DailyGrantCents: dailyGrant,
		Features:        body.Features,
		Active:          active,
		Recommended:     recommended,
		Sort:            sortVal,
	}
	if err := normalizePlan(planInput); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	existing, err := store.GetPlanByCode(ctx, s.St.Pool, planInput.Code)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("validation_error", "套餐 code 已存在", 409))
		return
	}
	var plan *store.Plan
	if planInput.Recommended {
		err = s.St.Tx(ctx, func(tx pgx.Tx) error {
			if clearErr := store.ClearRecommendedPlans(ctx, tx, uuid.Nil); clearErr != nil {
				return clearErr
			}
			var insertErr error
			plan, insertErr = store.InsertPlan(ctx, tx, planInput)
			return insertErr
		})
	} else {
		plan, err = store.InsertPlan(ctx, s.St.Pool, planInput)
	}
	if err != nil {
		if store.IsUniqueViolation(err, "uq_plans_one_recommended") {
			fail(c, apperr.E("validation_error", "推荐套餐发生并发冲突，请重试", 409))
			return
		}
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("validation_error", "套餐 code 已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	ok(c, adminPlanDict(plan, store.PlanUsage{}))
}

type reorderPlansIn struct {
	Kind string   `json:"kind"`
	IDs  []string `json:"ids"`
}

func (s *Server) adminReorderPlans(c *gin.Context, _ *store.User) {
	var body reorderPlansIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	kind := strings.ToLower(strings.TrimSpace(body.Kind))
	if kind != "topup" && kind != "subscription" {
		fail(c, apperr.E("validation_error", "kind: 须为 topup/subscription", 422))
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 200 {
		fail(c, apperr.E("validation_error", "ids: 数量须在 1-200 之间", 422))
		return
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	for _, raw := range body.IDs {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			fail(c, apperr.E("validation_error", "ids: 包含无效 UUID", 422))
			return
		}
		ids = append(ids, id)
	}
	ctx := c.Request.Context()
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		return store.ReorderPlans(ctx, tx, kind, ids)
	}); err != nil {
		fail(c, apperr.E("plan_reorder_failed", "套餐排序保存失败，请刷新后重试", 409))
		return
	}
	ok(c, gin.H{"updated": len(ids), "kind": kind})
}

type planPatchIn struct {
	Code            Opt[string]   `json:"code"`
	Name            Opt[string]   `json:"name"`
	Description     Opt[string]   `json:"description"`
	Badge           Opt[string]   `json:"badge"`
	Kind            Opt[string]   `json:"kind"`
	PriceCents      Opt[int64]    `json:"priceCents"`
	GrantCents      Opt[int64]    `json:"grantCents"`
	BonusCents      Opt[int64]    `json:"bonusCents"`
	DurationDays    Opt[int]      `json:"durationDays"`
	DailyGrantCents Opt[int64]    `json:"dailyGrantCents"`
	Features        Opt[[]string] `json:"features"`
	Active          Opt[bool]     `json:"active"`
	Recommended     Opt[bool]     `json:"recommended"`
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
	if body.Code.Valid {
		body.Code.Value = strings.ToLower(strings.TrimSpace(body.Code.Value))
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
	if body.Description.Valid {
		plan.Description = body.Description.Value
	}
	if body.Badge.Valid {
		plan.Badge = body.Badge.Value
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
	if body.Recommended.Valid {
		plan.Recommended = body.Recommended.Value
	}
	if body.Sort.Valid {
		plan.Sort = body.Sort.Value
	}
	if err := normalizePlan(plan); err != nil {
		fail(c, err)
		return
	}
	updatePlan := func(q store.Q) error { return store.UpdatePlan(ctx, q, plan) }
	if plan.Recommended {
		err = s.St.Tx(ctx, func(tx pgx.Tx) error {
			if clearErr := store.ClearRecommendedPlans(ctx, tx, plan.ID); clearErr != nil {
				return clearErr
			}
			return updatePlan(tx)
		})
	} else {
		err = updatePlan(s.St.Pool)
	}
	if err != nil {
		if store.IsUniqueViolation(err, "uq_plans_one_recommended") {
			fail(c, apperr.E("validation_error", "推荐套餐发生并发冲突，请重试", 409))
			return
		}
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("validation_error", "套餐 code 已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	plan, err = store.GetPlan(ctx, s.St.Pool, plan.ID)
	if err != nil {
		fail(c, err)
		return
	}
	usage, err := store.GetPlanUsage(ctx, s.St.Pool, plan.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, adminPlanDict(plan, usage))
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
	usage, err := store.GetPlanUsage(ctx, s.St.Pool, plan.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if usage.OrderCount > 0 || usage.SubscriptionCount > 0 {
		fail(c, apperr.E("plan_in_use", "套餐已有历史订单或订阅，不能删除；请改为下架", 409))
		return
	}
	deleted, err := store.DeletePlan(ctx, s.St.Pool, plan.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("plan_in_use", "套餐已被业务记录引用，不能删除；请改为下架", 409))
		return
	}
	c.Status(204)
}

// ---------- tasks ----------

func (s *Server) adminListTasks(c *gin.Context, _ *store.User) {
	taskType := c.Query("type")
	status := c.Query("status")
	errorCode := strings.TrimSpace(c.Query("errorCode"))
	source := ""
	if taskType == store.PromptTaskTypeCanvas || taskType == store.CanvasTaskSource {
		source = store.CanvasTaskSource
		taskType = ""
	}
	if taskType != "" && !store.Contains(store.AdminTaskFilters, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	if status != "" && !store.Contains(store.TaskStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的任务状态", 422))
		return
	}
	if len([]rune(errorCode)) > 120 {
		fail(c, apperr.E("validation_error", "错误码筛选不能超过 120 个字符", 422))
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
	rows, err := store.ListAdminTasks(ctx, s.St.Pool, taskType, status, errorCode, userIDs, limit, cursor, source)
	if err != nil {
		fail(c, err)
		return
	}
	overview, err := store.GetAdminTaskOverview(ctx, s.St.Pool, taskType, errorCode, userIDs, source)
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
	page := buildPage(rows, limit, func(t *store.Task) gin.H {
		user := users[t.UserID]
		d := adminTaskDict(t, user)
		thumbURLs := thumbURLsForTask(t, "/api/v1/admin/files/")
		originalURLs := adminURLsForKeys(t.OutputKeys)
		d["outputUrls"] = originalURLs
		d["thumbnailUrls"] = thumbURLs
		d["originalUrls"] = originalURLs
		d["displayUrls"] = displayURLsForTask(t, "/api/v1/admin/files/")
		if user != nil {
			d["userEmail"] = user.Email
		} else {
			d["userEmail"] = nil
		}
		return d
	})
	page["summary"] = overview
	ok(c, page)
}

func (s *Server) adminPurgeTasks(c *gin.Context, _ *store.User) {
	taskType := c.Query("type")
	status := c.Query("status")
	errorCode := strings.TrimSpace(c.Query("errorCode"))
	source := ""
	if taskType == store.PromptTaskTypeCanvas || taskType == store.CanvasTaskSource {
		source = store.CanvasTaskSource
		taskType = ""
	}
	if taskType != "" && !store.Contains(store.AdminTaskFilters, taskType) {
		fail(c, apperr.E("validation_error", "无效的任务类型", 422))
		return
	}
	if status != "" && !store.Contains(store.TaskStatuses, status) {
		fail(c, apperr.E("validation_error", "无效的任务状态", 422))
		return
	}
	if status == "queued" || status == "running" {
		fail(c, apperr.E("validation_error", "只能清空已结束的任务记录", 422))
		return
	}
	if len([]rune(errorCode)) > 120 {
		fail(c, apperr.E("validation_error", "错误码筛选不能超过 120 个字符", 422))
		return
	}
	var userIDs []uuid.UUID
	var err error
	if userQuery := c.Query("user"); userQuery != "" {
		userIDs, err = s.matchUserIDsOrImpossible(c, userQuery)
		if err != nil {
			fail(c, err)
			return
		}
	}
	result, err := store.PurgeFinishedAdminTasks(c.Request.Context(), s.St, taskType, status, errorCode, userIDs, source)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{
		"deleted": result.Deleted,
		"skipped": result.Skipped,
	})
}

func (s *Server) adminRequeueTask(c *gin.Context, _ *store.User) {
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
		run, assistantErr := s.adminRequeueAssistantRun(c.Request.Context(), taskID)
		if assistantErr != nil {
			fail(c, assistantErr)
			return
		}
		ok(c, adminAssistantRunDict(run))
		return
	}
	task, err := taskflow.RequeueTask(c.Request.Context(), s.St, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if err := s.Queue.EnqueueRunTaskRecovery(c.Request.Context(), task.ID.String()); err != nil {
		log.Printf("task %s admin requeue deferred; durable queued recovery will retry: %v", task.ID, err)
	}
	ok(c, adminTaskDict(task, nil))
}

// adminURLsForKeys builds admin-scoped file URLs. The sc_admin_session cookie
// is scoped to Path=/api/v1/admin, so the admin UI can only fetch stored
// objects through /api/v1/admin/files/ — user-scoped /api/v1/files/ URLs would
// always 401 in the admin browser.
func adminURLsForKeys(keys []string) []string {
	urls := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimLeft(strings.TrimSpace(key), "/")
		if key != "" {
			urls = append(urls, "/api/v1/admin/files/"+key)
		}
	}
	return urls
}

func adminFileURL(key *string) *string {
	if key == nil || strings.TrimSpace(*key) == "" {
		return nil
	}
	u := "/api/v1/admin/files/" + strings.TrimLeft(strings.TrimSpace(*key), "/")
	return &u
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
	taskIDs := make([]uuid.UUID, 0, len(rows))
	for _, sub := range rows {
		taskIDs = append(taskIDs, sub.TaskID)
	}
	tasks, err := store.GetTasksByIDs(ctx, s.St.Pool, taskIDs)
	if err != nil {
		fail(c, err)
		return
	}
	promptBySubmission := make(map[uuid.UUID]*store.PromptEntry, len(rows))
	for _, sub := range rows {
		entry, promptErr := store.GetPromptEntryByGallerySubmission(ctx, s.St.Pool, sub.ID)
		if promptErr != nil {
			fail(c, promptErr)
			return
		}
		if entry != nil {
			promptBySubmission[sub.ID] = entry
		}
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
		d := submissionDict(sub, adminURLsForKeys(sub.MediaKeys))
		d["coverUrl"] = adminFileURL(sub.CoverKey)
		attachSubmissionTask(d, tasks[sub.TaskID])
		if promptEntry := promptBySubmission[sub.ID]; promptEntry != nil {
			d["promptEntryId"] = promptEntry.ID.String()
		}
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
	respondCreated(c, submissionDict(submission, nil))
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
	Title    string                `json:"title"`
	Body     *string               `json:"body"`
	Active   *bool                 `json:"active"`
	StartsAt *string               `json:"startsAt"`
	EndsAt   *string               `json:"endsAt"`
	Config   *announcementConfigIn `json:"config"`
}

type announcementAssetIn struct {
	URL string `json:"url"`
	Alt string `json:"alt,omitempty"`
}

type announcementConfigIn struct {
	Placement          string                `json:"placement"`
	Layout             string                `json:"layout"`
	Assets             []announcementAssetIn `json:"assets,omitempty"`
	DecorImageURL      string                `json:"decorImageUrl,omitempty"`
	CTAText            string                `json:"ctaText,omitempty"`
	CTAURL             string                `json:"ctaUrl,omitempty"`
	CloseText          string                `json:"closeText,omitempty"`
	AllowClose         bool                  `json:"allowClose"`
	Frequency          string                `json:"frequency"`
	Version            int                   `json:"version"`
	DismissHours       int                   `json:"dismissHours"`
	CarouselEnabled    bool                  `json:"carouselEnabled"`
	CarouselIntervalMS int                   `json:"carouselIntervalMs"`
}

func normalizeAnnouncementConfig(input *announcementConfigIn) (json.RawMessage, error) {
	config := announcementConfigIn{
		Placement:          "modal",
		Layout:             "text_only",
		AllowClose:         true,
		Frequency:          "session_once",
		Version:            1,
		DismissHours:       24,
		CarouselIntervalMS: 4500,
	}
	if input != nil {
		config = *input
		config.Placement = strings.TrimSpace(config.Placement)
		config.Layout = strings.TrimSpace(config.Layout)
		config.DecorImageURL = strings.TrimSpace(config.DecorImageURL)
		config.CTAText = strings.TrimSpace(config.CTAText)
		config.CTAURL = strings.TrimSpace(config.CTAURL)
		config.CloseText = strings.TrimSpace(config.CloseText)
		config.Frequency = strings.TrimSpace(config.Frequency)
	}
	if config.Placement == "" {
		config.Placement = "modal"
	}
	if config.Layout == "" {
		config.Layout = "text_only"
	}
	if config.Frequency == "" {
		config.Frequency = "session_once"
	}
	if config.Version <= 0 {
		config.Version = 1
	}
	if config.DismissHours <= 0 {
		config.DismissHours = 24
	}
	if config.CarouselIntervalMS <= 0 {
		config.CarouselIntervalMS = 4500
	}
	if !containsString([]string{"modal", "banner"}, config.Placement) {
		return nil, apperr.E("validation_error", "config.placement: 仅支持 modal 或 banner", 422)
	}
	if !containsString([]string{"text_only", "image_top", "image_left", "image_right", "grid", "carousel"}, config.Layout) {
		return nil, apperr.E("validation_error", "config.layout: 不支持的公告布局", 422)
	}
	if !containsString([]string{"session_once", "every_open", "once_per_version", "daily", "dismiss_hours"}, config.Frequency) {
		return nil, apperr.E("validation_error", "config.frequency: 不支持的展示频率", 422)
	}
	if len(config.Assets) > 4 {
		return nil, apperr.E("validation_error", "config.assets: 最多配置 4 张图片", 422)
	}
	for index := range config.Assets {
		config.Assets[index].URL = strings.TrimSpace(config.Assets[index].URL)
		config.Assets[index].Alt = strings.TrimSpace(config.Assets[index].Alt)
		if !validAnnouncementURL(config.Assets[index].URL) {
			return nil, apperr.E("validation_error", fmt.Sprintf("config.assets[%d].url: 地址无效", index), 422)
		}
		if len([]rune(config.Assets[index].Alt)) > 200 {
			return nil, apperr.E("validation_error", fmt.Sprintf("config.assets[%d].alt: 不能超过 200 字", index), 422)
		}
	}
	if config.DecorImageURL != "" && !validAnnouncementURL(config.DecorImageURL) {
		return nil, apperr.E("validation_error", "config.decorImageUrl: 地址无效", 422)
	}
	if (config.CTAText == "") != (config.CTAURL == "") {
		return nil, apperr.E("validation_error", "config.ctaText 与 config.ctaUrl 必须同时填写", 422)
	}
	if config.CTAURL != "" && !validAnnouncementURL(config.CTAURL) {
		return nil, apperr.E("validation_error", "config.ctaUrl: 地址无效", 422)
	}
	if len([]rune(config.CTAText)) > 40 || len([]rune(config.CloseText)) > 40 {
		return nil, apperr.E("validation_error", "公告按钮文案不能超过 40 字", 422)
	}
	if config.Version > 1_000_000 || config.DismissHours > 720 {
		return nil, apperr.E("validation_error", "公告版本或再次展示间隔超出范围", 422)
	}
	if config.CarouselIntervalMS < 1500 || config.CarouselIntervalMS > 20000 {
		return nil, apperr.E("validation_error", "config.carouselIntervalMs: 须在 1500-20000 之间", 422)
	}
	return json.Marshal(config)
}

func validAnnouncementURL(value string) bool {
	if value == "" || len(value) > 2048 || strings.ContainsAny(value, "\r\n") {
		return false
	}
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
		return true
	}
	parsed, err := url.ParseRequestURI(value)
	return err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != ""
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
	body.Title = strings.TrimSpace(body.Title)
	if body.Title == "" || len([]rune(body.Title)) > 200 {
		fail(c, apperr.E("validation_error", "title: 长度须在 1-200 之间", 422))
		return
	}
	if body.Body != nil {
		value := strings.TrimSpace(*body.Body)
		if len([]rune(value)) > 5000 {
			fail(c, apperr.E("validation_error", "body: 不能超过 5000 字", 422))
			return
		}
		body.Body = &value
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
	if startsAt != nil && endsAt != nil && !endsAt.After(*startsAt) {
		fail(c, apperr.E("validation_error", "endsAt: 必须晚于 startsAt", 422))
		return
	}
	config, err := normalizeAnnouncementConfig(body.Config)
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
		announcement, ierr = store.InsertAnnouncement(ctx, tx, body.Title, body.Body, active, startsAt, endsAt, config)
		return ierr
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, announcementDict(announcement))
}

type announcementPatchIn struct {
	Title    Opt[string]           `json:"title"`
	Body     Opt[string]           `json:"body"`
	Active   Opt[bool]             `json:"active"`
	StartsAt Opt[string]           `json:"startsAt"`
	EndsAt   Opt[string]           `json:"endsAt"`
	Config   *announcementConfigIn `json:"config"`
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
	if body.Title.Valid {
		body.Title.Value = strings.TrimSpace(body.Title.Value)
		if body.Title.Value == "" {
			fail(c, apperr.E("validation_error", "title: 不能为空", 422))
			return
		}
	}
	if body.Body.Valid && len([]rune(body.Body.Value)) > 5000 {
		fail(c, apperr.E("validation_error", "body: 不能超过 5000 字", 422))
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
	if announcement.StartsAt != nil && announcement.EndsAt != nil && !announcement.EndsAt.After(*announcement.StartsAt) {
		fail(c, apperr.E("validation_error", "endsAt: 必须晚于 startsAt", 422))
		return
	}
	if body.Config != nil {
		config, cerr := normalizeAnnouncementConfig(body.Config)
		if cerr != nil {
			fail(c, cerr)
			return
		}
		announcement.Config = config
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
	if err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		if ierr := store.DeleteNotificationsBySource(ctx, tx, store.AnnouncementNotificationSource, announcementID); ierr != nil {
			return ierr
		}
		return store.DeleteAnnouncement(ctx, tx, announcementID)
	}); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}

func (s *Server) adminUploadAnnouncementImage(c *gin.Context, _ *store.User) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		log.Printf("announcement image multipart parse failed: path=%s content_length=%d body_limit=%d err=%v",
			c.Request.URL.Path, c.Request.ContentLength,
			requestBodyLimit(c.Request.URL.Path, s.Cfg.UploadMaxBytes), err)
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || errors.Is(err, multipart.ErrMessageTooLarge) {
			fail(c, apperr.E("upload_too_large", "公告图片不能超过 8MB", 413))
			return
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			fail(c, apperr.E("invalid_upload", "图片上传数据不完整，请重新选择后重试", 400))
			return
		}
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", 422))
		return
	}
	if fileHeader.Size > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "公告图片不能超过 8MB", 413))
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, promptCoverMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	if int64(len(data)) > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "公告图片不能超过 8MB", 413))
		return
	}
	if len(data) == 0 {
		fail(c, apperr.E("unsupported_file", "文件为空", 400))
		return
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", 400))
		return
	}
	ctx := c.Request.Context()
	data, ext, contentType = s.compressCoverImage(ctx, data, ext, contentType)
	newKey := fmt.Sprintf("announcement-images/%s.%s", uuid.NewString(), ext)
	if err := s.Storage.UploadBytes(ctx, newKey, data, contentType); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{
		"key": newKey,
		"url": "/api/v1/files/" + newKey,
	})
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

const (
	changelogTransferFormat     = "startcloudsai-changelog"
	changelogTransferVersion    = 1
	changelogImportMaxEntries   = 500
	changelogImportMaxItems     = 100
	changelogImportMaxItemRunes = 500
)

type changelogTransferEntry struct {
	ID        string   `json:"id,omitempty"`
	Version   string   `json:"version"`
	Date      string   `json:"date"`
	Tag       string   `json:"tag"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary"`
	Items     []string `json:"items"`
	Highlight bool     `json:"highlight"`
	Sort      int      `json:"sort"`
}

type changelogTransferFile struct {
	Format        string                   `json:"format"`
	SchemaVersion int                      `json:"schemaVersion"`
	ExportedAt    string                   `json:"exportedAt,omitempty"`
	Entries       []changelogTransferEntry `json:"entries"`
}

func changelogSummaryText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func changelogTransferEntryFromStore(entry *store.ChangelogEntry) changelogTransferEntry {
	return changelogTransferEntry{
		ID: entry.ID.String(), Version: entry.Version, Date: entry.Date.Format("2006-01-02"),
		Tag: entry.Tag, Title: entry.Title, Summary: changelogSummaryText(entry.Summary),
		Items: nonNilStrings(entry.Items), Highlight: entry.Highlight, Sort: entry.Sort,
	}
}

func normalizeChangelogTransferEntry(input changelogTransferEntry) (*store.ChangelogEntry, error) {
	version := strings.TrimSpace(input.Version)
	dateText := strings.TrimSpace(input.Date)
	tag := strings.TrimSpace(input.Tag)
	title := strings.TrimSpace(input.Title)
	date, err := validateChangelogIn(version, dateText, tag, title)
	if err != nil {
		return nil, err
	}
	summary := strings.TrimSpace(input.Summary)
	if len([]rune(summary)) > 4000 {
		return nil, apperr.E("validation_error", "summary: 不能超过 4000 个字符", 422)
	}
	if len(input.Items) > changelogImportMaxItems {
		return nil, apperr.E("validation_error", "items: 每个版本最多 100 条", 422)
	}
	items := make([]string, 0, len(input.Items))
	for _, raw := range input.Items {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		if len([]rune(item)) > changelogImportMaxItemRunes {
			return nil, apperr.E("validation_error", "items: 单条不能超过 500 个字符", 422)
		}
		items = append(items, item)
	}
	if input.Sort < -1_000_000 || input.Sort > 1_000_000 {
		return nil, apperr.E("validation_error", "sort: 超出允许范围", 422)
	}
	var id uuid.UUID
	if idText := strings.TrimSpace(input.ID); idText != "" {
		parsed, parseErr := uuid.Parse(idText)
		if parseErr != nil {
			return nil, apperr.E("validation_error", "id: 格式无效", 422)
		}
		id = parsed
	}
	return &store.ChangelogEntry{
		ID: id, Version: version, Date: date, Tag: tag, Title: title,
		Summary: &summary, Items: items, Highlight: input.Highlight, Sort: input.Sort,
	}, nil
}

func changelogEntriesEqual(left, right *store.ChangelogEntry) bool {
	return left.Version == right.Version && left.Date.Format("2006-01-02") == right.Date.Format("2006-01-02") &&
		left.Tag == right.Tag && left.Title == right.Title && changelogSummaryText(left.Summary) == changelogSummaryText(right.Summary) &&
		slices.Equal(left.Items, right.Items) && left.Highlight == right.Highlight && left.Sort == right.Sort
}

func (s *Server) adminExportChangelog(c *gin.Context, _ *store.User) {
	rows, err := store.ListChangelog(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	entries := make([]changelogTransferEntry, 0, len(rows))
	for _, entry := range rows {
		entries = append(entries, changelogTransferEntryFromStore(entry))
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="startcloudsai-changelog-%s.json"`, time.Now().UTC().Format("20060102-150405")))
	c.JSON(http.StatusOK, changelogTransferFile{
		Format: changelogTransferFormat, SchemaVersion: changelogTransferVersion,
		ExportedAt: isoValue(time.Now()), Entries: entries,
	})
}

func (s *Server) adminImportChangelog(c *gin.Context, _ *store.User) {
	var body changelogTransferFile
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Format != "" && body.Format != changelogTransferFormat {
		fail(c, apperr.E("validation_error", "format: 不是 StarCloudsAI 更新说明文件", 422))
		return
	}
	if body.SchemaVersion != 0 && body.SchemaVersion != changelogTransferVersion {
		fail(c, apperr.E("validation_error", "schemaVersion: 暂不支持该文件版本", 422))
		return
	}
	if len(body.Entries) == 0 || len(body.Entries) > changelogImportMaxEntries {
		fail(c, apperr.E("validation_error", "entries: 数量须在 1-500 之间", 422))
		return
	}

	normalized := make([]*store.ChangelogEntry, 0, len(body.Entries))
	seenIDs := make(map[uuid.UUID]bool, len(body.Entries))
	seenIdentities := make(map[string]bool, len(body.Entries))
	highlights := 0
	for index, input := range body.Entries {
		entry, err := normalizeChangelogTransferEntry(input)
		if err != nil {
			fail(c, apperr.E("validation_error", fmt.Sprintf("第 %d 条：%s", index+1, err.Error()), 422))
			return
		}
		if entry.ID != uuid.Nil {
			if seenIDs[entry.ID] {
				fail(c, apperr.E("validation_error", fmt.Sprintf("第 %d 条：ID 重复", index+1), 422))
				return
			}
			seenIDs[entry.ID] = true
		}
		identity := entry.Version + "\x00" + entry.Date.Format("2006-01-02") + "\x00" + entry.Title
		if seenIdentities[identity] {
			fail(c, apperr.E("validation_error", fmt.Sprintf("第 %d 条：版本、日期与标题重复", index+1), 422))
			return
		}
		seenIdentities[identity] = true
		if entry.Highlight {
			highlights++
		}
		normalized = append(normalized, entry)
	}
	if highlights > 1 {
		fail(c, apperr.E("validation_error", "entries: 一次导入只能包含一个焦点版本", 422))
		return
	}

	created, updated, unchanged := 0, 0, 0
	err := s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		for _, incoming := range normalized {
			var existing *store.ChangelogEntry
			var lookupErr error
			if incoming.ID != uuid.Nil {
				existing, lookupErr = store.GetChangelog(c.Request.Context(), tx, incoming.ID)
				if lookupErr != nil {
					return lookupErr
				}
			}
			if existing == nil {
				existing, lookupErr = store.GetChangelogByIdentity(c.Request.Context(), tx, incoming.Version, incoming.Date, incoming.Title)
				if lookupErr != nil {
					return lookupErr
				}
			}
			if existing == nil {
				incoming.ID = uuid.Nil
				inserted, insertErr := store.InsertChangelog(c.Request.Context(), tx, incoming)
				if insertErr != nil {
					return insertErr
				}
				incoming = inserted
				created++
			} else if changelogEntriesEqual(existing, incoming) {
				incoming = existing
				unchanged++
			} else {
				existing.Version, existing.Date, existing.Tag, existing.Title = incoming.Version, incoming.Date, incoming.Tag, incoming.Title
				existing.Summary, existing.Items = incoming.Summary, incoming.Items
				existing.Highlight, existing.Sort = incoming.Highlight, incoming.Sort
				if updateErr := store.UpdateChangelog(c.Request.Context(), tx, existing); updateErr != nil {
					return updateErr
				}
				incoming = existing
				updated++
			}
			if incoming.Highlight {
				if clearErr := store.ClearOtherChangelogHighlights(c.Request.Context(), tx, incoming.ID); clearErr != nil {
					return clearErr
				}
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"total": len(normalized), "created": created, "updated": updated, "unchanged": unchanged})
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
	ctx := c.Request.Context()
	var entry *store.ChangelogEntry
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		created, ierr := store.InsertChangelog(ctx, tx, &store.ChangelogEntry{
			Version:   body.Version,
			Date:      date,
			Tag:       body.Tag,
			Title:     body.Title,
			Summary:   body.Summary,
			Items:     body.Items,
			Highlight: highlight,
			Sort:      sortVal,
		})
		if ierr != nil {
			return ierr
		}
		entry = created
		if highlight {
			return store.ClearOtherChangelogHighlights(ctx, tx, created.ID)
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, changelogDict(entry))
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
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if ierr := store.UpdateChangelog(ctx, tx, entry); ierr != nil {
			return ierr
		}
		if entry.Highlight {
			return store.ClearOtherChangelogHighlights(ctx, tx, entry.ID)
		}
		return nil
	})
	if err != nil {
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
	respondNoContent(c)
}

// ---------- settings ----------

var settingsCamel = map[string]string{
	"task_prices":                                 "taskPrices",
	"user_max_running_tasks":                      "userMaxRunningTasks",
	"user_max_running_images":                     "userMaxRunningImages",
	"user_max_concurrent_tasks":                   "userMaxConcurrentTasks",
	"global_max_concurrent_tasks":                 "globalMaxConcurrentTasks",
	"global_max_active_tasks":                     "globalMaxActiveTasks",
	"global_max_active_images":                    "globalMaxActiveImages",
	"task_failure_retry_count":                    "taskFailureRetryCount",
	"task_retry_first_delay_secs":                 "taskRetryFirstDelaySecs",
	"task_retry_backoff_secs":                     "taskRetryBackoffSecs",
	"image_variant_format":                        "imageVariantFormat",
	"image_display_lossless":                      "imageDisplayLossless",
	"image_display_quality":                       "imageDisplayQuality",
	"image_display_max_edge":                      "imageDisplayMaxEdge",
	"image_thumb_max_edge":                        "imageThumbMaxEdge",
	"image_fetch_concurrency":                     "imageFetchConcurrency",
	"cross_provider_same_model_balancing_enabled": "crossProviderSameModelBalancingEnabled",
	"admin_image_analysis_provider_id":            "adminImageAnalysisProviderId",
	"admin_image_analysis_model_id":               "adminImageAnalysisModelId",
	"admin_image_analysis_reasoning_effort":       "adminImageAnalysisReasoningEffort",
	"signup_bonus_cents":                          "signupBonusCents",
	"registration_enabled":                        "registrationEnabled",
	"task_models":                                 "taskModels",
	"image_service_routes":                        "imageServiceRoutes",
	"checkin_enabled":                             "checkinEnabled",
	"checkin_campaign_title":                      "checkinCampaignTitle",
	"checkin_rewards":                             "checkinRewards",
	"growth_group_enabled":                        "growthGroupEnabled",
	"growth_group_campaign_key":                   "growthGroupCampaignKey",
	"growth_group_target_members":                 "growthGroupTargetMembers",
	"growth_group_reward_cents":                   "growthGroupRewardCents",
	"growth_group_duration_hours":                 "growthGroupDurationHours",
	"growth_failure_bonus_enabled":                "growthFailureBonusEnabled",
	"growth_failure_bonus_cents":                  "growthFailureBonusCents",
	"growth_failure_bonus_daily_limit":            "growthFailureBonusDailyLimit",
	"growth_usage_rewards_enabled":                "growthUsageRewardsEnabled",
	"growth_usage_milestones":                     "growthUsageMilestones",
	"suggestion_reward_max_cents":                 "suggestionRewardMaxCents",
	"page_controls":                               "pageControls",
	"submission_enabled":                          "submissionEnabled",
	"auto_approve":                                "autoApprove",
	"daily_limit":                                 "dailyLimit",
	"c2a_base_url":                                "c2aBaseUrl",
	"c2a_api_key":                                 "c2aApiKey",
	"c2a_timeout_secs":                            "c2aTimeoutSecs",
	"sub2api_base_url":                            "sub2apiBaseUrl",
	"sub2api_api_key":                             "sub2apiApiKey",
	"sub2api_chat_model":                          "sub2apiChatModel",
	"sub2api_chat_models":                         "sub2apiChatModels",
	"sub2api_image_model":                         "sub2apiImageModel",
	"sub2api_timeout_secs":                        "sub2apiTimeoutSecs",
	"crun_base_url":                               "crunBaseUrl",
	"crun_api_key":                                "crunApiKey",
	"crun_timeout_secs":                           "crunTimeoutSecs",
	"lanjing_pay_enabled":                         "lanjingPayEnabled",
	"lanjing_pay_base_url":                        "lanjingPayBaseUrl",
	"lanjing_pay_secret":                          "lanjingPaySecret",
	"lanjing_pay_notify_url":                      "lanjingPayNotifyUrl",
	"lanjing_pay_timeout_secs":                    "lanjingPayTimeoutSecs",
	"lanjing_pay_alipay_enabled":                  "lanjingPayAlipayEnabled",
	"lanjing_pay_wechat_enabled":                  "lanjingPayWechatEnabled",
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

func (s *Server) workerConcurrencyCeiling() int {
	ceiling := 1
	if s.Cfg != nil && s.Cfg.WorkerConcurrency > ceiling {
		ceiling = s.Cfg.WorkerConcurrency
	}
	if s.Queue != nil {
		if online := s.Queue.Metrics().WorkerConcurrency; online > ceiling {
			ceiling = online
		}
	}
	return ceiling
}

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
		if k == "c2a_api_key" || k == "sub2api_api_key" || k == "crun_api_key" || k == "lanjing_pay_secret" {
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
	configured := int64(2000)
	_ = json.Unmarshal(all["global_max_concurrent_tasks"], &configured)
	ceiling := int64(s.workerConcurrencyCeiling())
	out["workerConcurrencyCeiling"] = ceiling
	out["effectiveGlobalConcurrency"] = max(configured, 1)
	payment, err := settings.ResolveLanjingPay(c.Request.Context(), s.St.Pool, settings.LanjingPayConfig{
		Enabled:       s.Cfg.LanjingPayEnabled(),
		BaseURL:       s.Cfg.LanjingPayBaseURL,
		Secret:        s.Cfg.LanjingPaySecret,
		NotifyURL:     s.Cfg.LanjingPayNotifyURL,
		TimeoutSecs:   s.Cfg.LanjingPayTimeoutSecs,
		AlipayEnabled: true,
		WechatEnabled: true,
	}, s.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	out["lanjingPayEnabled"] = payment.Enabled
	out["lanjingPayBaseUrl"] = payment.BaseURL
	out["lanjingPaySecret"] = maskSecret(payment.Secret)
	out["lanjingPayNotifyUrl"] = payment.NotifyURL
	out["lanjingPayTimeoutSecs"] = payment.TimeoutSecs
	out["lanjingPayAlipayEnabled"] = payment.AlipayEnabled
	out["lanjingPayWechatEnabled"] = payment.WechatEnabled
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
			// 拼图没有服务端调用，后台不能把本地工具误配成收费任务。
			prices["puzzle"] = 0
			raw, _ = json.Marshal(prices)
		case "user_max_running_tasks":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 10000 {
				fail(c, apperr.E("validation_error", "userMaxRunningTasks: 须在 1-10000 之间", 422))
				return
			}
		case "user_max_running_images":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 100000 {
				fail(c, apperr.E("validation_error", "userMaxRunningImages: 须在 1-100000 之间", 422))
				return
			}
		case "user_max_concurrent_tasks":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 10000 {
				fail(c, apperr.E("validation_error", "userMaxConcurrentTasks: 须在 1-10000 之间", 422))
				return
			}
		case "global_max_concurrent_tasks":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 10000000 {
				fail(c, apperr.E("validation_error", "globalMaxConcurrentTasks: 须在 1-10000000 之间", 422))
				return
			}
		case "global_max_active_tasks":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 10 || v > 10000000 {
				fail(c, apperr.E("validation_error", "globalMaxActiveTasks: 须在 10-10000000 之间", 422))
				return
			}
		case "global_max_active_images":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 10 || v > 10000000 {
				fail(c, apperr.E("validation_error", "globalMaxActiveImages: 须在 10-10000000 之间", 422))
				return
			}
		case "task_failure_retry_count":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 || v > 100 {
				fail(c, apperr.E("validation_error", "taskFailureRetryCount: 须在 0-100 之间", 422))
				return
			}
		case "task_retry_first_delay_secs":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 600 {
				fail(c, apperr.E("validation_error", "taskRetryFirstDelaySecs: 须在 1-600 之间", 422))
				return
			}
		case "task_retry_backoff_secs":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 600 {
				fail(c, apperr.E("validation_error", "taskRetryBackoffSecs: 须在 1-600 之间", 422))
				return
			}
		case "admin_image_analysis_provider_id", "admin_image_analysis_model_id", "admin_image_analysis_reasoning_effort":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			v = strings.TrimSpace(v)
			if len([]rune(v)) > 128 {
				fail(c, apperr.E("validation_error", camel+": 长度不能超过 128", 422))
				return
			}
			raw, _ = json.Marshal(v)
		case "image_variant_format":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil || (v != "webp" && v != "png") {
				fail(c, apperr.E("validation_error", "imageVariantFormat: 仅支持 webp 或 png", 422))
				return
			}
		case "image_display_lossless":
			var v bool
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", "imageDisplayLossless: 须为布尔值", 422))
				return
			}
		case "image_display_quality":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 100 {
				fail(c, apperr.E("validation_error", "imageDisplayQuality: 须在 1-100 之间", 422))
				return
			}
		case "image_display_max_edge":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 512 || v > 8192 {
				fail(c, apperr.E("validation_error", "imageDisplayMaxEdge: 须在 512-8192 之间", 422))
				return
			}
		case "image_thumb_max_edge":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 128 || v > 1024 {
				fail(c, apperr.E("validation_error", "imageThumbMaxEdge: 须在 128-1024 之间", 422))
				return
			}
		case "image_fetch_concurrency":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 32 {
				fail(c, apperr.E("validation_error", "imageFetchConcurrency: 须在 1-32 之间", 422))
				return
			}
		case "signup_bonus_cents", "daily_limit", "growth_group_reward_cents", "growth_failure_bonus_cents", "suggestion_reward_max_cents":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 || v > 1_000_000 {
				fail(c, apperr.E("validation_error", camel+": 须为非负整数", 422))
				return
			}
		case "growth_group_target_members":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 2 || v > 10 {
				fail(c, apperr.E("validation_error", "growthGroupTargetMembers: 须在 2-10 之间", 422))
				return
			}
		case "growth_group_duration_hours":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 720 {
				fail(c, apperr.E("validation_error", "growthGroupDurationHours: 须在 1-720 之间", 422))
				return
			}
		case "growth_failure_bonus_daily_limit":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 || v > 100 {
				fail(c, apperr.E("validation_error", "growthFailureBonusDailyLimit: 须在 0-100 之间", 422))
				return
			}
		case "registration_enabled", "submission_enabled", "auto_approve", "cross_provider_same_model_balancing_enabled", "checkin_enabled", "growth_group_enabled", "growth_failure_bonus_enabled", "growth_usage_rewards_enabled", "lanjing_pay_enabled", "lanjing_pay_alipay_enabled", "lanjing_pay_wechat_enabled":
			var v bool
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 须为布尔值", 422))
				return
			}
		case "task_models", "sub2api_chat_models", "image_service_routes":
			var v map[string]string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			if snake == "image_service_routes" {
				cleaned := make(map[string]string, len(v))
				for routeKey, provider := range v {
					routeKey = strings.TrimSpace(routeKey)
					provider = strings.ToLower(strings.TrimSpace(provider))
					if !settings.ValidImageServiceRoute(routeKey) ||
						(provider != "c2a" && provider != "sub2api" && provider != "crun") {
						fail(c, apperr.E("validation_error", camel+": 页面或服务类型无效", 422))
						return
					}
					cleaned[routeKey] = provider
				}
				raw, _ = json.Marshal(cleaned)
			} else if snake == "sub2api_chat_models" {
				if len(v) > 40 {
					fail(c, apperr.E("validation_error", camel+": 最多配置 40 个模型", 422))
					return
				}
				cleaned := make(map[string]string, len(v))
				for label, model := range v {
					label = strings.TrimSpace(label)
					model = strings.TrimSpace(model)
					if label == "" || model == "" || len([]rune(label)) > 80 || len([]rune(model)) > 120 {
						fail(c, apperr.E("validation_error", camel+": 名称或模型 ID 无效", 422))
						return
					}
					cleaned[label] = model
				}
				raw, _ = json.Marshal(cleaned)
			}
		case "checkin_rewards":
			var rewards []int64
			if err := json.Unmarshal(raw, &rewards); err != nil || len(rewards) != 7 {
				fail(c, apperr.E("validation_error", "checkinRewards: 必须配置连续 7 天奖励", 422))
				return
			}
			positive := false
			for _, reward := range rewards {
				if reward < 0 || reward > 1000000 {
					fail(c, apperr.E("validation_error", "checkinRewards: 单日奖励须在 0-1000000 之间", 422))
					return
				}
				positive = positive || reward > 0
			}
			if !positive {
				fail(c, apperr.E("validation_error", "checkinRewards: 至少一天奖励须大于 0", 422))
				return
			}
		case "checkin_campaign_title":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", "checkinCampaignTitle: 格式不正确", 422))
				return
			}
			v = strings.TrimSpace(v)
			if len([]rune(v)) < 2 || len([]rune(v)) > 40 {
				fail(c, apperr.E("validation_error", "checkinCampaignTitle: 长度须在 2-40 之间", 422))
				return
			}
			raw, _ = json.Marshal(v)
		case "growth_group_campaign_key":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", "growthGroupCampaignKey: 格式不正确", 422))
				return
			}
			v = strings.TrimSpace(v)
			if len(v) < 2 || len(v) > 64 {
				fail(c, apperr.E("validation_error", "growthGroupCampaignKey: 长度须在 2-64 之间", 422))
				return
			}
			raw, _ = json.Marshal(v)
		case "growth_usage_milestones":
			var milestones []struct {
				Units       int64 `json:"units"`
				RewardCents int64 `json:"rewardCents"`
			}
			if err := json.Unmarshal(raw, &milestones); err != nil || len(milestones) < 1 || len(milestones) > 12 {
				fail(c, apperr.E("validation_error", "growthUsageMilestones: 须配置 1-12 个里程碑", 422))
				return
			}
			seen := map[int64]bool{}
			for _, milestone := range milestones {
				if milestone.Units < 1 || milestone.Units > 1_000_000 || milestone.RewardCents < 1 || milestone.RewardCents > 1_000_000 || seen[milestone.Units] {
					fail(c, apperr.E("validation_error", "growthUsageMilestones: 张数或奖励无效且张数不能重复", 422))
					return
				}
				seen[milestone.Units] = true
			}
		case "page_controls":
			var controls map[string]settings.PageControl
			if err := json.Unmarshal(raw, &controls); err != nil {
				fail(c, apperr.E("validation_error", "pageControls: 格式不正确", 422))
				return
			}
			if len(controls) > len(settings.PageControlKeys) {
				fail(c, apperr.E("validation_error", "pageControls: 页面数量无效", 422))
				return
			}
			cleaned := make(map[string]settings.PageControl, len(controls))
			for key, control := range controls {
				control.Status = strings.TrimSpace(control.Status)
				control.Reason = strings.TrimSpace(control.Reason)
				if !settings.ValidPageControlKey(key) {
					fail(c, apperr.E("validation_error", "pageControls: 未知页面 "+key, 422))
					return
				}
				if !settings.ValidPageStatus(control.Status) {
					fail(c, apperr.E("validation_error", "pageControls: "+key+" 的状态无效", 422))
					return
				}
				if len([]rune(control.Reason)) > 200 {
					fail(c, apperr.E("validation_error", "pageControls: 原因不能超过 200 字", 422))
					return
				}
				cleaned[key] = control
			}
			raw, _ = json.Marshal(cleaned)
		case "c2a_base_url", "sub2api_base_url", "crun_base_url", "lanjing_pay_base_url":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			v = strings.TrimRight(strings.TrimSpace(v), "/")
			allowPrivate := s.Cfg.AppEnv == "development"
			if snake == "c2a_base_url" {
				allowPrivate = s.Cfg.C2APrivateNetworkAllowed()
			}
			if v != "" && netguard.ValidateURL(v, allowPrivate, false) != nil {
				fail(c, apperr.E("validation_error", camel+": 地址无效或指向受限网络", 422))
				return
			}
			normalized, _ := json.Marshal(v)
			raw = normalized
		case "lanjing_pay_notify_url":
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fail(c, apperr.E("validation_error", camel+": 格式不正确", 422))
				return
			}
			v = strings.TrimSpace(v)
			if v != "" && netguard.ValidateURL(v, s.Cfg.AppEnv == "development", s.Cfg.AppEnv == "production") != nil {
				fail(c, apperr.E("validation_error", camel+": 必须是有效的公网 HTTPS 地址", 422))
				return
			}
			normalized, _ := json.Marshal(v)
			raw = normalized
		case "c2a_api_key", "sub2api_api_key", "crun_api_key", "lanjing_pay_secret":
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
		case "crun_timeout_secs":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 0 || v > 1800 {
				fail(c, apperr.E("validation_error", camel+": 须在 0-1800 之间（0 = 使用默认）", 422))
				return
			}
		case "lanjing_pay_timeout_secs":
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v < 1 || v > 60 {
				fail(c, apperr.E("validation_error", camel+": 须在 1-60 之间", 422))
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
	if raw, exists := updates["trial_campaign_feature_keys"]; exists {
		var values []string
		_ = json.Unmarshal(raw, &values)
		if len(values) > 0 {
			updates["trial_campaign_feature_key"], _ = json.Marshal(values[0])
		}
	} else if raw, exists := updates["trial_campaign_feature_key"]; exists {
		var value string
		_ = json.Unmarshal(raw, &value)
		updates["trial_campaign_feature_keys"], _ = json.Marshal([]string{value})
	}
	ctx := c.Request.Context()
	if err := s.validateAdminImageAnalysisSettings(ctx, updates); err != nil {
		fail(c, err)
		return
	}
	if err := s.validateLanjingPaySettings(ctx, updates); err != nil {
		fail(c, err)
		return
	}
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

func (s *Server) validateAdminImageAnalysisSettings(ctx context.Context, updates map[string]json.RawMessage) error {
	_, providerUpdated := updates["admin_image_analysis_provider_id"]
	_, modelUpdated := updates["admin_image_analysis_model_id"]
	_, effortUpdated := updates["admin_image_analysis_reasoning_effort"]
	if !providerUpdated && !modelUpdated && !effortUpdated {
		return nil
	}
	read := func(key string) (string, error) {
		if raw, exists := updates[key]; exists {
			var value string
			if err := json.Unmarshal(raw, &value); err != nil {
				return "", err
			}
			return strings.TrimSpace(value), nil
		}
		return settings.GetString(ctx, s.St.Pool, key)
	}
	providerID, err := read("admin_image_analysis_provider_id")
	if err != nil {
		return err
	}
	modelID, err := read("admin_image_analysis_model_id")
	if err != nil {
		return err
	}
	reasoningEffort, err := read("admin_image_analysis_reasoning_effort")
	if err != nil {
		return err
	}
	if providerID == "" && modelID == "" && reasoningEffort == "" {
		return nil
	}
	if providerID == "" || modelID == "" {
		return apperr.E("validation_error", "后台图片分析的服务商和模型必须同时配置", 422)
	}
	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		return err
	}
	if _, _, ok := selectAdminImageAnalysisModel(cfg, providerID, modelID, reasoningEffort); !ok {
		return apperr.E("validation_error", "后台图片分析的服务商、模型或推理强度无效", 422)
	}
	return nil
}

func (s *Server) validateLanjingPaySettings(ctx context.Context, updates map[string]json.RawMessage) error {
	current, err := settings.ResolveLanjingPay(ctx, s.St.Pool, settings.LanjingPayConfig{
		Enabled:       s.Cfg.LanjingPayEnabled(),
		BaseURL:       s.Cfg.LanjingPayBaseURL,
		Secret:        s.Cfg.LanjingPaySecret,
		NotifyURL:     s.Cfg.LanjingPayNotifyURL,
		TimeoutSecs:   s.Cfg.LanjingPayTimeoutSecs,
		AlipayEnabled: true,
		WechatEnabled: true,
	}, s.Cfg.AppSecret)
	if err != nil {
		return err
	}
	for key, target := range map[string]*string{
		"lanjing_pay_base_url":   &current.BaseURL,
		"lanjing_pay_notify_url": &current.NotifyURL,
	} {
		if raw := updates[key]; raw != nil {
			_ = json.Unmarshal(raw, target)
		}
	}
	if raw := updates["lanjing_pay_secret"]; raw != nil {
		var stored string
		_ = json.Unmarshal(raw, &stored)
		plain, decryptErr := settings.DecryptSecret(stored, s.Cfg.AppSecret)
		if decryptErr != nil {
			return decryptErr
		}
		current.Secret = plain
	}
	for key, target := range map[string]*bool{
		"lanjing_pay_enabled":        &current.Enabled,
		"lanjing_pay_alipay_enabled": &current.AlipayEnabled,
		"lanjing_pay_wechat_enabled": &current.WechatEnabled,
	} {
		if raw := updates[key]; raw != nil {
			_ = json.Unmarshal(raw, target)
		}
	}
	if raw := updates["lanjing_pay_timeout_secs"]; raw != nil {
		_ = json.Unmarshal(raw, &current.TimeoutSecs)
	}
	if !current.Enabled {
		return nil
	}
	if !current.AlipayEnabled && !current.WechatEnabled {
		return apperr.E("validation_error", "蓝鲸支付启用时至少开放一种支付方式", 422)
	}
	if current.Secret == "" || current.NotifyURL == "" || current.BaseURL == "" {
		return apperr.E("validation_error", "蓝鲸支付启用时接口地址、通讯密钥和异步回调均为必填", 422)
	}
	_, err = lanjingpay.New(
		current.BaseURL, current.Secret, current.NotifyURL,
		time.Duration(current.TimeoutSecs)*time.Second,
		s.Cfg.AppEnv != "production",
	)
	if err != nil {
		return apperr.E("validation_error", "蓝鲸支付配置无效："+err.Error(), 422)
	}
	return nil
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
		if netguard.ValidateURL(v, s.Cfg.C2APrivateNetworkAllowed(), false) != nil {
			fail(c, apperr.E("validation_error", "baseUrl: 地址无效或指向受限网络", 422))
			return
		}
		resolved.BaseURL = v
	}
	if v := strings.TrimSpace(override.APIKey); v != "" && !strings.HasPrefix(v, "****") {
		resolved.APIKey = v
	}
	client := c2a.NewWithPolicy(resolved.BaseURL, resolved.APIKey, resolved.TimeoutSecs, s.Cfg.C2APrivateNetworkAllowed())
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
				}
			}
		}
	}
	visible, total := adminModelList(models, 200)
	ok(c, gin.H{
		"ok": true, "modelCount": total, "models": visible,
		"truncated": total > len(visible),
	})
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
	visible, total := adminModelList(models, 200)
	ok(c, gin.H{
		"ok": true, "modelCount": total, "models": visible,
		"truncated": total > len(visible),
	})
}

func (s *Server) adminTestCRUN(c *gin.Context, _ *store.User) {
	var override struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
	}
	_ = c.ShouldBindJSON(&override)
	ctx := c.Request.Context()
	resolved, err := settings.ResolveCRUN(ctx, s.St.Pool, settings.CRUNConfig{
		BaseURL: s.Cfg.CRUNBaseURL, APIKey: s.Cfg.CRUNAPIKey, TimeoutSecs: s.Cfg.CRUNTimeoutSecs,
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
	client, err := crun.New(resolved.BaseURL, resolved.APIKey, crun.DefaultModel, resolved.TimeoutSecs)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	balance, err := client.Balance(ctx)
	if err != nil {
		message := err.Error()
		if runes := []rune(message); len(runes) > 500 {
			message = string(runes[:500])
		}
		fail(c, apperr.E("crun_test_failed", message, 502))
		return
	}
	ok(c, gin.H{"ok": true, "balance": balance, "model": crun.DefaultModel})
}

func (s *Server) adminTestLanjingPay(c *gin.Context, _ *store.User) {
	var override struct {
		BaseURL     string `json:"baseUrl"`
		Secret      string `json:"secret"`
		NotifyURL   string `json:"notifyUrl"`
		TimeoutSecs int    `json:"timeoutSecs"`
	}
	_ = c.ShouldBindJSON(&override)
	ctx := c.Request.Context()
	resolved, err := settings.ResolveLanjingPay(ctx, s.St.Pool, settings.LanjingPayConfig{
		Enabled:       s.Cfg.LanjingPayEnabled(),
		BaseURL:       s.Cfg.LanjingPayBaseURL,
		Secret:        s.Cfg.LanjingPaySecret,
		NotifyURL:     s.Cfg.LanjingPayNotifyURL,
		TimeoutSecs:   s.Cfg.LanjingPayTimeoutSecs,
		AlipayEnabled: true,
		WechatEnabled: true,
	}, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	if value := strings.TrimRight(strings.TrimSpace(override.BaseURL), "/"); value != "" {
		resolved.BaseURL = value
	}
	if value := strings.TrimSpace(override.Secret); value != "" && !strings.HasPrefix(value, "****") {
		resolved.Secret = value
	}
	if value := strings.TrimSpace(override.NotifyURL); value != "" {
		resolved.NotifyURL = value
	}
	if override.TimeoutSecs > 0 {
		resolved.TimeoutSecs = override.TimeoutSecs
	}
	client, err := lanjingpay.New(
		resolved.BaseURL, resolved.Secret, resolved.NotifyURL,
		time.Duration(resolved.TimeoutSecs)*time.Second,
		s.Cfg.AppEnv != "production",
	)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	state, err := client.GetServerState(ctx)
	if err != nil {
		message := err.Error()
		if runes := []rune(message); len(runes) > 500 {
			message = string(runes[:500])
		}
		fail(c, apperr.E("lanjing_pay_test_failed", message, 502))
		return
	}
	stateLabel := map[int]string{-1: "未绑定", 0: "离线", 1: "在线"}[state.State]
	var heartbeatAt, lastPaymentAt any
	if !state.LastHeartbeat.IsZero() {
		heartbeatAt = isoValue(state.LastHeartbeat)
	}
	if !state.LastPayment.IsZero() {
		lastPaymentAt = isoValue(state.LastPayment)
	}
	ok(c, gin.H{
		"ok": true, "online": state.State == 1, "state": state.State,
		"stateLabel": stateLabel, "lastHeartbeatAt": heartbeatAt, "lastPaymentAt": lastPaymentAt,
	})
}

// adminModelList cleans, de-duplicates and sorts model IDs before exposing them
// to the settings UI. The generous cap keeps pathological upstream responses
// bounded while still allowing administrators to select from normal catalogs.
func adminModelList(models []string, limit int) ([]string, int) {
	seen := make(map[string]struct{}, len(models))
	cleaned := make([]string, 0, len(models))
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		if _, exists := seen[model]; exists {
			continue
		}
		seen[model] = struct{}{}
		cleaned = append(cleaned, model)
	}
	sort.Strings(cleaned)
	total := len(cleaned)
	if limit > 0 && len(cleaned) > limit {
		cleaned = cleaned[:limit]
	}
	if cleaned == nil {
		cleaned = []string{}
	}
	return cleaned, total
}
