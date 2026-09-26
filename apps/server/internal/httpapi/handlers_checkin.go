package httpapi

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

type checkinCampaignConfig struct {
	Enabled bool
	Title   string
	Rewards []int64
}

var checkinLocation = func() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("Asia/Shanghai", 8*60*60)
	}
	return location
}()

func checkinDateAt(at time.Time) string {
	return at.In(checkinLocation).Format("2006-01-02")
}

func addCheckinDays(date string, days int) string {
	parsed, err := time.ParseInLocation("2006-01-02", date, checkinLocation)
	if err != nil {
		return date
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02")
}

func checkinMonthRange(date string) (string, string, string) {
	parsed, err := time.ParseInLocation("2006-01-02", date, checkinLocation)
	if err != nil {
		parsed = time.Now().In(checkinLocation)
	}
	start := time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, checkinLocation)
	next := start.AddDate(0, 1, 0)
	return start.Format("2006-01-02"), next.Format("2006-01-02"), start.Format("2006-01")
}

func (s *Server) loadCheckinCampaign(ctx *gin.Context) (checkinCampaignConfig, error) {
	config := checkinCampaignConfig{
		Enabled: true,
		Title:   "连续签到领创作积分",
		Rewards: []int64{10, 15, 20, 25, 30, 40, 80},
	}
	enabled, err := settings.GetBool(ctx.Request.Context(), s.St.Pool, "checkin_enabled")
	if err != nil {
		return config, err
	}
	config.Enabled = enabled
	titleRaw, err := settings.Get(ctx.Request.Context(), s.St.Pool, "checkin_campaign_title")
	if err != nil {
		return config, err
	}
	if titleRaw != nil {
		_ = json.Unmarshal(titleRaw, &config.Title)
	}
	rewardsRaw, err := settings.Get(ctx.Request.Context(), s.St.Pool, "checkin_rewards")
	if err != nil {
		return config, err
	}
	var rewards []int64
	if rewardsRaw != nil && json.Unmarshal(rewardsRaw, &rewards) == nil && len(rewards) == 7 {
		config.Rewards = rewards
	}
	return config, nil
}

func checkinRecordDict(item *store.DailyCheckin) gin.H {
	if item == nil {
		return nil
	}
	return gin.H{
		"id":          item.ID.String(),
		"date":        item.CheckinDate.Format("2006-01-02"),
		"streak":      item.Streak,
		"cycleDay":    item.CycleDay,
		"rewardCents": item.RewardCents,
		"createdAt":   isoValue(item.CreatedAt),
	}
}

func rewardPreview(rewards []int64) []gin.H {
	items := make([]gin.H, 0, len(rewards))
	for index, reward := range rewards {
		items = append(items, gin.H{
			"day": index + 1, "rewardCents": reward, "milestone": index == len(rewards)-1,
		})
	}
	return items
}

func (s *Server) checkinState(c *gin.Context, config checkinCampaignConfig, claimedReward int64, alreadyChecked bool) (gin.H, error) {
	user, err := s.requireUser(c)
	if err != nil {
		return nil, err
	}
	ctx := c.Request.Context()
	today := checkinDateAt(time.Now())
	yesterday := addCheckinDays(today, -1)
	monthStart, nextMonthStart, month := checkinMonthRange(today)

	todayRecord, err := store.GetDailyCheckin(ctx, s.St.Pool, user.ID, today)
	if err != nil {
		return nil, err
	}
	latest, err := store.GetLatestDailyCheckin(ctx, s.St.Pool, user.ID)
	if err != nil {
		return nil, err
	}
	currentStreak := 0
	if todayRecord != nil {
		currentStreak = todayRecord.Streak
	} else if latest != nil && latest.CheckinDate.Format("2006-01-02") == yesterday {
		currentStreak = latest.Streak
	}
	nextStreak := 1
	if currentStreak > 0 {
		nextStreak = currentStreak + 1
	}
	claimCycleDay := ((currentStreak) % 7) + 1
	if todayRecord != nil {
		claimCycleDay = todayRecord.CycleDay
	}
	nextCycleDay := ((nextStreak - 1) % 7) + 1
	if todayRecord == nil {
		nextCycleDay = (currentStreak % 7) + 1
	}
	claimReward := config.Rewards[claimCycleDay-1]
	if todayRecord != nil {
		claimReward = todayRecord.RewardCents
		nextCycleDay = (todayRecord.Streak % 7) + 1
	}

	monthRecords, err := store.ListMonthlyDailyCheckins(ctx, s.St.Pool, user.ID, monthStart, nextMonthStart)
	if err != nil {
		return nil, err
	}
	monthReward, err := store.SumMonthlyDailyCheckinRewards(ctx, s.St.Pool, user.ID, monthStart, nextMonthStart)
	if err != nil {
		return nil, err
	}
	totalCheckins, err := store.CountDailyCheckins(ctx, s.St.Pool, user.ID)
	if err != nil {
		return nil, err
	}
	walletState, err := store.GetWallet(ctx, s.St.Pool, user.ID)
	if err != nil {
		return nil, err
	}
	calendar := make([]gin.H, 0, len(monthRecords))
	for _, item := range monthRecords {
		calendar = append(calendar, checkinRecordDict(item))
	}
	state := gin.H{
		"enabled":            config.Enabled,
		"campaignTitle":      config.Title,
		"today":              today,
		"todayChecked":       todayRecord != nil,
		"todayRecord":        checkinRecordDict(todayRecord),
		"currentStreak":      currentStreak,
		"claimCycleDay":      claimCycleDay,
		"claimRewardCents":   claimReward,
		"nextCycleDay":       nextCycleDay,
		"nextRewardCents":    config.Rewards[nextCycleDay-1],
		"rewards":            rewardPreview(config.Rewards),
		"month":              month,
		"monthRecords":       calendar,
		"monthRewardCents":   monthReward,
		"totalCheckins":      totalCheckins,
		"claimedRewardCents": claimedReward,
		"alreadyChecked":     alreadyChecked,
	}
	for key, value := range walletDict(walletState) {
		state[key] = value
	}
	return state, nil
}

func (s *Server) myCheckinState(c *gin.Context) {
	if _, err := s.requireUser(c); err != nil {
		fail(c, err)
		return
	}
	config, err := s.loadCheckinCampaign(c)
	if err != nil {
		fail(c, err)
		return
	}
	state, err := s.checkinState(c, config, 0, false)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, state)
}

func (s *Server) claimDailyCheckin(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	config, err := s.loadCheckinCampaign(c)
	if err != nil {
		fail(c, err)
		return
	}
	if !config.Enabled {
		fail(c, apperr.E("checkin_campaign_inactive", "签到活动暂未开放", 409))
		return
	}

	ctx := c.Request.Context()
	today := checkinDateAt(time.Now())
	yesterday := addCheckinDays(today, -1)
	claimedReward := int64(0)
	alreadyChecked := false
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if lockErr := store.LockDailyCheckinUser(ctx, tx, user.ID); lockErr != nil {
			return lockErr
		}
		existing, getErr := store.GetDailyCheckin(ctx, tx, user.ID, today)
		if getErr != nil {
			return getErr
		}
		if existing != nil {
			alreadyChecked = true
			claimedReward = existing.RewardCents
			return nil
		}
		latest, getErr := store.GetLatestDailyCheckin(ctx, tx, user.ID)
		if getErr != nil {
			return getErr
		}
		streak := 1
		if latest != nil && latest.CheckinDate.Format("2006-01-02") == yesterday {
			streak = latest.Streak + 1
		}
		cycleDay := ((streak - 1) % 7) + 1
		claimedReward = config.Rewards[cycleDay-1]
		if _, insertErr := store.InsertDailyCheckin(ctx, tx, user.ID, today, streak, cycleDay, claimedReward); insertErr != nil {
			return insertErr
		}
		reason := fmt.Sprintf("每日签到第 %d 天奖励", cycleDay)
		_, grantErr := wallet.Grant(
			ctx, tx, user.ID, claimedReward, "grant", "daily_checkin", user.ID.String()+":"+today, &reason,
		)
		return grantErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	state, err := s.checkinState(c, config, claimedReward, alreadyChecked)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, state)
}
