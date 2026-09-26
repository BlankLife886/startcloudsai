package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var ecommerceReviewChecklistKeys = map[string]struct{}{
	"identity": {},
	"copy":     {},
	"color":    {},
	"physics":  {},
	"channel":  {},
	"rights":   {},
}

type ecommerceAssetReviewInput struct {
	Status    string          `json:"status"`
	Checklist map[string]bool `json:"checklist"`
	Note      string          `json:"note"`
	Channel   string          `json:"channel"`
}

func ecommerceAssetReviewDict(review *store.EcommerceAssetReview) gin.H {
	var reviewedAt any
	if review.ReviewedAt != nil {
		reviewedAt = isoValue(*review.ReviewedAt)
	}
	return gin.H{
		"id":         review.ID.String(),
		"taskId":     review.TaskID.String(),
		"status":     review.Status,
		"checklist":  review.Checklist,
		"note":       review.Note,
		"channel":    review.Channel,
		"reviewedAt": reviewedAt,
		"createdAt":  isoValue(review.CreatedAt),
		"updatedAt":  isoValue(review.UpdatedAt),
	}
}

func parseEcommerceReviewStatus(value string, allowEmpty bool) (string, error) {
	status := strings.TrimSpace(strings.ToLower(value))
	if status == "" && allowEmpty {
		return "", nil
	}
	if status != "pending" && status != "approved" && status != "changes_requested" {
		return "", apperr.E("validation_error", "status: 仅支持 pending / approved / changes_requested", 422)
	}
	return status, nil
}

func normalizeEcommerceReviewChecklist(checklist map[string]bool) (map[string]any, error) {
	result := make(map[string]any, len(checklist))
	for key, checked := range checklist {
		if _, ok := ecommerceReviewChecklistKeys[key]; !ok {
			return nil, apperr.E("validation_error", "checklist: 包含未知检查项", 422)
		}
		result[key] = checked
	}
	return result, nil
}

func (s *Server) listEcommerceAssetReviews(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	status, err := parseEcommerceReviewStatus(c.Query("status"), true)
	if err != nil {
		fail(c, err)
		return
	}
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 1 || parsed > 200 {
			fail(c, apperr.E("validation_error", "limit: 须在 1-200 之间", 422))
			return
		}
		limit = parsed
	}
	reviews, err := store.ListEcommerceAssetReviews(c.Request.Context(), s.St.Pool, user.ID, status, limit)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(reviews))
	for _, review := range reviews {
		items = append(items, ecommerceAssetReviewDict(review))
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) upsertEcommerceAssetReview(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	taskID, err := parseUUIDParam(c, "taskId")
	if err != nil {
		fail(c, err)
		return
	}
	task, err := store.GetUserTask(c.Request.Context(), s.St.Pool, user.ID, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if task == nil {
		fail(c, apperr.E("not_found", "电商成片不存在", http.StatusNotFound))
		return
	}
	if task.Type != "ecommerce_design" {
		fail(c, apperr.E("validation_error", "只能审核 AI 商拍任务", 422))
		return
	}
	var body ecommerceAssetReviewInput
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	status, err := parseEcommerceReviewStatus(body.Status, false)
	if err != nil {
		fail(c, err)
		return
	}
	checklist, err := normalizeEcommerceReviewChecklist(body.Checklist)
	if err != nil {
		fail(c, err)
		return
	}
	note := strings.TrimSpace(body.Note)
	channel := strings.TrimSpace(body.Channel)
	if utf8.RuneCountInString(note) > 800 {
		fail(c, apperr.E("validation_error", "note: 最多 800 个字符", 422))
		return
	}
	if utf8.RuneCountInString(channel) > 80 {
		fail(c, apperr.E("validation_error", "channel: 最多 80 个字符", 422))
		return
	}
	if status == "approved" {
		for key := range ecommerceReviewChecklistKeys {
			if checked, ok := checklist[key].(bool); !ok || !checked {
				fail(c, apperr.E("review_incomplete", "六项商业质检全部通过后才能批准", 409))
				return
			}
		}
		if task.Status != "succeeded" || len(task.OutputKeys) == 0 {
			fail(c, apperr.E("review_not_ready", "图片生成完成后才能批准", 409))
			return
		}
	}
	review := &store.EcommerceAssetReview{
		UserID:    user.ID,
		TaskID:    task.ID,
		Status:    status,
		Checklist: checklist,
		Note:      note,
		Channel:   channel,
	}
	if err := store.UpsertEcommerceAssetReview(c.Request.Context(), s.St.Pool, review); err != nil {
		fail(c, err)
		return
	}
	ok(c, ecommerceAssetReviewDict(review))
}
