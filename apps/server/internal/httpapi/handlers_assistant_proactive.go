package httpapi

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantproactive"
)

// The 提醒 tab of the assistant's memory panel switches the proactive
// messages: long-task notices, alerts and scheduled reports.

func (s *Server) getAssistantProactiveSettings(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	settings, err := assistantproactive.Get(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, proactiveSettingsDict(settings))
}

func (s *Server) updateAssistantProactiveSettings(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var patch assistantproactive.Patch
	if err := bindJSON(c, &patch); err != nil {
		fail(c, err)
		return
	}
	settings, err := assistantproactive.Update(c.Request.Context(), s.St.Pool, user.ID, patch)
	if errors.Is(err, assistantproactive.ErrInvalid) {
		fail(c, apperr.E("validation_error", strings.TrimPrefix(err.Error(), assistantproactive.ErrInvalid.Error()+": "), 422))
		return
	}
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, proactiveSettingsDict(settings))
}

func proactiveSettingsDict(settings assistantproactive.Settings) gin.H {
	return gin.H{
		"taskNotices": settings.TaskNotices, "alerts": settings.Alerts, "reportSchedule": settings.ReportSchedule,
		"reportLastSentAt": settings.ReportLastSentAt,
		"thresholds": gin.H{
			"lowBalancePoints": assistantproactive.LowBalancePoints, "spikeFactor": assistantproactive.SpikeFactor,
			"spikeMinPoints": assistantproactive.SpikeMinPoints, "failureRate": assistantproactive.FailureRateThreshold,
			"failureMinTasks": assistantproactive.FailureMinTasks, "reportHour": assistantproactive.ReportHour,
		},
	}
}
