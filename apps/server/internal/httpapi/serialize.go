// 序列化：模型 → 对外 camelCase dict，字段与 Python serializers.py 逐字段一致。
package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func userDict(u *store.User) gin.H {
	return gin.H{
		"id":         u.ID.String(),
		"email":      u.Email,
		"username":   u.Username,
		"avatarUrl":  u.AvatarURL,
		"bio":        u.Bio,
		"location":   u.Location,
		"websiteUrl": u.WebsiteURL,
		"role":       u.Role,
		"createdAt":  isoValue(u.CreatedAt),
	}
}

func adminUserDict(u *store.User, wallet *store.Wallet) gin.H {
	d := userDict(u)
	d["status"] = u.Status
	d["lastLoginAt"] = iso(u.LastLoginAt)
	d["submissionBannedUntil"] = iso(u.SubmissionBannedUntil)
	if wallet != nil {
		d["wallet"] = gin.H{"balanceCents": wallet.BalanceCents, "frozenCents": wallet.FrozenCents}
	}
	return d
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
	return gin.H{
		"id":            t.ID.String(),
		"type":          t.Type,
		"model":         t.Model,
		"status":        t.Status,
		"prompt":        t.Prompt,
		"params":        params,
		"count":         t.Count,
		"inputKeys":     nonNilStrings(t.InputKeys),
		"outputKeys":    nonNilStrings(t.OutputKeys),
		"outputUrls":    nonNilStrings(outputURLs),
		"thumbnailUrls": nonNilStrings(outputURLs),
		"originalUrls":  nonNilStrings(originalURLs),
		"thumbnailKeys": nonNilStrings(t.ThumbnailKeys),
		"costCents":     t.CostCents,
		"errorCode":     t.ErrorCode,
		"errorMessage":  t.ErrorMessage,
		"createdAt":     isoValue(t.CreatedAt),
		"startedAt":     iso(t.StartedAt),
		"finishedAt":    iso(t.FinishedAt),
	}
}

func adminTaskDict(t *store.Task, user *store.User) gin.H {
	d := taskDict(t, nil, nil)
	d["userId"] = t.UserID.String()
	d["attempt"] = t.Attempt
	if user != nil {
		d["user"] = gin.H{"id": user.ID.String(), "email": user.Email, "username": user.Username}
	}
	return d
}

func ledgerDict(e *store.LedgerEntry) gin.H {
	return gin.H{
		"id":                e.ID.String(),
		"kind":              e.Kind,
		"deltaCents":        e.DeltaCents,
		"balanceAfterCents": e.BalanceAfterCents,
		"sourceType":        e.SourceType,
		"sourceId":          e.SourceID,
		"reason":            e.Reason,
		"createdAt":         isoValue(e.CreatedAt),
	}
}

func planDict(p *store.Plan, includeAdmin bool) gin.H {
	d := gin.H{
		"id":              p.ID.String(),
		"code":            p.Code,
		"name":            p.Name,
		"kind":            p.Kind,
		"priceCents":      p.PriceCents,
		"grantCents":      p.GrantCents,
		"bonusCents":      p.BonusCents,
		"durationDays":    p.DurationDays,
		"dailyGrantCents": p.DailyGrantCents,
		"features":        nonNilStrings(p.Features),
		"sort":            p.Sort,
	}
	if includeAdmin {
		d["active"] = p.Active
		d["createdAt"] = isoValue(p.CreatedAt)
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

// promptCoverURL cover_key → /api/files/ 路径（prompt-covers/ 前缀公开可读）；
// 兼容历史迁移数据：cover_key 为完整 http(s) URL 时原样返回。
func promptCoverURL(coverKey *string) *string {
	if coverKey == nil || *coverKey == "" {
		return nil
	}
	if strings.HasPrefix(*coverKey, "http://") || strings.HasPrefix(*coverKey, "https://") {
		return coverKey
	}
	u := "/api/files/" + *coverKey
	return &u
}

func promptDict(p *store.PromptEntry, includeAdmin bool) gin.H {
	d := gin.H{
		"id":       p.ID.String(),
		"title":    p.Title,
		"prompt":   p.Prompt,
		"taskType": p.TaskType,
		"category": p.Category,
		"tags":     nonNilStrings(p.Tags),
		"coverUrl": promptCoverURL(p.CoverKey),
	}
	if includeAdmin {
		d["coverKey"] = p.CoverKey
		d["sort"] = p.Sort
		d["active"] = p.Active
		d["createdAt"] = isoValue(p.CreatedAt)
	}
	return d
}

func announcementDict(a *store.Announcement) gin.H {
	return gin.H{
		"id":        a.ID.String(),
		"title":     a.Title,
		"body":      a.Body,
		"active":    a.Active,
		"startsAt":  iso(a.StartsAt),
		"endsAt":    iso(a.EndsAt),
		"createdAt": isoValue(a.CreatedAt),
	}
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
