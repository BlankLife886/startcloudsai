package httpapi

import (
	"encoding/json"
	"regexp"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 与前端 notificationKind().scope 对齐的通知分类。
var notificationPreferenceCategories = []string{"task", "wallet", "trial", "review", "other"}

var clockPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

type notificationQuietHours struct {
	Enabled bool   `json:"enabled"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

// notificationPreferences 新通知到达时怎么提醒；不影响通知本身是否写入与展示。
type notificationPreferences struct {
	Sound      bool                   `json:"sound"`
	Categories map[string]string      `json:"categories"`
	QuietHours notificationQuietHours `json:"quietHours"`
}

func defaultNotificationPreferences() notificationPreferences {
	categories := map[string]string{}
	for _, category := range notificationPreferenceCategories {
		categories[category] = "alert"
	}
	return notificationPreferences{
		Sound:      true,
		Categories: categories,
		QuietHours: notificationQuietHours{Start: "22:00", End: "08:00"},
	}
}

// normalize 用默认值补齐缺失项，并校验取值。
func (p *notificationPreferences) normalize() error {
	defaults := defaultNotificationPreferences()
	for category, mode := range p.Categories {
		if _, known := defaults.Categories[category]; !known {
			return apperr.E("validation_error", "categories: 未知的通知分类 "+category, 422)
		}
		if mode != "alert" && mode != "silent" {
			return apperr.E("validation_error", "categories: 取值须为 alert 或 silent", 422)
		}
	}
	for category, mode := range defaults.Categories {
		if p.Categories == nil {
			p.Categories = map[string]string{}
		}
		if _, set := p.Categories[category]; !set {
			p.Categories[category] = mode
		}
	}
	if p.QuietHours.Start == "" {
		p.QuietHours.Start = defaults.QuietHours.Start
	}
	if p.QuietHours.End == "" {
		p.QuietHours.End = defaults.QuietHours.End
	}
	if !clockPattern.MatchString(p.QuietHours.Start) || !clockPattern.MatchString(p.QuietHours.End) {
		return apperr.E("validation_error", "quietHours: 时间格式须为 HH:MM", 422)
	}
	return nil
}

func (s *Server) myNotificationPreferences(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	prefs := defaultNotificationPreferences()
	raw, err := store.GetNotificationPreferences(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if raw != nil {
		var saved notificationPreferences
		if json.Unmarshal(raw, &saved) == nil && saved.normalize() == nil {
			prefs = saved
		}
	}
	ok(c, prefs)
}

func (s *Server) saveMyNotificationPreferences(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body notificationPreferences
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := body.normalize(); err != nil {
		fail(c, err)
		return
	}
	raw, err := json.Marshal(body)
	if err != nil {
		fail(c, err)
		return
	}
	if err := store.SaveNotificationPreferences(c.Request.Context(), s.St.Pool, user.ID, raw); err != nil {
		fail(c, err)
		return
	}
	ok(c, body)
}
