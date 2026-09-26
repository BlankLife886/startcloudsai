package growth

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

type Milestone struct {
	Units       int64 `json:"units"`
	RewardCents int64 `json:"rewardCents"`
}

type Config struct {
	GroupEnabled             bool
	GroupCampaignKey         string
	GroupTargetMembers       int
	GroupRewardCents         int64
	GroupDurationHours       int
	FailureBonusEnabled      bool
	FailureBonusCents        int64
	FailureBonusDailyLimit   int64
	UsageRewardsEnabled      bool
	UsageMilestones          []Milestone
	SuggestionRewardMaxCents int64
}

func readString(ctx context.Context, q store.Q, key string) (string, error) {
	raw, err := settings.Get(ctx, q, key)
	if err != nil {
		return "", err
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", nil
	}
	return strings.TrimSpace(value), nil
}

func LoadConfig(ctx context.Context, q store.Q) (Config, error) {
	groupEnabled, err := settings.GetBool(ctx, q, "growth_group_enabled")
	if err != nil {
		return Config{}, err
	}
	campaignKey, err := readString(ctx, q, "growth_group_campaign_key")
	if err != nil {
		return Config{}, err
	}
	target, err := settings.GetInt(ctx, q, "growth_group_target_members")
	if err != nil {
		return Config{}, err
	}
	groupReward, err := settings.GetInt(ctx, q, "growth_group_reward_cents")
	if err != nil {
		return Config{}, err
	}
	duration, err := settings.GetInt(ctx, q, "growth_group_duration_hours")
	if err != nil {
		return Config{}, err
	}
	failureEnabled, err := settings.GetBool(ctx, q, "growth_failure_bonus_enabled")
	if err != nil {
		return Config{}, err
	}
	failureBonus, err := settings.GetInt(ctx, q, "growth_failure_bonus_cents")
	if err != nil {
		return Config{}, err
	}
	failureLimit, err := settings.GetInt(ctx, q, "growth_failure_bonus_daily_limit")
	if err != nil {
		return Config{}, err
	}
	usageEnabled, err := settings.GetBool(ctx, q, "growth_usage_rewards_enabled")
	if err != nil {
		return Config{}, err
	}
	rawMilestones, err := settings.Get(ctx, q, "growth_usage_milestones")
	if err != nil {
		return Config{}, err
	}
	milestones := []Milestone{}
	_ = json.Unmarshal(rawMilestones, &milestones)
	cleaned := milestones[:0]
	for _, milestone := range milestones {
		if milestone.Units > 0 && milestone.RewardCents > 0 {
			cleaned = append(cleaned, milestone)
		}
	}
	sort.Slice(cleaned, func(i, j int) bool { return cleaned[i].Units < cleaned[j].Units })
	suggestionMax, err := settings.GetInt(ctx, q, "suggestion_reward_max_cents")
	if err != nil {
		return Config{}, err
	}
	if campaignKey == "" {
		campaignKey = "launch-2026"
	}
	return Config{
		GroupEnabled: groupEnabled, GroupCampaignKey: campaignKey,
		GroupTargetMembers: int(max(2, min(target, 10))), GroupRewardCents: max(groupReward, 0),
		GroupDurationHours:  int(max(1, min(duration, 24*30))),
		FailureBonusEnabled: failureEnabled, FailureBonusCents: max(failureBonus, 0),
		FailureBonusDailyLimit: max(failureLimit, 0), UsageRewardsEnabled: usageEnabled,
		UsageMilestones:          cleaned,
		SuggestionRewardMaxCents: max(suggestionMax, 0),
	}, nil
}

func shanghaiLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*60*60)
	}
	return location
}

func DayStart(now time.Time) time.Time {
	local := now.In(shanghaiLocation())
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location()).UTC()
}

func MonthStart(now time.Time) time.Time {
	local := now.In(shanghaiLocation())
	return time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, local.Location()).UTC()
}

func ApplyTaskFailureCompensation(ctx context.Context, q store.Q, task *store.Task, errorCode string, now time.Time) error {
	if task == nil || task.CostCents <= 0 || errorCode == "admin_force_failed" {
		return nil
	}
	cfg, err := LoadConfig(ctx, q)
	if err != nil || !cfg.FailureBonusEnabled || cfg.FailureBonusCents <= 0 || cfg.FailureBonusDailyLimit <= 0 {
		return err
	}
	sourceID := task.ID.String()
	existing, err := store.GetLedgerEntry(ctx, q, "grant", "task_failure_bonus", sourceID)
	if err != nil || existing != nil {
		return err
	}
	count, err := store.CountLedgerEntriesSince(ctx, q, task.UserID, "task_failure_bonus", DayStart(now))
	if err != nil || count >= cfg.FailureBonusDailyLimit {
		return err
	}
	reason := fmt.Sprintf("生成服务失败补偿：%d 积分", cfg.FailureBonusCents)
	if _, err := wallet.Grant(ctx, q, task.UserID, cfg.FailureBonusCents, "grant", "task_failure_bonus", sourceID, &reason); err != nil {
		return err
	}
	message := fmt.Sprintf("任务费用已全部退回，另补偿 %d 积分；每日最多补偿 %d 次。", cfg.FailureBonusCents, cfg.FailureBonusDailyLimit)
	return store.InsertNotification(ctx, q, &task.UserID, "reward", "生成失败补偿已到账", &message)
}

func ApplyTaskSuccessMilestones(ctx context.Context, q store.Q, task *store.Task, outputCount int, now time.Time) error {
	if task == nil || outputCount <= 0 {
		return nil
	}
	cfg, err := LoadConfig(ctx, q)
	if err != nil || !cfg.UsageRewardsEnabled || len(cfg.UsageMilestones) == 0 {
		return err
	}
	monthStart := MonthStart(now)
	units, err := store.CountSucceededTaskOutputsSince(ctx, q, task.UserID, monthStart)
	if err != nil {
		return err
	}
	monthKey := monthStart.In(shanghaiLocation()).Format("2006-01")
	for _, milestone := range cfg.UsageMilestones {
		if units < milestone.Units {
			break
		}
		sourceID := fmt.Sprintf("%s:%s:%d", task.UserID, monthKey, milestone.Units)
		existing, getErr := store.GetLedgerEntry(ctx, q, "grant", "usage_milestone", sourceID)
		if getErr != nil {
			return getErr
		}
		if existing != nil {
			continue
		}
		reason := fmt.Sprintf("%s 月累计交付 %d 张奖励", monthKey, milestone.Units)
		if _, grantErr := wallet.Grant(ctx, q, task.UserID, milestone.RewardCents, "grant", "usage_milestone", sourceID, &reason); grantErr != nil {
			return grantErr
		}
		message := fmt.Sprintf("本月累计交付达到 %d 张，奖励 %d 积分已到账。", milestone.Units, milestone.RewardCents)
		if notifyErr := store.InsertNotification(ctx, q, &task.UserID, "reward", "创作里程碑达成", &message); notifyErr != nil {
			return notifyErr
		}
	}
	return nil
}
