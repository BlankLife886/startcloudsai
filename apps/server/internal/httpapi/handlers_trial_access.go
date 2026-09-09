package httpapi

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/redemption"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
)

const (
	maxTrialGrantCents       int64 = 10_000_000
	maxTrialOccupationCount        = 4
	maxTrialOccupationLength       = 240
	minTrialCampaignLeadTime       = 5 * time.Minute
	maxTrialCampaignDuration       = 365 * 24 * time.Hour
)

type trialAccessSubmitIn struct {
	Occupation string `json:"occupation"`
	Reason     string `json:"reason"`
}

type trialAccessReviewIn struct {
	Status     string  `json:"status"`
	GrantCents *int64  `json:"grantCents"`
	ExpiresAt  *string `json:"expiresAt"`
	ReviewNote *string `json:"reviewNote"`
}

type trialCampaignIn struct {
	Title         string   `json:"title"`
	FeatureKeys   []string `json:"featureKeys"`
	AccessMode    string   `json:"accessMode"`
	Capacity      int64    `json:"capacity"`
	DisplayOffset int64    `json:"displayOffset"`
	ExpiresAt     string   `json:"expiresAt"`
	expiresAt     time.Time
}

type trialCampaignConfig struct {
	ID            uuid.UUID
	Title         string
	Features      []trialfeature.Feature
	AccessMode    string
	Capacity      int64
	DisplayOffset int64
	Status        string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	ActivatedAt   *time.Time
	ClosedAt      *time.Time
	ExpiresAt     time.Time
}

func (config trialCampaignConfig) featureKeys() []string {
	keys := make([]string, 0, len(config.Features))
	for _, feature := range config.Features {
		keys = append(keys, feature.Key)
	}
	return keys
}

func trialFeaturesForKeys(keys []string) []trialfeature.Feature {
	features := make([]trialfeature.Feature, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		feature, exists := trialfeature.Get(key)
		if !exists {
			continue
		}
		seen[key] = struct{}{}
		features = append(features, feature)
	}
	return features
}

func trialFeatureLabels(features []trialfeature.Feature) string {
	labels := make([]string, 0, len(features))
	for _, feature := range features {
		labels = append(labels, feature.Label)
	}
	return strings.Join(labels, "、")
}

func normalizeTrialCampaignInput(body *trialCampaignIn) error {
	body.Title = strings.TrimSpace(body.Title)
	if length := utf8.RuneCountInString(body.Title); length < 2 || length > 60 {
		return apperr.E("validation_error", "title: 活动标题须为 2-60 个字符", 422)
	}
	if len(body.FeatureKeys) < 1 || len(body.FeatureKeys) > len(trialfeature.List()) {
		return apperr.E("validation_error", "featureKeys: 请选择 1-6 个真实功能", 422)
	}
	seen := make(map[string]struct{}, len(body.FeatureKeys))
	for index, key := range body.FeatureKeys {
		key = strings.TrimSpace(key)
		if _, exists := trialfeature.Get(key); !exists {
			return apperr.E("validation_error", "featureKeys: 包含不存在的功能", 422)
		}
		if _, duplicate := seen[key]; duplicate {
			return apperr.E("validation_error", "featureKeys: 功能不能重复", 422)
		}
		seen[key] = struct{}{}
		body.FeatureKeys[index] = key
	}
	body.AccessMode = strings.TrimSpace(body.AccessMode)
	if body.AccessMode != "credit_only" && body.AccessMode != "restricted" {
		return apperr.E("validation_error", "accessMode: 仅支持 credit_only 或 restricted", 422)
	}
	if body.Capacity < 1 || body.Capacity > 1_000_000 {
		return apperr.E("validation_error", "capacity: 须在 1-1000000 之间", 422)
	}
	if body.DisplayOffset < -1_000_000 || body.DisplayOffset > 1_000_000 {
		return apperr.E("validation_error", "displayOffset: 须在 -1000000 到 1000000 之间", 422)
	}
	body.ExpiresAt = strings.TrimSpace(body.ExpiresAt)
	if body.ExpiresAt == "" {
		return apperr.E("validation_error", "expiresAt: 必须设置活动截止时间", 422)
	}
	expiresAt, err := parseDatetime(body.ExpiresAt)
	if err != nil {
		return apperr.E("validation_error", "expiresAt: 无效的时间格式", 422)
	}
	now := time.Now().UTC()
	expiresAt = expiresAt.UTC()
	if expiresAt.Before(now.Add(minTrialCampaignLeadTime)) {
		return apperr.E("validation_error", "expiresAt: 截止时间至少须晚于当前时间 5 分钟", 422)
	}
	if expiresAt.After(now.Add(maxTrialCampaignDuration)) {
		return apperr.E("validation_error", "expiresAt: 单期活动最长为 365 天", 422)
	}
	body.expiresAt = expiresAt
	return nil
}

func trialCampaignConfigFromStore(item *store.TrialCampaign) trialCampaignConfig {
	if item == nil {
		return trialCampaignConfig{}
	}
	return trialCampaignConfig{
		ID:            item.ID,
		Title:         item.Title,
		Features:      trialFeaturesForKeys(item.FeatureKeys),
		AccessMode:    item.AccessMode,
		Capacity:      item.Capacity,
		DisplayOffset: item.DisplayOffset,
		Status:        item.Status,
		CreatedAt:     item.CreatedAt,
		UpdatedAt:     item.UpdatedAt,
		ActivatedAt:   item.ActivatedAt,
		ClosedAt:      item.ClosedAt,
		ExpiresAt:     item.ExpiresAt,
	}
}

func loadActiveTrialCampaignConfig(ctx context.Context, q store.Q) (*trialCampaignConfig, error) {
	item, err := store.GetActiveTrialCampaign(ctx, q)
	if err != nil || item == nil {
		return nil, err
	}
	config := trialCampaignConfigFromStore(item)
	if len(config.Features) == 0 {
		return nil, fmt.Errorf("active trial campaign %s has no valid features", item.ID)
	}
	return &config, nil
}

func trialFeatureDict(feature trialfeature.Feature) gin.H {
	return gin.H{
		"key": feature.Key, "label": feature.Label, "route": feature.Route,
		"taskTypes": feature.TaskTypes, "runtimeKey": feature.RuntimeKey, "icon": feature.Icon,
	}
}

func trialCampaignDict(config trialCampaignConfig, actualApplied, nextApplicationNo int64) gin.H {
	now := time.Now().UTC()
	displayApplied := actualApplied + config.DisplayOffset
	if displayApplied < 0 {
		displayApplied = 0
	}
	if displayApplied > config.Capacity {
		displayApplied = config.Capacity
	}
	remaining := config.Capacity - displayApplied
	if remaining < 0 {
		remaining = 0
	}
	nextPosition := nextApplicationNo + config.DisplayOffset
	if nextPosition < 1 {
		nextPosition = 1
	}
	features := make([]gin.H, 0, len(config.Features))
	for _, feature := range config.Features {
		features = append(features, trialFeatureDict(feature))
	}
	primaryFeature := config.Features[0]
	remainingSeconds := int64(config.ExpiresAt.Sub(now).Seconds())
	if remainingSeconds < 0 {
		remainingSeconds = 0
	}
	return gin.H{
		"id":               config.ID.String(),
		"enabled":          config.Status == "active" && config.ExpiresAt.After(now),
		"status":           config.Status,
		"expired":          !config.ExpiresAt.After(now),
		"expiresAt":        isoValue(config.ExpiresAt),
		"remainingSeconds": remainingSeconds,
		"title":            config.Title,
		"features":         features,
		"featureKeys":      config.featureKeys(),
		"feature":          trialFeatureDict(primaryFeature),
		"featureKey":       primaryFeature.Key,
		"featureLabel":     primaryFeature.Label,
		"featureRoute":     primaryFeature.Route,
		"accessMode":       config.AccessMode,
		"capacity":         config.Capacity,
		"displayApplied":   displayApplied,
		"remaining":        remaining,
		"full":             config.Capacity <= 0 || displayApplied >= config.Capacity,
		"nextPosition":     nextPosition,
	}
}

func trialCampaignAdminDict(config trialCampaignConfig, actualApplied, nextApplicationNo int64) gin.H {
	result := trialCampaignDict(config, actualApplied, nextApplicationNo)
	result["actualApplied"] = actualApplied
	result["displayOffset"] = config.DisplayOffset
	result["createdAt"] = isoValue(config.CreatedAt)
	result["updatedAt"] = isoValue(config.UpdatedAt)
	result["activatedAt"] = iso(config.ActivatedAt)
	result["closedAt"] = iso(config.ClosedAt)
	return result
}

func trialApplicationPosition(config trialCampaignConfig, applicationNo int64) int64 {
	position := applicationNo + config.DisplayOffset
	if position < 1 {
		return 1
	}
	return position
}

func (s *Server) trialAccessCampaign(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := store.CloseExpiredTrialCampaigns(ctx, s.St.Pool, time.Now().UTC()); err != nil {
		fail(c, err)
		return
	}
	config, err := loadActiveTrialCampaignConfig(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if config == nil {
		ok(c, gin.H{"campaign": nil})
		return
	}
	count, nextApplicationNo, err := store.TrialCampaignApplicationStats(ctx, s.St.Pool, config.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"campaign": trialCampaignDict(*config, count, nextApplicationNo)})
}

func normalizeTrialAccessInput(body *trialAccessSubmitIn) error {
	body.Occupation = strings.TrimSpace(body.Occupation)
	body.Reason = strings.TrimSpace(body.Reason)
	occupationLength := utf8.RuneCountInString(body.Occupation)
	if occupationLength < 2 || occupationLength > maxTrialOccupationLength {
		return apperr.E("validation_error", "occupation: 职业须为 2-240 个字符", 422)
	}
	occupationParts := strings.FieldsFunc(body.Occupation, func(r rune) bool {
		return r == '、' || r == ';'
	})
	if len(occupationParts) == 0 || len(occupationParts) > maxTrialOccupationCount {
		return apperr.E("validation_error", "occupation: 最多选择 4 个职业", 422)
	}
	seenOccupations := make(map[string]struct{}, len(occupationParts))
	for _, occupation := range occupationParts {
		occupation = strings.TrimSpace(occupation)
		length := utf8.RuneCountInString(occupation)
		if length < 2 || length > 80 {
			return apperr.E("validation_error", "occupation: 每个职业须为 2-80 个字符", 422)
		}
		key := strings.ToLower(occupation)
		if _, exists := seenOccupations[key]; exists {
			return apperr.E("validation_error", "occupation: 职业不能重复", 422)
		}
		seenOccupations[key] = struct{}{}
	}
	reasonLength := utf8.RuneCountInString(body.Reason)
	if reasonLength < 10 || reasonLength > 1000 {
		return apperr.E("validation_error", "reason: 申请理由须为 10-1000 个字符", 422)
	}
	return nil
}

func trialAccessApplicationDict(item *store.TrialAccessApplication, includeUser bool) gin.H {
	if item == nil {
		return nil
	}
	var reviewedBy *string
	if item.ReviewedBy != nil {
		value := item.ReviewedBy.String()
		reviewedBy = &value
	}
	featureKeys := item.FeatureKeys
	if len(featureKeys) == 0 {
		featureKeys = []string{item.FeatureKey}
	}
	features := make([]gin.H, 0, len(featureKeys))
	activeFeatureKeys := make(map[string]struct{}, len(item.ActiveFeatureKeys))
	for _, key := range item.ActiveFeatureKeys {
		activeFeatureKeys[key] = struct{}{}
	}
	for _, key := range featureKeys {
		feature := trialFeatureDictForKey(key)
		_, active := activeFeatureKeys[key]
		feature["entitlementActive"] = active
		features = append(features, feature)
	}
	entitlementActive := len(featureKeys) > 0 && len(activeFeatureKeys) == len(featureKeys)
	rewardStatus := item.CodeStatus
	if rewardStatus != nil && *rewardStatus == "active" && item.CodeExpiresAt != nil && !item.CodeExpiresAt.After(time.Now().UTC()) {
		expired := "expired"
		rewardStatus = &expired
	}
	result := gin.H{
		"id":                     item.ID.String(),
		"campaignId":             item.CampaignID.String(),
		"applicationNo":          item.ApplicationNo,
		"occupation":             item.Occupation,
		"reason":                 item.Reason,
		"status":                 item.Status,
		"reviewNote":             item.ReviewNote,
		"reviewedBy":             reviewedBy,
		"reviewedAt":             iso(item.ReviewedAt),
		"createdAt":              isoValue(item.CreatedAt),
		"updatedAt":              isoValue(item.UpdatedAt),
		"rewardCents":            item.GrantCents,
		"rewardExpiresAt":        iso(item.CodeExpiresAt),
		"rewardStatus":           rewardStatus,
		"rewardClaimedAt":        iso(item.CodeRedeemedAt),
		"features":               features,
		"featureKeys":            featureKeys,
		"feature":                features[0],
		"featureKey":             featureKeys[0],
		"entitlementActive":      entitlementActive,
		"entitlementFeatureKeys": item.ActiveFeatureKeys,
	}
	if includeUser {
		result["userId"] = item.UserID.String()
		result["userEmail"] = item.UserEmail
		result["username"] = item.Username
	}
	return result
}

func trialFeatureDictForKey(key string) gin.H {
	if feature, exists := trialfeature.Get(key); exists {
		return trialFeatureDict(feature)
	}
	return gin.H{"key": key, "label": key, "route": "", "taskTypes": []string{}}
}

func (s *Server) redeemTrialAccessReward(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	campaign, err := store.GetActiveTrialCampaign(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if campaign == nil {
		fail(c, apperr.E("trial_campaign_closed", "当前没有开放中的体验活动", 409))
		return
	}
	item, err := store.GetTrialAccessApplicationByUserAndCampaign(ctx, s.St.Pool, user.ID, campaign.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("trial_application_not_found", "请先提交体验资格申请", 404))
		return
	}
	if item.Status != "approved" || item.RedemptionCodeID == nil || item.RedemptionCode == nil {
		fail(c, apperr.E("trial_reward_not_ready", "体验积分暂未可领取", 409))
		return
	}

	respondAlreadyClaimed := func() bool {
		code, codeErr := store.GetRedemptionCode(ctx, s.St.Pool, *item.RedemptionCodeID)
		if codeErr != nil {
			fail(c, codeErr)
			return true
		}
		if code == nil || code.Status != "redeemed" || code.RedeemedBy == nil || *code.RedeemedBy != user.ID {
			return false
		}
		wallet, walletErr := store.GetWallet(ctx, s.St.Pool, user.ID)
		if walletErr != nil {
			fail(c, walletErr)
			return true
		}
		response := walletDict(wallet)
		response["grantCents"] = code.GrantCents
		response["alreadyClaimed"] = true
		response["features"] = trialAccessApplicationDict(item, false)["features"]
		response["feature"] = trialFeatureDictForKey(item.FeatureKey)
		ok(c, response)
		return true
	}

	if item.CodeStatus != nil && *item.CodeStatus == "redeemed" {
		if respondAlreadyClaimed() {
			return
		}
		fail(c, apperr.E("trial_reward_already_claimed", "体验积分已领取", 409))
		return
	}

	ledgerReason := "体验资格积分领取"
	redeemed, _, err := redemption.RedeemTrialWithReason(
		ctx, s.St, user.ID, *item.RedemptionCode, item.FeatureKey, campaign.ID, &ledgerReason,
	)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Code == "code_redeemed" && respondAlreadyClaimed() {
			return
		}
		fail(c, err)
		return
	}

	features := trialFeaturesForKeys(item.FeatureKeys)
	message := fmt.Sprintf("领取成功，%d 积分已经到账，可用于「%s」。", redeemed.GrantCents, trialFeatureLabels(features))
	if notifyErr := store.InsertNotification(ctx, s.St.Pool, &user.ID, "trial_access", "体验积分已到账", &message); notifyErr != nil {
		log.Printf("notify trial reward %s: %v", redeemed.ID, notifyErr)
	}
	wallet, err := store.GetWallet(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	response := walletDict(wallet)
	response["grantCents"] = redeemed.GrantCents
	response["features"] = trialAccessApplicationDict(item, false)["features"]
	response["feature"] = trialFeatureDictForKey(item.FeatureKey)
	response["alreadyClaimed"] = false
	respondCreated(c, response)
}

func (s *Server) myTrialAccessApplication(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	campaign, err := store.GetActiveTrialCampaign(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if campaign == nil {
		ok(c, gin.H{"application": nil})
		return
	}
	item, err := store.GetTrialAccessApplicationByUserAndCampaign(ctx, s.St.Pool, user.ID, campaign.ID)
	if err != nil {
		fail(c, err)
		return
	}
	config := trialCampaignConfigFromStore(campaign)
	application := trialAccessApplicationDict(item, false)
	if item != nil {
		application["position"] = trialApplicationPosition(config, item.ApplicationNo)
	}
	ok(c, gin.H{"application": application})
}

func (s *Server) submitTrialAccessApplication(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body trialAccessSubmitIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := normalizeTrialAccessInput(&body); err != nil {
		fail(c, err)
		return
	}

	ctx := c.Request.Context()
	var item *store.TrialAccessApplication
	var config trialCampaignConfig
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if lockErr := store.LockTrialCampaignLifecycleShared(ctx, tx); lockErr != nil {
			return lockErr
		}
		if lockErr := store.LockTrialAccessCapacity(ctx, tx); lockErr != nil {
			return lockErr
		}
		activeConfig, configErr := loadActiveTrialCampaignConfig(ctx, tx)
		if configErr != nil {
			return configErr
		}
		if activeConfig == nil {
			return apperr.E("trial_campaign_closed", "本期体验活动已结束", 409)
		}
		config = *activeConfig

		existing, getErr := store.GetTrialAccessApplicationByUserAndCampaign(ctx, tx, user.ID, config.ID)
		if getErr != nil {
			return getErr
		}
		switch {
		case existing == nil:
			actualApplied, countErr := store.CountAllTrialAccessApplications(ctx, tx, config.ID)
			if countErr != nil {
				return countErr
			}
			effectiveApplied := actualApplied + config.DisplayOffset
			if effectiveApplied < 0 {
				effectiveApplied = 0
			}
			if config.Capacity <= 0 || effectiveApplied >= config.Capacity {
				return apperr.E("trial_campaign_full", "本期体验名额已申请完", 409)
			}
			applicationNo, numberErr := store.NextTrialAccessApplicationNo(ctx, tx, config.ID)
			if numberErr != nil {
				return numberErr
			}
			item, getErr = store.InsertTrialAccessApplication(
				ctx, tx, user.ID, config.ID, applicationNo, config.featureKeys(), body.Occupation, body.Reason,
			)
			return getErr
		case existing.Status == "pending":
			return apperr.E("trial_application_pending", "体验资格申请正在审核中", 409)
		case existing.Status == "approved":
			return apperr.E("trial_application_approved", "体验资格申请已通过", 409)
		default:
			applicationNo, numberErr := store.NextTrialAccessApplicationNo(ctx, tx, config.ID)
			if numberErr != nil {
				return numberErr
			}
			won, updateErr := store.ReapplyTrialAccessApplication(
				ctx, tx, user.ID, config.ID, applicationNo, config.featureKeys(), body.Occupation, body.Reason, time.Now().UTC(),
			)
			if updateErr != nil {
				return updateErr
			}
			if !won {
				return apperr.E("trial_application_conflict", "申请状态已变化，请刷新后重试", 409)
			}
			item, getErr = store.GetTrialAccessApplicationByUserAndCampaign(ctx, tx, user.ID, config.ID)
			return getErr
		}
	})
	if err != nil {
		fail(c, err)
		return
	}
	emailNotified := false
	if s.Cfg != nil && strings.TrimSpace(s.Cfg.TrialApplicationEmail) != "" && s.smtpConfigured() {
		mailBody := fmt.Sprintf(
			"收到新的体验资格申请。\n\n体验功能：%s\n用户：%s\n邮箱：%s\n职业：%s\n申请理由：\n%s\n\n提交时间：%s\n\n请登录 StarCloudsAI 管理后台，在“体验申请”中审核并设置体验积分。\n",
			trialFeatureLabels(config.Features), user.Username, user.Email, body.Occupation, body.Reason,
			item.CreatedAt.UTC().Format(time.RFC3339),
		)
		if mailErr := s.sendPlainEmail(s.Cfg.TrialApplicationEmail, "StarCloudsAI 新的体验资格申请", mailBody); mailErr != nil {
			log.Printf("send trial access application email %s: %v", item.ID, mailErr)
		} else {
			emailNotified = true
		}
	}
	application := trialAccessApplicationDict(item, false)
	application["position"] = trialApplicationPosition(config, item.ApplicationNo)
	respondCreated(c, gin.H{
		"application":   application,
		"emailNotified": emailNotified,
	})
}

func resolveAdminTrialCampaign(ctx context.Context, q store.Q, rawID string) (*store.TrialCampaign, error) {
	if rawID = strings.TrimSpace(rawID); rawID != "" {
		id, err := uuid.Parse(rawID)
		if err != nil {
			return nil, apperr.E("validation_error", "campaignId: 无效的 UUID", 422)
		}
		return store.GetTrialCampaign(ctx, q, id)
	}
	active, err := store.GetActiveTrialCampaign(ctx, q)
	if err != nil || active != nil {
		return active, err
	}
	items, err := store.ListTrialCampaigns(ctx, q)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func (s *Server) adminTrialAccessApplications(c *gin.Context, _ *store.User) {
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && status != "pending" && status != "approved" && status != "rejected" {
		fail(c, apperr.E("validation_error", "无效的申请状态", 422))
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	if _, err := store.CloseExpiredTrialCampaigns(ctx, s.St.Pool, time.Now().UTC()); err != nil {
		fail(c, err)
		return
	}
	campaign, err := resolveAdminTrialCampaign(ctx, s.St.Pool, c.Query("campaignId"))
	if err != nil {
		fail(c, err)
		return
	}
	if campaign == nil {
		ok(c, gin.H{"items": []gin.H{}, "total": 0, "hasMore": false, "nextCursor": nil, "campaign": nil})
		return
	}
	items, err := store.ListTrialAccessApplications(ctx, s.St.Pool, campaign.ID, status, c.Query("search"), limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountTrialAccessApplications(ctx, s.St.Pool, campaign.ID, status, c.Query("search"))
	if err != nil {
		fail(c, err)
		return
	}
	page := buildPage(items, limit, func(item *store.TrialAccessApplication) gin.H {
		return trialAccessApplicationDict(item, true)
	})
	page["total"] = total
	config := trialCampaignConfigFromStore(campaign)
	actualApplied, nextApplicationNo, err := store.TrialCampaignApplicationStats(ctx, s.St.Pool, campaign.ID)
	if err != nil {
		fail(c, err)
		return
	}
	page["campaign"] = trialCampaignAdminDict(config, actualApplied, nextApplicationNo)
	ok(c, page)
}

func trialFeatureOptions() []gin.H {
	features := trialfeature.List()
	result := make([]gin.H, 0, len(features))
	for _, feature := range features {
		result = append(result, trialFeatureDict(feature))
	}
	return result
}

func (s *Server) adminTrialCampaigns(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	if _, err := store.CloseExpiredTrialCampaigns(ctx, s.St.Pool, time.Now().UTC()); err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListTrialCampaigns(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, trialCampaignAdminDict(
			trialCampaignConfigFromStore(item), item.AppliedCount, item.NextApplicationNo,
		))
	}
	ok(c, gin.H{"items": result, "features": trialFeatureOptions()})
}

func (s *Server) adminCreateTrialCampaign(c *gin.Context, admin *store.User) {
	var body trialCampaignIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := normalizeTrialCampaignInput(&body); err != nil {
		fail(c, err)
		return
	}
	item, err := store.InsertTrialCampaign(
		c.Request.Context(), s.St.Pool, body.Title, body.FeatureKeys, body.AccessMode,
		body.Capacity, body.DisplayOffset, body.expiresAt, admin.ID, time.Now().UTC(),
	)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, trialCampaignAdminDict(trialCampaignConfigFromStore(item), 0, 1))
}

func (s *Server) adminUpdateTrialCampaign(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body trialCampaignIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := normalizeTrialCampaignInput(&body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var item *store.TrialCampaign
	var count int64
	var nextApplicationNo int64
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if lockErr := store.LockTrialCampaignLifecycle(ctx, tx); lockErr != nil {
			return lockErr
		}
		if _, expireErr := store.CloseExpiredTrialCampaigns(ctx, tx, time.Now().UTC()); expireErr != nil {
			return expireErr
		}
		existing, getErr := store.GetTrialCampaignForUpdate(ctx, tx, id)
		if getErr != nil {
			return getErr
		}
		if existing == nil {
			return apperr.E("not_found", "体验活动不存在", 404)
		}
		count, nextApplicationNo, getErr = store.TrialCampaignApplicationStats(ctx, tx, id)
		if getErr != nil {
			return getErr
		}
		if count > 0 && !slices.Equal(existing.FeatureKeys, body.FeatureKeys) {
			return apperr.E("trial_campaign_features_locked", "活动已有申请记录，体验功能不能再修改", 409)
		}
		item, getErr = store.UpdateTrialCampaign(
			ctx, tx, id, body.Title, body.FeatureKeys, body.AccessMode,
			body.Capacity, body.DisplayOffset, body.expiresAt, time.Now().UTC(),
		)
		return getErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, trialCampaignAdminDict(trialCampaignConfigFromStore(item), count, nextApplicationNo))
}

func (s *Server) adminActivateTrialCampaign(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if lockErr := store.LockTrialCampaignLifecycle(ctx, tx); lockErr != nil {
			return lockErr
		}
		now := time.Now().UTC()
		if _, expireErr := store.CloseExpiredTrialCampaigns(ctx, tx, now); expireErr != nil {
			return expireErr
		}
		item, getErr := store.GetTrialCampaignForUpdate(ctx, tx, id)
		if getErr != nil {
			return getErr
		}
		if item == nil {
			return apperr.E("not_found", "体验活动不存在", 404)
		}
		if !item.ExpiresAt.After(now) {
			return apperr.E("trial_campaign_expired", "活动截止时间已过，请先修改截止时间再启用", 409)
		}
		if store.TrialCampaignIsOpen(item, now) {
			return nil
		}
		_, activateErr := store.ActivateTrialCampaign(ctx, tx, id, now)
		return activateErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetTrialCampaign(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	count, nextApplicationNo, err := store.TrialCampaignApplicationStats(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, trialCampaignAdminDict(trialCampaignConfigFromStore(item), count, nextApplicationNo))
}

func (s *Server) adminCloseTrialCampaign(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if lockErr := store.LockTrialCampaignLifecycle(ctx, tx); lockErr != nil {
			return lockErr
		}
		if _, expireErr := store.CloseExpiredTrialCampaigns(ctx, tx, time.Now().UTC()); expireErr != nil {
			return expireErr
		}
		item, getErr := store.GetTrialCampaignForUpdate(ctx, tx, id)
		if getErr != nil {
			return getErr
		}
		if item == nil {
			return apperr.E("not_found", "体验活动不存在", 404)
		}
		if item.Status != "active" {
			return apperr.E("trial_campaign_not_active", "只有启用中的活动可以关闭", 409)
		}
		closed, closeErr := store.CloseTrialCampaign(ctx, tx, id, time.Now().UTC())
		if closeErr != nil {
			return closeErr
		}
		if !closed {
			return apperr.E("trial_campaign_not_active", "活动状态已变化，请刷新后重试", 409)
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetTrialCampaign(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	count, nextApplicationNo, err := store.TrialCampaignApplicationStats(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, trialCampaignAdminDict(trialCampaignConfigFromStore(item), count, nextApplicationNo))
}

func (s *Server) adminDeleteTrialCampaign(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	if _, err := store.CloseExpiredTrialCampaigns(ctx, s.St.Pool, time.Now().UTC()); err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetTrialCampaign(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "体验活动不存在", 404))
		return
	}
	if item.Status == "active" {
		fail(c, apperr.E("trial_campaign_active", "请先关闭活动再删除", 409))
		return
	}
	count, err := store.CountAllTrialAccessApplications(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if count > 0 {
		fail(c, apperr.E("trial_campaign_in_use", "活动已有申请记录，只能关闭不能删除", 409))
		return
	}
	deleted, err := store.DeleteTrialCampaign(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("trial_campaign_in_use", "活动无法删除，请刷新后重试", 409))
		return
	}
	c.Status(204)
}

func normalizeReviewNote(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	note := strings.TrimSpace(*value)
	if note == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(note) > 500 {
		return nil, apperr.E("validation_error", "reviewNote: 不能超过 500 个字符", 422)
	}
	return &note, nil
}

func (s *Server) adminReviewTrialAccessApplication(c *gin.Context, admin *store.User) {
	applicationID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body trialAccessReviewIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Status = strings.TrimSpace(body.Status)
	if body.Status != "approved" && body.Status != "rejected" {
		fail(c, apperr.E("validation_error", "status: 仅支持 approved 或 rejected", 422))
		return
	}
	reviewNote, err := normalizeReviewNote(body.ReviewNote)
	if err != nil {
		fail(c, err)
		return
	}
	if body.Status == "rejected" && reviewNote == nil {
		fail(c, apperr.E("validation_error", "reviewNote: 拒绝申请时必须填写原因", 422))
		return
	}

	var expiresAt *time.Time
	if body.Status == "approved" {
		if body.GrantCents == nil || *body.GrantCents <= 0 || *body.GrantCents > maxTrialGrantCents {
			fail(c, apperr.E("validation_error", "grantCents: 须在 1-10000000 之间", 422))
			return
		}
		expiresAt, err = parseOptDatetime(body.ExpiresAt, "expiresAt")
		if err != nil {
			fail(c, err)
			return
		}
		if expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
			fail(c, apperr.E("validation_error", "expiresAt: 须晚于当前时间", 422))
			return
		}
	}

	ctx := c.Request.Context()
	var generatedCode string
	var reviewErr error
	for attempt := 0; attempt < 3; attempt++ {
		if body.Status == "approved" {
			generatedCode, reviewErr = redemption.NewCode()
			if reviewErr != nil {
				break
			}
		}
		reviewErr = s.St.Tx(ctx, func(tx pgx.Tx) error {
			if lockErr := store.LockTrialCampaignLifecycleShared(ctx, tx); lockErr != nil {
				return lockErr
			}
			item, getErr := store.GetTrialAccessApplicationForUpdate(ctx, tx, applicationID)
			if getErr != nil {
				return getErr
			}
			if item == nil {
				return apperr.E("not_found", "体验资格申请不存在", 404)
			}
			if item.Status != "pending" {
				return apperr.E("trial_application_not_pending", "该申请已经处理", 409)
			}
			campaign, campaignErr := store.GetTrialCampaign(ctx, tx, item.CampaignID)
			if campaignErr != nil {
				return campaignErr
			}
			if !store.TrialCampaignIsOpen(campaign, time.Now().UTC()) {
				return apperr.E("trial_campaign_closed", "活动已关闭，不能继续审核或发放积分", 409)
			}
			now := time.Now().UTC()
			var codeID *uuid.UUID
			if body.Status == "approved" {
				note := "体验资格申请 · " + item.UserEmail
				code, insertErr := store.InsertRedemptionCode(
					ctx, tx, generatedCode, *body.GrantCents,
					"trial-"+redemption.NewBatchID(), &note, expiresAt, admin.ID,
				)
				if insertErr != nil {
					return insertErr
				}
				codeID = &code.ID
			}
			won, updateErr := store.ReviewTrialAccessApplication(
				ctx, tx, applicationID, body.Status, reviewNote, admin.ID, now, codeID,
			)
			if updateErr != nil {
				return updateErr
			}
			if !won {
				return apperr.E("trial_application_not_pending", "该申请已经处理", 409)
			}
			if body.Status == "approved" {
				for _, featureKey := range item.FeatureKeys {
					if entitlementErr := store.GrantTrialFeatureEntitlement(
						ctx, tx, item.UserID, featureKey, item.ID, now,
					); entitlementErr != nil {
						return entitlementErr
					}
				}
			}

			var title, message string
			if body.Status == "approved" {
				title = "体验资格申请已通过"
				message = fmt.Sprintf("好消息，你已获得「%s」体验权限，%d 专属体验积分等待领取。", trialFeatureLabels(trialFeaturesForKeys(item.FeatureKeys)), *body.GrantCents)
			} else {
				title = "体验资格申请未通过"
				message = "审核说明：" + *reviewNote
			}
			return store.InsertNotification(ctx, tx, &item.UserID, "trial_access", title, &message)
		})
		if reviewErr == nil || !store.IsUniqueViolation(reviewErr, "redemption_codes_code_key") {
			break
		}
	}
	if reviewErr != nil {
		fail(c, reviewErr)
		return
	}
	item, err := store.GetTrialAccessApplication(ctx, s.St.Pool, applicationID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, trialAccessApplicationDict(item, true))
}

func (s *Server) adminReissueTrialAccessReward(c *gin.Context, admin *store.User) {
	applicationID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body trialAccessReviewIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.GrantCents == nil || *body.GrantCents <= 0 || *body.GrantCents > maxTrialGrantCents {
		fail(c, apperr.E("validation_error", "grantCents: 须在 1-10000000 之间", 422))
		return
	}
	expiresAt, err := parseOptDatetime(body.ExpiresAt, "expiresAt")
	if err != nil {
		fail(c, err)
		return
	}
	if expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
		fail(c, apperr.E("validation_error", "expiresAt: 须晚于当前时间", 422))
		return
	}
	reviewNote, err := normalizeReviewNote(body.ReviewNote)
	if err != nil {
		fail(c, err)
		return
	}

	ctx := c.Request.Context()
	var reviewErr error
	for attempt := 0; attempt < 3; attempt++ {
		generatedCode, codeErr := redemption.NewCode()
		if codeErr != nil {
			reviewErr = codeErr
			break
		}
		reviewErr = s.St.Tx(ctx, func(tx pgx.Tx) error {
			if lockErr := store.LockTrialCampaignLifecycleShared(ctx, tx); lockErr != nil {
				return lockErr
			}
			item, getErr := store.GetTrialAccessApplicationForUpdate(ctx, tx, applicationID)
			if getErr != nil {
				return getErr
			}
			if item == nil {
				return apperr.E("not_found", "体验资格申请不存在", 404)
			}
			if item.Status != "approved" {
				return apperr.E("trial_application_not_approved", "只有已通过申请可以补发积分", 409)
			}
			campaign, campaignErr := store.GetTrialCampaign(ctx, tx, item.CampaignID)
			if campaignErr != nil {
				return campaignErr
			}
			if !store.TrialCampaignIsOpen(campaign, time.Now().UTC()) {
				return apperr.E("trial_campaign_closed", "活动已关闭，不能补发积分", 409)
			}
			if item.CodeStatus != nil {
				isExpired := *item.CodeStatus == "active" && item.CodeExpiresAt != nil && !item.CodeExpiresAt.After(time.Now().UTC())
				if *item.CodeStatus == "redeemed" || (*item.CodeStatus == "active" && !isExpired) {
					return apperr.E("trial_reward_not_reissuable", "当前积分礼包仍然有效或已经领取", 409)
				}
			}
			now := time.Now().UTC()
			note := "体验资格积分补发 · " + item.UserEmail
			code, insertErr := store.InsertRedemptionCode(
				ctx, tx, generatedCode, *body.GrantCents,
				"trial-reissue-"+redemption.NewBatchID(), &note, expiresAt, admin.ID,
			)
			if insertErr != nil {
				return insertErr
			}
			won, replaceErr := store.ReplaceTrialAccessRewardCode(
				ctx, tx, item.ID, code.ID, admin.ID, reviewNote, now,
			)
			if replaceErr != nil {
				return replaceErr
			}
			if !won {
				return apperr.E("trial_application_conflict", "申请状态已变化，请刷新后重试", 409)
			}
			message := fmt.Sprintf("新的体验积分礼包已发放，%d 积分等待领取。", *body.GrantCents)
			return store.InsertNotification(ctx, tx, &item.UserID, "trial_access", "体验积分已重新发放", &message)
		})
		if reviewErr == nil || !store.IsUniqueViolation(reviewErr, "redemption_codes_code_key") {
			break
		}
	}
	if reviewErr != nil {
		fail(c, reviewErr)
		return
	}
	item, err := store.GetTrialAccessApplication(ctx, s.St.Pool, applicationID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, trialAccessApplicationDict(item, true))
}
