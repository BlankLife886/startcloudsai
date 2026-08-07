package httpapi

import (
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/growth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

var feedbackCategories = []string{"bug", "generation", "account", "billing", "suggestion", "other"}
var feedbackStatuses = []string{"open", "in_progress", "resolved", "closed"}

const maxFeedbackPerDay int64 = 20

type feedbackSubmitIn struct {
	Category string  `json:"category"`
	Title    string  `json:"title"`
	Content  string  `json:"content"`
	PageURL  *string `json:"pageUrl"`
}

type feedbackReviewIn struct {
	Status      string  `json:"status"`
	AdminReply  *string `json:"adminReply"`
	Adopted     *bool   `json:"adopted"`
	RewardCents *int64  `json:"rewardCents"`
}

func trimOptional(value *string, max int, field string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > max {
		return nil, apperr.E("validation_error", fmt.Sprintf("%s: 不能超过 %d 个字符", field, max), 422)
	}
	return &trimmed, nil
}

func normalizeFeedbackSubmit(body *feedbackSubmitIn) error {
	body.Category = strings.TrimSpace(body.Category)
	body.Title = strings.TrimSpace(body.Title)
	body.Content = strings.TrimSpace(body.Content)
	if !store.Contains(feedbackCategories, body.Category) {
		return apperr.E("validation_error", "category: 无效的反馈分类", 422)
	}
	if n := utf8.RuneCountInString(body.Title); n < 5 || n > 120 {
		return apperr.E("validation_error", "title: 标题须为 5-120 个字符", 422)
	}
	if n := utf8.RuneCountInString(body.Content); n < 10 || n > 3000 {
		return apperr.E("validation_error", "content: 问题描述须为 10-3000 个字符", 422)
	}
	pageURL, err := trimOptional(body.PageURL, 500, "pageUrl")
	if err != nil {
		return err
	}
	body.PageURL = pageURL
	if pageURL != nil {
		value := *pageURL
		if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
			return nil
		}
		parsed, parseErr := url.Parse(value)
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return apperr.E("validation_error", "pageUrl: 仅支持站内路径或 HTTP/HTTPS 地址", 422)
		}
	}
	return nil
}

func feedbackDict(item *store.UserFeedback, includeUser, includeDiagnostic bool) gin.H {
	if item == nil {
		return nil
	}
	result := gin.H{
		"id":          item.ID.String(),
		"category":    item.Category,
		"title":       item.Title,
		"content":     item.Content,
		"pageUrl":     item.PageURL,
		"status":      item.Status,
		"adminReply":  item.AdminReply,
		"adopted":     item.Adopted,
		"rewardCents": item.RewardCents,
		"rewardedAt":  iso(item.RewardedAt),
		"handledAt":   iso(item.HandledAt),
		"createdAt":   isoValue(item.CreatedAt),
		"updatedAt":   isoValue(item.UpdatedAt),
	}
	if includeUser {
		result["userId"] = item.UserID.String()
		result["userEmail"] = item.UserEmail
		result["username"] = item.Username
	}
	if includeDiagnostic {
		result["userAgent"] = item.UserAgent
		if item.HandledBy != nil {
			result["handledBy"] = item.HandledBy.String()
		} else {
			result["handledBy"] = nil
		}
	}
	return result
}

func (s *Server) submitUserFeedback(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body feedbackSubmitIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := normalizeFeedbackSubmit(&body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	count, err := store.CountRecentUserFeedback(ctx, s.St.Pool, user.ID, time.Now().UTC().Add(-24*time.Hour))
	if err != nil {
		fail(c, err)
		return
	}
	if count >= maxFeedbackPerDay {
		fail(c, apperr.E("feedback_daily_limit", "24 小时内最多提交 20 条反馈", 429))
		return
	}
	userAgent := strings.TrimSpace(c.Request.UserAgent())
	if utf8.RuneCountInString(userAgent) > 512 {
		runes := []rune(userAgent)
		userAgent = string(runes[:512])
	}
	var userAgentPtr *string
	if userAgent != "" {
		userAgentPtr = &userAgent
	}
	item, err := store.InsertUserFeedback(ctx, s.St.Pool, user.ID, body.Category, body.Title, body.Content, body.PageURL, userAgentPtr)
	if err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, feedbackDict(item, false, false))
}

func (s *Server) myFeedback(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListUserFeedback(c.Request.Context(), s.St.Pool, user.ID, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(items, limit, func(item *store.UserFeedback) gin.H {
		return feedbackDict(item, false, false)
	}))
}

func validateFeedbackFilters(status, category string) error {
	if status != "" && !store.Contains(feedbackStatuses, status) {
		return apperr.E("validation_error", "无效的反馈状态", 422)
	}
	if category != "" && !store.Contains(feedbackCategories, category) {
		return apperr.E("validation_error", "无效的反馈分类", 422)
	}
	return nil
}

func (s *Server) adminFeedback(c *gin.Context, _ *store.User) {
	status := strings.TrimSpace(c.Query("status"))
	category := strings.TrimSpace(c.Query("category"))
	if err := validateFeedbackFilters(status, category); err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	search := c.Query("search")
	items, err := store.ListAdminFeedback(ctx, s.St.Pool, status, category, search, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	total, err := store.CountAdminFeedback(ctx, s.St.Pool, status, category, search)
	if err != nil {
		fail(c, err)
		return
	}
	page := buildPage(items, limit, func(item *store.UserFeedback) gin.H {
		return feedbackDict(item, true, true)
	})
	page["total"] = total
	ok(c, page)
}

func (s *Server) adminReviewFeedback(c *gin.Context, admin *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body feedbackReviewIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Status = strings.TrimSpace(body.Status)
	if !store.Contains(feedbackStatuses, body.Status) {
		fail(c, apperr.E("validation_error", "status: 无效的反馈状态", 422))
		return
	}
	reply, err := trimOptional(body.AdminReply, 2000, "adminReply")
	if err != nil {
		fail(c, err)
		return
	}
	if (body.Status == "resolved" || body.Status == "closed") && reply == nil {
		fail(c, apperr.E("validation_error", "adminReply: 解决或关闭反馈时必须填写回复", 422))
		return
	}

	ctx := c.Request.Context()
	var userID uuid.UUID
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		item, getErr := store.GetFeedbackForUpdate(ctx, tx, id)
		if getErr != nil {
			return getErr
		}
		if item == nil {
			return apperr.E("not_found", "反馈不存在", 404)
		}
		userID = item.UserID
		adopted := body.Adopted != nil && *body.Adopted
		if adopted && !item.Adopted {
			if item.Category != "suggestion" {
				return apperr.E("validation_error", "只有产品建议可以标记为已采纳", 422)
			}
			if body.Status != "resolved" && body.Status != "closed" {
				return apperr.E("validation_error", "采纳建议时须同时解决或关闭反馈", 422)
			}
			cfg, configErr := growth.LoadConfig(ctx, tx)
			if configErr != nil {
				return configErr
			}
			if body.RewardCents == nil || *body.RewardCents <= 0 || *body.RewardCents > cfg.SuggestionRewardMaxCents {
				return apperr.E("validation_error", fmt.Sprintf("rewardCents: 须在 1-%d 之间", cfg.SuggestionRewardMaxCents), 422)
			}
		}
		effectiveReply := reply
		if effectiveReply == nil {
			effectiveReply = item.AdminReply
		}
		now := time.Now().UTC()
		won, updateErr := store.UpdateFeedbackReview(ctx, tx, id, body.Status, effectiveReply, admin.ID, now)
		if updateErr != nil {
			return updateErr
		}
		if !won {
			return apperr.E("not_found", "反馈不存在", 404)
		}
		if adopted && !item.Adopted {
			reward := *body.RewardCents
			marked, markErr := store.MarkFeedbackAdopted(ctx, tx, id, reward, now)
			if markErr != nil {
				return markErr
			}
			if marked {
				reason := fmt.Sprintf("产品建议被采纳：%s", item.Title)
				if _, grantErr := wallet.Grant(ctx, tx, item.UserID, reward, "grant", "feedback_adoption", id.String(), &reason); grantErr != nil {
					return grantErr
				}
			}
		}
		statusLabel := map[string]string{
			"open": "待处理", "in_progress": "处理中", "resolved": "已解决", "closed": "已关闭",
		}[body.Status]
		message := fmt.Sprintf("你的反馈“%s”状态已更新为%s。", item.Title, statusLabel)
		if effectiveReply != nil {
			message += " 管理员回复：" + *effectiveReply
		}
		if adopted && !item.Adopted {
			message += fmt.Sprintf(" 你的建议已被采纳，%d 积分奖励已到账。", *body.RewardCents)
		}
		return store.InsertNotification(ctx, tx, &item.UserID, "system", "问题反馈进度更新", &message)
	})
	if err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetFeedbackByID(ctx, s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil || item.UserID != userID {
		fail(c, apperr.E("not_found", "反馈不存在", 404))
		return
	}
	ok(c, feedbackDict(item, true, true))
}
