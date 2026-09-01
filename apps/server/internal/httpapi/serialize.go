// 序列化：模型 → 对外 camelCase dict，字段与 Python serializers.py 逐字段一致。
package httpapi

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

var ledgerTypeCountSuffix = regexp.MustCompile(`[（(][a-z][a-z0-9_]*(?:×|x|\*)\d+[）)]`)

func optionalString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func userDict(u *store.User) gin.H {
	return gin.H{
		"id":                 u.ID.String(),
		"email":              u.Email,
		"username":           u.Username,
		"avatarUrl":          optionalString(u.AvatarURL),
		"studioFigureUrl":    optionalString(u.StudioFigureURL),
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

// displayURLsForTask 由原图 key 按约定推导展示图（压缩图）地址。
// 旧任务没有展示图对象时前端加载 404 会回退到原图。
func displayURLsForTask(t *store.Task, prefix string) []string {
	if !hasDedicatedThumbKeys(t.ThumbnailKeys, t.OutputKeys) {
		return prefixedObjectURLs(t.OutputKeys, prefix)
	}
	return variantURLsForTask(t, prefix, outputVariantDisplay)
}

// thumbURLsForTask 列表预览用小图地址。优先用入库的 thumbnail_keys；
// 若缺失或误存成原图 key，再按任务产物约定推导 thumb 路径。
func thumbURLsForTask(t *store.Task, prefix string) []string {
	if hasDedicatedThumbKeys(t.ThumbnailKeys, t.OutputKeys) {
		return prefixedObjectURLs(t.ThumbnailKeys, prefix)
	}
	return variantURLsForTask(t, prefix, outputVariantThumb)
}

func variantURLsForTask(t *store.Task, prefix string, kind outputVariantKind) []string {
	urls := make([]string, 0, len(t.OutputKeys))
	for _, key := range t.OutputKeys {
		key = strings.TrimLeft(strings.TrimSpace(key), "/")
		if key == "" {
			continue
		}
		variant := outputVariantKey(key, kind)
		if variant == "" {
			variant = key
		}
		urls = append(urls, prefix+variant)
	}
	return urls
}

type outputVariantKind int

const (
	outputVariantThumb outputVariantKind = iota
	outputVariantDisplay
)

func outputVariantKey(key string, kind outputVariantKind) string {
	if kind == outputVariantDisplay {
		if display := store.DisplayKeyForOriginal(key); display != "" {
			return display
		}
		if variants := store.AssistantVariantKeys(key); len(variants) == 2 {
			return variants[1]
		}
		return ""
	}
	if thumb := store.ThumbKeyForOriginal(key); thumb != "" {
		return thumb
	}
	if variants := store.AssistantVariantKeys(key); len(variants) > 0 {
		return variants[0]
	}
	return ""
}

func hasDedicatedThumbKeys(thumbKeys, outputKeys []string) bool {
	if len(thumbKeys) == 0 {
		return false
	}
	if len(thumbKeys) != len(outputKeys) {
		return true
	}
	for i, key := range thumbKeys {
		if strings.TrimSpace(key) != strings.TrimSpace(outputKeys[i]) {
			return true
		}
	}
	return false
}

func prefixedObjectURLs(keys []string, prefix string) []string {
	urls := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimLeft(strings.TrimSpace(key), "/")
		if key == "" {
			continue
		}
		urls = append(urls, prefix+key)
	}
	return urls
}

// variantURLsForKeys 由原图 key 列表按约定推导变体地址；推导不出（如非任务产物 key）
// 时回退原图地址，保证数组与原图一一对应。
func variantURLsForKeys(keys []string, derive func(string) string) []string {
	urls := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimLeft(strings.TrimSpace(key), "/")
		if key == "" {
			continue
		}
		variant := derive(key)
		if variant == "" {
			variant = key
		}
		urls = append(urls, "/api/v1/files/"+variant)
	}
	return urls
}

// variantURLForKey 单个 key 版本；key 为空时返回 nil。
func variantURLForKey(key *string, derive func(string) string) *string {
	if key == nil || strings.TrimSpace(*key) == "" {
		return nil
	}
	urls := variantURLsForKeys([]string{*key}, derive)
	if len(urls) == 0 {
		return nil
	}
	return &urls[0]
}

func taskGenerationStage(t *store.Task) string {
	if t == nil {
		return ""
	}
	switch t.Status {
	case "queued":
		return "queued"
	case "succeeded":
		return "completed"
	case "failed":
		return "failed"
	case "canceled":
		return "canceled"
	}
	if t.Status != "running" {
		return t.Status
	}
	if stage, _ := t.Params["_generationStage"].(string); stage != "" {
		switch stage {
		case "preparing", "upstream_generating", "fetching_result", "saving_result":
			return stage
		}
	}
	if len(t.OutputKeys) > 0 {
		return "saving_result"
	}
	if stage, _ := t.Params["_upstreamStage"].(string); stage == "async_pending" {
		return "upstream_generating"
	}
	// A running task without the new marker was created by an older worker or
	// observed in the narrow claim-to-stage window. Treat it conservatively as
	// submitted so the UI never promises a refund that the ledger cannot make.
	return "upstream_generating"
}

func taskCancelPolicy(t *store.Task) gin.H {
	stage := taskGenerationStage(t)
	policy := gin.H{
		"allowed":           false,
		"mode":              "unavailable",
		"upstreamSubmitted": false,
		"refunded":          false,
		"message":           "当前阶段不能取消",
	}
	if t == nil {
		return policy
	}
	if t.Status == "queued" || (t.Status == "running" && stage == "preparing") {
		policy["allowed"] = true
		policy["mode"] = "immediate"
		policy["refunded"] = true
		policy["message"] = "任务尚未提交上游，取消后冻结积分会立即退回。"
		return policy
	}
	if t.Status == "running" {
		policy["allowed"] = true
		policy["mode"] = "abandon_upstream"
		policy["upstreamSubmitted"] = true
		policy["message"] = "生成请求已经提交给上游。停止后平台不再等待或接收结果，但上游可能仍会继续生成，本次积分不会退回。"
	}
	return policy
}

func taskDict(t *store.Task, outputURLs, originalURLs []string) gin.H {
	params := publicTaskParams(t.Params)
	var deletionActor any
	if t.DeletionActor != nil {
		deletionActor = *t.DeletionActor
	}
	return gin.H{
		"id":                 t.ID.String(),
		"type":               t.Type,
		"model":              t.Model,
		"status":             t.Status,
		"generationStage":    taskGenerationStage(t),
		"cancelPolicy":       taskCancelPolicy(t),
		"prompt":             t.Prompt,
		"params":             params,
		"count":              t.Count,
		"inputKeys":          nonNilStrings(t.InputKeys),
		"outputKeys":         nonNilStrings(t.OutputKeys),
		"outputUrls":         nonNilStrings(outputURLs),
		"thumbnailUrls":      nonNilStrings(outputURLs),
		"originalUrls":       nonNilStrings(originalURLs),
		"displayUrls":        displayURLsForTask(t, "/api/v1/files/"),
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

// publicTaskParams keeps user-authored options while withholding execution
// snapshots such as provider routes, upstream costs and API-key identifiers.
func publicTaskParams(params map[string]any) map[string]any {
	if params == nil {
		return map[string]any{}
	}
	allowedInternal := map[string]bool{
		"_source": true, "_kind": true, "_automatic": true,
		"_parentTaskId": true, "_modelDisplayName": true,
	}
	out := make(map[string]any, len(params))
	for key, value := range params {
		if strings.HasPrefix(key, "_") && !allowedInternal[key] {
			continue
		}
		out[key] = value
	}
	return out
}

func attachShareSubmission(d gin.H, submission *store.GallerySubmission) gin.H {
	if submission == nil {
		d["shareSubmitted"] = false
		d["shareSubmissionStatus"] = ""
		return d
	}
	d["shareSubmitted"] = true
	d["shareSubmissionStatus"] = submission.Status
	return d
}

func adminTaskDict(t *store.Task, user *store.User) gin.H {
	d := taskDict(t, nil, nil)
	// The admin diagnostics view is authorization-protected and needs the full
	// execution snapshot; only public/user task serializers are redacted.
	d["params"] = t.Params
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
	if store.IsCanvasOrigin(params) {
		return store.PromptTaskTypeCanvas
	}
	return store.PromptTaskTypeAssistant
}

func assistantRunTaskDisplayName(params map[string]any) string {
	return store.AssistantProductName(params)
}

func rewriteAssistantLedgerReason(reason *string, params map[string]any) *string {
	if reason == nil {
		return nil
	}
	product := store.AssistantProductName(params)
	rewritten := *reason
	if product != "AI 助手" && strings.Contains(rewritten, "AI 助手") {
		rewritten = strings.ReplaceAll(rewritten, "AI 助手", product)
	}
	if product == "无限画布" {
		rewritten = strings.ReplaceAll(rewritten, "已停止，按已完成操作结算", "由用户主动停止，按已完成画布操作结算")
	} else {
		rewritten = strings.ReplaceAll(rewritten, "已停止，按已完成操作结算", "由用户主动停止，本轮积分不退还")
	}
	rewritten = strings.ReplaceAll(rewritten, "已停止，未使用费用已退回", "由用户主动停止，未使用费用已退回")
	rewritten = strings.ReplaceAll(rewritten, "已停止，费用已退回", "由用户主动停止，未执行画布操作，费用已退回")
	if rewritten == *reason {
		return reason
	}
	return &rewritten
}

func rewriteTaskLedgerReason(reason *string, task *store.Task) *string {
	if reason == nil {
		return nil
	}
	text := strings.TrimSpace(ledgerTypeCountSuffix.ReplaceAllString(*reason, ""))
	if task != nil && store.IsCanvasOrigin(task.Params) {
		text = strings.NewReplacer(
			"任务冻结", "无限画布冻结",
			"任务结算", "无限画布结算",
			"任务失败解冻", "无限画布失败退回",
			"任务解冻", "无限画布解冻",
		).Replace(text)
	}
	if text == "" {
		return reason
	}
	if text == *reason {
		return reason
	}
	return &text
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
	d["reason"] = rewriteTaskLedgerReason(e.Reason, task)
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
		"createdAt":                 isoValue(task.CreatedAt),
		"startedAt":                 iso(task.StartedAt),
		"finishedAt":                iso(task.FinishedAt),
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
	d["reason"] = rewriteAssistantLedgerReason(e.Reason, params)
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
		"createdAt":                 isoValue(run.CreatedAt),
		"startedAt":                 iso(run.StartedAt),
		"finishedAt":                iso(run.FinishedAt),
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
		"id":                     o.ID.String(),
		"planId":                 o.PlanID.String(),
		"status":                 o.Status,
		"amountCents":            o.AmountCents,
		"grantCents":             o.GrantCents,
		"bonusCents":             o.BonusCents,
		"grantPoints":            o.GrantCents,
		"bonusPoints":            o.BonusCents,
		"provider":               o.Provider,
		"providerPayAmountCents": o.ProviderPayAmountCents,
		"payAmountCents":         o.ProviderPayAmountCents,
		"paymentMethod":          o.PaymentMethod,
		"providerOrderId":        o.ProviderOrderID,
		"payUrl":                 normalizedPaymentURL(firstNonEmptyString(payURL, o.ProviderPayURL)),
		"requiresManualAmount":   o.RequiresManualAmount,
		"expiresAt":              iso(o.ProviderExpiresAt),
		"paidAt":                 iso(o.PaidAt),
		"completedAt":            iso(o.CompletedAt),
		"createdAt":              isoValue(o.CreatedAt),
	}
}

func normalizedPaymentURL(value *string) *string {
	if value == nil {
		return nil
	}
	normalized, err := lanjingpay.NormalizePaymentURL(*value)
	if err != nil || normalized == "" {
		return nil
	}
	return &normalized
}

func firstNonEmptyString(preferred, fallback *string) *string {
	if preferred != nil && strings.TrimSpace(*preferred) != "" {
		return preferred
	}
	return fallback
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
	d := gin.H{
		"id":        n.ID.String(),
		"kind":      n.Kind,
		"title":     n.Title,
		"body":      n.Body,
		"readAt":    readAt,
		"createdAt": isoValue(n.CreatedAt),
	}
	if n.SourceType != nil && strings.TrimSpace(*n.SourceType) != "" {
		d["sourceType"] = strings.TrimSpace(*n.SourceType)
	}
	if n.SourceID != nil && *n.SourceID != uuid.Nil {
		d["sourceId"] = n.SourceID.String()
	}
	return d
}

func attachSubmissionTask(d gin.H, task *store.Task) {
	if task == nil {
		return
	}
	d["taskType"] = task.Type
	d["prompt"] = task.Prompt
	d["taskPrompt"] = task.Prompt
	d["taskModel"] = task.Model
	if ar, ok := task.Params["aspectRatio"].(string); ok {
		if trimmed := strings.TrimSpace(ar); trimmed != "" {
			d["aspectRatio"] = trimmed
		}
	}
	if store.IsCanvasOrigin(task.Params) {
		d["source"] = store.CanvasTaskSource
		d["displayName"] = taskflow.TaskDisplayName(task)
	}
}

func submissionDict(s *store.GallerySubmission, mediaURLs []string) gin.H {
	var categoryID *string
	if s.CategoryID != nil {
		v := s.CategoryID.String()
		categoryID = &v
	}
	return gin.H{
		"id":        s.ID.String(),
		"taskId":    s.TaskID.String(),
		"title":     s.Title,
		"status":    s.Status,
		"coverKey":  s.CoverKey,
		"mediaKeys": nonNilStrings(s.MediaKeys),
		"mediaUrls": nonNilStrings(mediaURLs),
		// 小图/展示图变体（约定推导）：列表用小图、点开大图用展示图，
		// 旧数据取不到时前端回退 mediaUrls 里的原图。
		"mediaThumbUrls":   variantURLsForKeys(s.MediaKeys, store.ThumbKeyForOriginal),
		"mediaDisplayUrls": variantURLsForKeys(s.MediaKeys, store.DisplayKeyForOriginal),
		"coverThumbUrl":    variantURLForKey(s.CoverKey, store.ThumbKeyForOriginal),
		"coverDisplayUrl":  variantURLForKey(s.CoverKey, store.DisplayKeyForOriginal),
		"rejectReason":     s.RejectReason,
		"reviewedAt":       iso(s.ReviewedAt),
		"featured":         s.Featured,
		"categoryId":       categoryID,
		"sort":             s.Sort,
		"tags":             nonNilStrings(s.Tags),
		"createdAt":        isoValue(s.CreatedAt),
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
		"id":          c.ID.String(),
		"version":     c.Version,
		"date":        c.Date.Format("2006-01-02"),
		"tag":         c.Tag,
		"title":       c.Title,
		"summary":     c.Summary,
		"items":       nonNilStrings(c.Items),
		"highlight":   c.Highlight,
		"sort":        c.Sort,
		"createdAt":   isoValue(c.CreatedAt),
		"publishedAt": isoValue(c.CreatedAt),
	}
}
