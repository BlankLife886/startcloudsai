package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/subscription"
)

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
	if user == nil || user.Role != "user" {
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
	assets, err := store.CountUserAssets(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	now := time.Now().UTC()
	sessions, err := store.GetUserSessionSummary(ctx, s.St.Pool, userID, now)
	if err != nil {
		fail(c, err)
		return
	}
	feedbackCount, err := store.CountUserFeedback(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	subOut, err := adminUserSubscriptionDict(ctx, s.St.Pool, userID, now)
	if err != nil {
		fail(c, err)
		return
	}
	trialApp, err := store.GetTrialAccessApplicationByUser(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	checkinOut, err := adminUserCheckinDict(ctx, s.St.Pool, userID)
	if err != nil {
		fail(c, err)
		return
	}
	growthOut, err := adminUserGrowthDict(ctx, s.St.Pool, userID, now)
	if err != nil {
		fail(c, err)
		return
	}
	profileOut, err := s.adminUserProfileData(ctx, userID, now, false)
	if err != nil {
		fail(c, err)
		return
	}
	var tasksTotal int64
	for _, n := range byStatus {
		tasksTotal += n
	}
	walletOut := walletDict(nil)
	if wallet != nil {
		walletOut = walletDict(wallet)
		if key := strings.TrimSpace(ptrString(wallet.TrialFeatureKey)); key != "" {
			walletOut["trialFeatureLabel"] = trialFeatureDictForKey(key)["label"]
		}
	}
	ok(c, gin.H{
		"user":         adminUserDict(user, nil),
		"wallet":       walletOut,
		"subscription": subOut,
		"trialAccess":  trialAccessApplicationDict(trialApp, false),
		"checkin":      checkinOut,
		"growthGroup":  growthOut,
		"profile":      profileOut,
		"security": gin.H{
			"activeSessions":       sessions.ActiveCount,
			"lastSessionIp":        sessions.LastIP,
			"lastSessionUserAgent": sessions.LastUserAgent,
			"lastSessionAt":        iso(sessions.LastCreatedAt),
			"lastSessionExpiresAt": iso(sessions.LastExpiresAt),
		},
		"counts": gin.H{
			"orders":         orders,
			"tasksTotal":     tasksTotal,
			"tasksSucceeded": byStatus["succeeded"],
			"tasksFailed":    byStatus["failed"],
			"tasksRunning":   byStatus["running"] + byStatus["queued"],
			"tasksCanceled":  byStatus["canceled"],
			"submissions":    submissions,
			"assets":         assets,
			"feedback":       feedbackCount,
		},
	})
}

func (s *Server) adminRefreshUserProfile(c *gin.Context, _ *store.User) {
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
	if user == nil || user.Role != "user" {
		fail(c, apperr.E("not_found", "用户不存在", 404))
		return
	}
	profile, err := s.adminUserProfileData(ctx, userID, time.Now().UTC(), true)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, profile)
}

func (s *Server) adminUserProfileData(ctx context.Context, userID uuid.UUID, now time.Time, force bool) (gin.H, error) {
	metric, err := store.GetUserProfileMetric(ctx, s.St.Pool, userID)
	if err != nil {
		return nil, err
	}
	if metric == nil || force {
		rules, err := settings.UserProfileRules(ctx, s.St.Pool)
		if err != nil {
			return nil, err
		}
		if err := store.RefreshUserProfiles(ctx, s.St.Pool, []uuid.UUID{userID}, rules, now); err != nil {
			return nil, err
		}
		if err := store.DeleteUserProfileRefreshQueue(ctx, s.St.Pool, []uuid.UUID{userID}); err != nil {
			return nil, err
		}
		metric, err = store.GetUserProfileMetric(ctx, s.St.Pool, userID)
		if err != nil {
			return nil, err
		}
	}
	workspaces, err := store.UserProfileWorkspaceBreakdown(ctx, s.St.Pool, userID)
	if err != nil {
		return nil, err
	}
	models, err := store.UserProfileModelBreakdown(ctx, s.St.Pool, userID)
	if err != nil {
		return nil, err
	}
	if cfg, cfgErr := modelconfig.Load(ctx, s.St.Pool); cfgErr == nil {
		resolveProfileModelLabels(cfg, models)
	}
	failures, err := store.UserProfileFailureBreakdown(ctx, s.St.Pool, userID)
	if err != nil {
		return nil, err
	}
	trend, err := store.UserProfileDailyTrend(ctx, s.St.Pool, userID)
	if err != nil {
		return nil, err
	}
	funnel, err := store.UserBehaviorFunnel30(ctx, s.St.Pool, userID)
	if err != nil {
		return nil, err
	}
	history, err := store.UserProfileHistory(ctx, s.St.Pool, userID, 30)
	if err != nil {
		return nil, err
	}
	return gin.H{
		"metrics":    metric,
		"workspaces": workspaces,
		"models":     models,
		"failures":   failures,
		"dailyTrend": trend,
		"funnel":     funnel,
		"history":    history,
	}, nil
}

var profileUpstreamModelLabels = map[string]string{
	"image-background-remove": "背景移除",
	"image-upscale":           "图片高清放大",
	"image-watermark-remove":  "图片去水印",
	"video-enhance":           "视频增强",
	"video-watermark-remove":  "视频去水印",
	"vidu/lip-sync":           "口型同步",
}

func resolveProfileModelLabels(cfg modelconfig.Config, items []store.UserProfileBreakdown) {
	byID := make(map[string]string, len(cfg.Models))
	byUpstream := make(map[string]string, len(cfg.Models))
	for _, model := range cfg.Models {
		name := strings.TrimSpace(model.Name)
		if name == "" {
			continue
		}
		if id := strings.TrimSpace(model.ID); id != "" {
			byID[id] = name
		}
		if upstream := strings.TrimSpace(model.UpstreamModel); upstream != "" {
			if _, exists := byUpstream[upstream]; !exists {
				byUpstream[upstream] = name
			}
		}
	}
	for i := range items {
		key := strings.TrimSpace(items[i].Key)
		if name := byID[key]; name != "" {
			items[i].Label = name
			continue
		}
		if name := byUpstream[key]; name != "" {
			items[i].Label = name
			continue
		}
		if name := profileUpstreamModelLabels[key]; name != "" {
			items[i].Label = name
		}
	}
}

func ptrString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func adminUserSubscriptionDict(ctx context.Context, q store.Q, userID uuid.UUID, now time.Time) (gin.H, error) {
	sub, err := store.GetCurrentSubscription(ctx, q, userID, now)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return gin.H{"active": false}, nil
	}
	plan, err := store.GetPlan(ctx, q, sub.PlanID)
	if err != nil {
		return nil, err
	}
	planName, planCode := "", ""
	if plan != nil {
		planName = plan.Name
		planCode = plan.Code
	}
	return gin.H{
		"active":          true,
		"planId":          sub.PlanID.String(),
		"planName":        planName,
		"planCode":        planCode,
		"startsAt":        isoValue(sub.StartsAt),
		"endsAt":          isoValue(sub.EndsAt),
		"dailyGrantCents": sub.DailyGrantCents,
		"grantedToday":    subscription.GrantedOn(sub, subscription.BeijingDate(now)),
	}, nil
}

func adminUserCheckinDict(ctx context.Context, q store.Q, userID uuid.UUID) (gin.H, error) {
	total, err := store.CountDailyCheckins(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	latest, err := store.GetLatestDailyCheckin(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	if latest == nil {
		return gin.H{"totalDays": total}, nil
	}
	return gin.H{
		"totalDays":       total,
		"streak":          latest.Streak,
		"cycleDay":        latest.CycleDay,
		"lastDate":        latest.CheckinDate.Format("2006-01-02"),
		"lastRewardCents": latest.RewardCents,
	}, nil
}

func adminUserGrowthDict(ctx context.Context, q store.Q, userID uuid.UUID, now time.Time) (any, error) {
	item, err := store.GetLatestUserGrowthParticipation(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, nil
	}
	status := item.Group.Status
	if status == "active" && !item.Group.ExpiresAt.After(now) {
		status = "expired"
	}
	return gin.H{
		"id":            item.Group.ID.String(),
		"code":          item.Group.Code,
		"status":        status,
		"role":          item.Role,
		"memberCount":   item.MemberCount,
		"targetMembers": item.Group.TargetMembers,
		"rewardCents":   item.Group.RewardCents,
		"expiresAt":     isoValue(item.Group.ExpiresAt),
		"completedAt":   iso(item.Group.CompletedAt),
	}, nil
}
