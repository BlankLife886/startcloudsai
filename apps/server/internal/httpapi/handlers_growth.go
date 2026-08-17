package httpapi

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/growth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

var growthProgramMeta = []gin.H{
	{"id": "group", "name": "好友拼团", "category": "growth", "action": "创建或加入拼团"},
	{"id": "membership", "name": "会员计划", "category": "membership", "action": "查看会员方案"},
	{"id": "failure_bonus", "name": "失败补偿", "category": "reward", "action": "自动到账"},
	{"id": "usage_milestone", "name": "越用越多", "category": "reward", "action": "查看本月进度"},
	{"id": "suggestion", "name": "建议采纳", "category": "reward", "action": "提交产品建议"},
}

func growthGroupDict(item *store.GrowthGroup) gin.H {
	if item == nil {
		return nil
	}
	members := make([]gin.H, 0, len(item.Members))
	for _, member := range item.Members {
		members = append(members, gin.H{
			"userId": member.UserID.String(), "username": member.Username,
			"avatarUrl": member.AvatarURL, "role": member.Role, "joinedAt": isoValue(member.JoinedAt),
		})
	}
	return gin.H{
		"id": item.ID.String(), "campaignKey": item.CampaignKey, "code": item.Code,
		"ownerId": item.OwnerID.String(), "status": item.Status,
		"targetMembers": item.TargetMembers, "memberCount": len(members),
		"rewardCents": item.RewardCents, "expiresAt": isoValue(item.ExpiresAt),
		"completedAt": iso(item.CompletedAt), "createdAt": isoValue(item.CreatedAt),
		"members": members,
	}
}

func (s *Server) adminGrowthGroups(c *gin.Context, _ *store.User) {
	campaignKey := strings.TrimSpace(c.Query("campaignKey"))
	if campaignKey == "" {
		cfg, err := growth.LoadConfig(c.Request.Context(), s.St.Pool)
		if err != nil {
			fail(c, err)
			return
		}
		campaignKey = cfg.GroupCampaignKey
	}
	if len(campaignKey) < 2 || len(campaignKey) > 64 {
		fail(c, apperr.E("validation_error", "campaignKey: 长度须在 2-64 之间", 422))
		return
	}

	summary, items, err := store.GetGrowthGroupAdminOverview(c.Request.Context(), s.St.Pool, campaignKey, 12)
	if err != nil {
		fail(c, err)
		return
	}
	rows := make([]gin.H, 0, len(items))
	for _, item := range items {
		rows = append(rows, gin.H{
			"id": item.ID.String(), "code": item.Code,
			"owner":  gin.H{"id": item.OwnerID.String(), "username": item.OwnerUsername, "avatarUrl": item.OwnerAvatarURL},
			"status": item.Status, "targetMembers": item.TargetMembers, "memberCount": item.MemberCount,
			"rewardCents": item.RewardCents, "expiresAt": isoValue(item.ExpiresAt),
			"completedAt": iso(item.CompletedAt), "createdAt": isoValue(item.CreatedAt),
		})
	}
	ok(c, gin.H{
		"campaignKey": campaignKey,
		"summary": gin.H{
			"totalGroups": summary.TotalGroups, "activeGroups": summary.ActiveGroups,
			"completedGroups": summary.CompletedGroups, "expiredGroups": summary.ExpiredGroups,
			"participations": summary.Participations,
		},
		"items": rows,
	})
}

func (s *Server) hydrateGrowthGroup(ctx *gin.Context, item *store.GrowthGroup) (*store.GrowthGroup, error) {
	if item == nil {
		return nil, nil
	}
	members, err := store.ListGrowthGroupMembers(ctx.Request.Context(), s.St.Pool, item.ID)
	if err != nil {
		return nil, err
	}
	item.Members = members
	return item, nil
}

func (s *Server) myGrowthPrograms(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	cfg, err := growth.LoadConfig(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	group, err := store.FindUserGrowthGroup(ctx, s.St.Pool, cfg.GroupCampaignKey, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	group, err = s.hydrateGrowthGroup(c, group)
	if err != nil {
		fail(c, err)
		return
	}
	now := time.Now().UTC()
	monthUnits, err := store.CountSucceededTaskOutputsSince(ctx, s.St.Pool, user.ID, growth.MonthStart(now))
	if err != nil {
		fail(c, err)
		return
	}
	campaignOrdinal, err := store.GrowthCampaignOrdinal(ctx, s.St.Pool, cfg.GroupCampaignKey)
	if err != nil {
		fail(c, err)
		return
	}
	failureClaims, err := store.CountLedgerEntriesSince(ctx, s.St.Pool, user.ID, "task_failure_bonus", growth.DayStart(now))
	if err != nil {
		fail(c, err)
		return
	}
	milestones := make([]gin.H, 0, len(cfg.UsageMilestones))
	for _, milestone := range cfg.UsageMilestones {
		milestones = append(milestones, gin.H{
			"units": milestone.Units, "rewardCents": milestone.RewardCents,
			"achieved": monthUnits >= milestone.Units,
		})
	}
	ok(c, gin.H{
		"programs": growthProgramMeta,
		"group":    growthGroupDict(group),
		"rules": gin.H{
			"groupEnabled": cfg.GroupEnabled, "groupCampaignKey": cfg.GroupCampaignKey,
			"groupCampaignOrdinal": campaignOrdinal,
			"groupTargetMembers": cfg.GroupTargetMembers, "groupRewardCents": cfg.GroupRewardCents,
			"groupDurationHours":  cfg.GroupDurationHours,
			"failureBonusEnabled": cfg.FailureBonusEnabled, "failureBonusCents": cfg.FailureBonusCents,
			"failureBonusDailyLimit": cfg.FailureBonusDailyLimit, "failureClaimsToday": failureClaims,
			"usageRewardsEnabled": cfg.UsageRewardsEnabled, "usageMilestones": milestones,
			"monthDeliveredUnits":      monthUnits,
			"suggestionRewardMaxCents": cfg.SuggestionRewardMaxCents,
		},
	})
}

func groupCode() string {
	return strings.ToUpper(strings.ReplaceAll(uuid.NewString(), "-", "")[:10])
}

func (s *Server) createGrowthGroup(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var created *store.GrowthGroup
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		cfg, configErr := growth.LoadConfig(ctx, tx)
		if configErr != nil {
			return configErr
		}
		if !cfg.GroupEnabled {
			return apperr.E("growth_group_disabled", "拼团活动当前未开放", 409)
		}
		if err := store.LockGrowthParticipation(ctx, tx, cfg.GroupCampaignKey, user.ID); err != nil {
			return err
		}
		existing, getErr := store.FindUserGrowthGroup(ctx, tx, cfg.GroupCampaignKey, user.ID)
		if getErr != nil {
			return getErr
		}
		if existing != nil {
			return apperr.E("growth_group_exists", "你已参加本期拼团", 409)
		}
		for attempt := 0; attempt < 3; attempt++ {
			created, err = store.InsertGrowthGroup(ctx, tx, cfg.GroupCampaignKey, groupCode(), user.ID,
				cfg.GroupTargetMembers, cfg.GroupRewardCents, time.Now().UTC().Add(time.Duration(cfg.GroupDurationHours)*time.Hour))
			if err == nil || !store.IsUniqueViolation(err, "growth_groups_code_key") {
				break
			}
		}
		if err != nil {
			return err
		}
		return store.InsertGrowthGroupMember(ctx, tx, created.ID, cfg.GroupCampaignKey, user.ID, "owner")
	})
	if err != nil {
		fail(c, err)
		return
	}
	created, err = s.hydrateGrowthGroup(c, created)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, growthGroupDict(created))
}

type joinGrowthGroupIn struct {
	Code string `json:"code"`
}

func (s *Server) joinGrowthGroup(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body joinGrowthGroupIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Code = strings.ToUpper(strings.TrimSpace(body.Code))
	if len(body.Code) < 6 || len(body.Code) > 16 {
		fail(c, apperr.E("validation_error", "code: 拼团码格式不正确", 422))
		return
	}
	ctx := c.Request.Context()
	var joined *store.GrowthGroup
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		cfg, configErr := growth.LoadConfig(ctx, tx)
		if configErr != nil {
			return configErr
		}
		if !cfg.GroupEnabled {
			return apperr.E("growth_group_disabled", "拼团活动当前未开放", 409)
		}
		if err := store.LockGrowthParticipation(ctx, tx, cfg.GroupCampaignKey, user.ID); err != nil {
			return err
		}
		existing, getErr := store.FindUserGrowthGroup(ctx, tx, cfg.GroupCampaignKey, user.ID)
		if getErr != nil {
			return getErr
		}
		if existing != nil {
			return apperr.E("growth_group_exists", "你已参加本期拼团", 409)
		}
		joined, getErr = store.GetGrowthGroupByCodeForUpdate(ctx, tx, cfg.GroupCampaignKey, body.Code)
		if getErr != nil {
			return getErr
		}
		if joined == nil {
			return apperr.E("growth_group_not_found", "拼团码不存在", 404)
		}
		now := time.Now().UTC()
		if joined.Status != "active" || !joined.ExpiresAt.After(now) {
			if joined.Status == "active" {
				_ = store.ExpireGrowthGroup(ctx, tx, joined.ID, now)
			}
			return apperr.E("growth_group_expired", "该拼团已结束", 409)
		}
		count, countErr := store.CountGrowthGroupMembers(ctx, tx, joined.ID)
		if countErr != nil {
			return countErr
		}
		if count >= joined.TargetMembers {
			return apperr.E("growth_group_full", "该拼团人数已满", 409)
		}
		if err := store.InsertGrowthGroupMember(ctx, tx, joined.ID, cfg.GroupCampaignKey, user.ID, "member"); err != nil {
			return err
		}
		count++
		if count < joined.TargetMembers {
			return nil
		}
		completed, completeErr := store.CompleteGrowthGroup(ctx, tx, joined.ID, now)
		if completeErr != nil || !completed {
			return completeErr
		}
		joined.Status = "completed"
		joined.CompletedAt = &now
		members, memberErr := store.ListGrowthGroupMembers(ctx, tx, joined.ID)
		if memberErr != nil {
			return memberErr
		}
		for _, member := range members {
			sourceID := joined.ID.String() + ":" + member.UserID.String()
			reason := fmt.Sprintf("好友拼团完成奖励：%d 积分", joined.RewardCents)
			if _, grantErr := wallet.Grant(ctx, tx, member.UserID, joined.RewardCents, "grant", "growth_group", sourceID, &reason); grantErr != nil {
				return grantErr
			}
			message := fmt.Sprintf("拼团已满员，%d 积分奖励已到账。", joined.RewardCents)
			if notifyErr := store.InsertNotification(ctx, tx, &member.UserID, "reward", "好友拼团成功", &message); notifyErr != nil {
				return notifyErr
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	joined, err = s.hydrateGrowthGroup(c, joined)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, growthGroupDict(joined))
}
