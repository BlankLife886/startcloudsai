// 序列化：模型 → 对外 camelCase dict，字段与 Python serializers.py 逐字段一致。
package httpapi

import (
	"encoding/json"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

func userDict(u *store.User) gin.H {
	return gin.H{
		"id":                 u.ID.String(),
		"email":              u.Email,
		"username":           u.Username,
		"avatarUrl":          u.AvatarURL,
		"bio":                u.Bio,
		"location":           u.Location,
		"websiteUrl":         u.WebsiteURL,
		"requireCostConfirm": u.RequireCostConfirm,
		"role":               u.Role,
		"createdAt":          isoValue(u.CreatedAt),
	}
}

func adminUserDict(u *store.User, wallet *store.Wallet) gin.H {
	d := userDict(u)
	d["status"] = u.Status
	d["lastLoginAt"] = iso(u.LastLoginAt)
	d["submissionBannedUntil"] = iso(u.SubmissionBannedUntil)
	if wallet != nil {
		d["wallet"] = walletDict(wallet)
	}
	return d
}

func walletDict(wallet *store.Wallet) gin.H {
	if wallet == nil {
		wallet = &store.Wallet{}
	}
	balancePoints := wallet.BalanceCents + wallet.TrialBalanceCents
	frozenPoints := wallet.FrozenCents + wallet.TrialFrozenCents
	return gin.H{
		"balancePoints": balancePoints, "frozenPoints": frozenPoints,
		"balanceCents": balancePoints, "frozenCents": frozenPoints,
		"availableCents": balancePoints, "totalCents": balancePoints + frozenPoints,
		"normalBalanceCents": wallet.BalanceCents,
		"trialBalanceCents":  wallet.TrialBalanceCents,
		"normalFrozenCents":  wallet.FrozenCents,
		"trialFrozenCents":   wallet.TrialFrozenCents,
		"trialFeatureKey":    wallet.TrialFeatureKey,
	}
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func taskDict(t *store.Task, outputURLs, originalURLs []string) gin.H {
	params := t.Params
	if params == nil {
		params = map[string]any{}
	}
	var deletionActor any
	if t.DeletionActor != nil {
		deletionActor = *t.DeletionActor
	}
	return gin.H{
		"id":                 t.ID.String(),
		"type":               t.Type,
		"model":              t.Model,
		"status":             t.Status,
		"prompt":             t.Prompt,
		"params":             params,
		"count":              t.Count,
		"inputKeys":          nonNilStrings(t.InputKeys),
		"outputKeys":         nonNilStrings(t.OutputKeys),
		"outputUrls":         nonNilStrings(outputURLs),
		"thumbnailUrls":      nonNilStrings(outputURLs),
		"originalUrls":       nonNilStrings(originalURLs),
		"thumbnailKeys":      nonNilStrings(t.ThumbnailKeys),
		"costPoints":         t.CostCents,
		"costCents":          t.CostCents,
		"errorCode":          t.ErrorCode,
		"errorMessage":       t.ErrorMessage,
		"createdAt":          isoValue(t.CreatedAt),
		"startedAt":          iso(t.StartedAt),
		"finishedAt":         iso(t.FinishedAt),
		"deletedAt":          iso(t.DeletedAt),
		"deletionActor":      deletionActor,
		"deletedOutputCount": t.DeletedOutputCount,
	}
}

func adminTaskDict(t *store.Task, user *store.User) gin.H {
	d := taskDict(t, nil, nil)
	d["userId"] = t.UserID.String()
	d["attempt"] = t.Attempt
	d["serviceProvider"] = adminTaskServiceProvider(t)
	d["source"] = "task"
	if t.Type == "assistant" {
		d["source"] = assistantRunTaskSource(t.Params)
	}
	if user != nil {
		d["user"] = gin.H{"id": user.ID.String(), "email": user.Email, "username": user.Username}
	}
	return d
}

func assistantRunTaskSource(params map[string]any) string {
	source, _ := params["_source"].(string)
	workspace, _ := params["workspace"].(string)
	if source == store.CanvasTaskSource || workspace == store.PromptTaskTypeCanvas {
		return store.PromptTaskTypeCanvas
	}
	return store.PromptTaskTypeAssistant
}

func assistantRunTaskDisplayName(params map[string]any) string {
	if assistantRunTaskSource(params) == store.PromptTaskTypeCanvas {
		return "无限画布"
	}
	return "AI 助手"
}

func adminTaskServiceProvider(t *store.Task) string {
	if t.Type == "puzzle" {
		return "local"
	}
	provider, _ := t.Params["_serviceProvider"].(string)
	provider = strings.ToLower(strings.TrimSpace(provider))
	if t.Type == "assistant" {
		resolvedMode, _ := t.Params["resolvedMode"].(string)
		requestedMode, _ := t.Params["mode"].(string)
		if strings.TrimSpace(resolvedMode) == "chat" ||
			(strings.TrimSpace(resolvedMode) == "" && strings.TrimSpace(requestedMode) == "chat") {
			return "sub2api"
		}
		if provider == "c2a" || provider == "sub2api" || provider == "crun" {
			return provider
		}
		// Provider snapshots were added after assistant runs already existed.
		// Historical assistant image/chat runs all used Sub2API.
		return "sub2api"
	}
	if provider == "sub2api" || provider == "crun" {
		return provider
	}
	// Historical standard tasks predate provider routing and all used C2A.
	return "c2a"
}

func ledgerDict(e *store.LedgerEntry) gin.H {
	return gin.H{
		"id":                 e.ID.String(),
		"kind":               e.Kind,
		"deltaCents":         e.DeltaCents,
		"balanceAfterCents":  e.BalanceAfterCents,
		"deltaPoints":        e.DeltaCents,
		"balanceAfterPoints": e.BalanceAfterCents,
		"sourceType":         e.SourceType,
		"sourceId":           e.SourceID,
		"reason":             e.Reason,
		"creditBucket":       e.CreditBucket,
		"createdAt":          isoValue(e.CreatedAt),
	}
}

func ledgerDictWithTask(e *store.LedgerEntry, task *store.Task) gin.H {
	d := ledgerDict(e)
	if task == nil {
		return d
	}
	params := task.Params
	if params == nil {
		params = map[string]any{}
	}
	displayModel, _ := params["_modelDisplayName"].(string)
	if strings.TrimSpace(displayModel) == "" {
		displayModel = task.Model
	}
	automatic, _ := params["_automatic"].(bool)
	settledCost := int64(0)
	if task.Status == "succeeded" {
		settledCost = task.CostCents
		if task.Count > 1 && len(task.OutputKeys) < task.Count {
			settledCost = task.CostCents / int64(task.Count) * int64(len(task.OutputKeys))
		}
	}
	source, _ := params["_source"].(string)
	d["task"] = gin.H{
		"id":                        task.ID.String(),
		"type":                      task.Type,
		"displayName":               taskflow.TaskDisplayName(task),
		"source":                    strings.TrimSpace(source),
		"status":                    task.Status,
		"modelName":                 strings.TrimSpace(displayModel),
		"count":                     task.Count,
		"costPoints":                task.CostCents,
		"settledCostPoints":         settledCost,
		"automaticBackgroundRemove": automatic,
	}
	return d
}

func ledgerDictWithAssistantRun(e *store.LedgerEntry, run *store.AssistantRun) gin.H {
	d := ledgerDict(e)
	if run == nil {
		return d
	}
	params := run.Params
	if params == nil {
		params = map[string]any{}
	}
	displayModel, _ := params["_modelDisplayName"].(string)
	if strings.TrimSpace(displayModel) == "" {
		displayModel, _ = params["model"].(string)
	}
	count := 1
	switch value := params["count"].(type) {
	case int:
		if value > 1 {
			count = value
		}
	case int64:
		if value > 1 {
			count = int(value)
		}
	case float64:
		if value > 1 {
			count = int(value)
		}
	}
	cost := run.CostCents
	if cost <= 0 {
		cost = run.ReservedCents
	}
	settledCost := int64(0)
	if run.Status == "succeeded" {
		settledCost = run.CostCents
	}
	d["task"] = gin.H{
		"id":                        run.ID.String(),
		"type":                      "assistant",
		"displayName":               assistantRunTaskDisplayName(params),
		"source":                    assistantRunTaskSource(params),
		"status":                    run.Status,
		"modelName":                 strings.TrimSpace(displayModel),
		"count":                     count,
		"costPoints":                cost,
		"settledCostPoints":         settledCost,
		"automaticBackgroundRemove": false,
	}
	return d
}

func planDict(p *store.Plan, includeAdmin bool) gin.H {
	d := gin.H{
		"id":               p.ID.String(),
		"code":             p.Code,
		"name":             p.Name,
		"description":      p.Description,
		"badge":            p.Badge,
		"kind":             p.Kind,
		"priceCents":       p.PriceCents,
		"grantCents":       p.GrantCents,
		"bonusCents":       p.BonusCents,
		"grantPoints":      p.GrantCents,
		"bonusPoints":      p.BonusCents,
		"durationDays":     p.DurationDays,
		"dailyGrantCents":  p.DailyGrantCents,
		"dailyGrantPoints": p.DailyGrantCents,
		"features":         nonNilStrings(p.Features),
		"recommended":      p.Recommended,
		"sort":             p.Sort,
	}
	if includeAdmin {
		d["active"] = p.Active
		d["createdAt"] = isoValue(p.CreatedAt)
		d["updatedAt"] = isoValue(p.UpdatedAt)
	}
	return d
}

func orderDict(o *store.Order, payURL *string) gin.H {
	return gin.H{
		"id":          o.ID.String(),
		"planId":      o.PlanID.String(),
		"status":      o.Status,
		"amountCents": o.AmountCents,
		"grantCents":  o.GrantCents,
		"bonusCents":  o.BonusCents,
		"grantPoints": o.GrantCents,
		"bonusPoints": o.BonusCents,
		"provider":    o.Provider,
		"payUrl":      payURL,
		"paidAt":      iso(o.PaidAt),
		"completedAt": iso(o.CompletedAt),
		"createdAt":   isoValue(o.CreatedAt),
	}
}

func adminOrderDict(o *store.Order, user *store.User) gin.H {
	d := orderDict(o, nil)
	d["userId"] = o.UserID.String()
	d["providerOrderId"] = o.ProviderOrderID
	if user != nil {
		d["user"] = gin.H{"id": user.ID.String(), "email": user.Email, "username": user.Username}
	}
	return d
}

// notificationDict globalReadAt 仅对全站公告（user_id NULL）生效。
func notificationDict(n *store.Notification, globalReadAt *string) gin.H {
	var readAt *string
	if n.UserID == nil {
		readAt = globalReadAt
	} else {
		readAt = iso(n.ReadAt)
	}
	return gin.H{
		"id":        n.ID.String(),
		"kind":      n.Kind,
		"title":     n.Title,
		"body":      n.Body,
		"readAt":    readAt,
		"createdAt": isoValue(n.CreatedAt),
	}
}

func submissionDict(s *store.GallerySubmission, mediaURLs []string) gin.H {
	var categoryID *string
	if s.CategoryID != nil {
		v := s.CategoryID.String()
		categoryID = &v
	}
	return gin.H{
		"id":           s.ID.String(),
		"taskId":       s.TaskID.String(),
		"title":        s.Title,
		"status":       s.Status,
		"coverKey":     s.CoverKey,
		"mediaKeys":    nonNilStrings(s.MediaKeys),
		"mediaUrls":    nonNilStrings(mediaURLs),
		"rejectReason": s.RejectReason,
		"reviewedAt":   iso(s.ReviewedAt),
		"featured":     s.Featured,
		"categoryId":   categoryID,
		"sort":         s.Sort,
		"tags":         nonNilStrings(s.Tags),
		"createdAt":    isoValue(s.CreatedAt),
	}
}

func galleryCategoryDict(c *store.GalleryCategory) gin.H {
	return gin.H{
		"id":        c.ID.String(),
		"name":      c.Name,
		"sort":      c.Sort,
		"active":    c.Active,
		"createdAt": isoValue(c.CreatedAt),
	}
}

// promptCoverURL cover_key → /api/v1/files/ 路径（prompt-covers/ 前缀公开可读）；
// 兼容历史迁移数据：cover_key 为完整 http(s) URL 时原样返回。
func promptCoverURL(coverKey *string) *string {
	if coverKey == nil || *coverKey == "" {
		return nil
	}
	if strings.HasPrefix(*coverKey, "http://") || strings.HasPrefix(*coverKey, "https://") {
		return coverKey
	}
	u := "/api/v1/files/" + *coverKey
	return &u
}

func promptDict(p *store.PromptEntry, includeAdmin bool) gin.H {
	d := gin.H{
		"id":            p.ID.String(),
		"title":         p.Title,
		"prompt":        p.Prompt,
		"taskType":      p.TaskType,
		"category":      p.Category,
		"tags":          nonNilStrings(p.Tags),
		"coverUrl":      promptCoverURL(p.CoverKey),
		"coverWidth":    p.CoverWidth,
		"coverHeight":   p.CoverHeight,
		"likeCount":     p.LikeCount,
		"favoriteCount": p.FavoriteCount,
		"useCount":      p.UseCount,
	}
	if includeAdmin {
		d["coverKey"] = p.CoverKey
		if p.GallerySubmissionID != nil {
			d["gallerySubmissionId"] = p.GallerySubmissionID.String()
		} else {
			d["gallerySubmissionId"] = nil
		}
		d["sort"] = p.Sort
		d["active"] = p.Active
		d["createdAt"] = isoValue(p.CreatedAt)
	}
	return d
}

func announcementDict(a *store.Announcement) gin.H {
	config := gin.H{}
	if len(a.Config) > 0 {
		_ = json.Unmarshal(a.Config, &config)
	}
	d := gin.H{
		"id":        a.ID.String(),
		"title":     a.Title,
		"body":      a.Body,
		"active":    a.Active,
		"startsAt":  iso(a.StartsAt),
		"endsAt":    iso(a.EndsAt),
		"createdAt": isoValue(a.CreatedAt),
		"config":    config,
	}
	for key, value := range config {
		d[key] = value
	}
	return d
}

func changelogDict(c *store.ChangelogEntry) gin.H {
	return gin.H{
		"id":        c.ID.String(),
		"version":   c.Version,
		"date":      c.Date.Format("2006-01-02"),
		"tag":       c.Tag,
		"title":     c.Title,
		"summary":   c.Summary,
		"items":     nonNilStrings(c.Items),
		"highlight": c.Highlight,
		"sort":      c.Sort,
	}
}
