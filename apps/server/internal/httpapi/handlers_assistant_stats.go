package httpapi

import (
	"errors"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// rerunAssistantStats re-runs a statistics card from a reply with another
// time range or comparison, using the same query as the my_stats_query tool.
// The user scope always comes from the session.
// POST /assistant/stats-query
func (s *Server) rerunAssistantStats(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var request usermetrics.Request
	if err := bindJSON(c, &request); err != nil {
		fail(c, err)
		return
	}
	if len(request.Metrics) == 0 || len(request.Metrics) > 6 || len(request.Dimensions) > 2 {
		fail(c, apperr.E("validation_error", "统计参数不完整", 422))
		return
	}
	result, err := usermetrics.Query(c.Request.Context(), s.St, user.ID, request, time.Now())
	if err != nil {
		if errors.Is(err, usermetrics.ErrInvalid) {
			fail(c, apperr.E("validation_error", err.Error(), 422))
			return
		}
		fail(c, err)
		return
	}
	query := request
	query.Timezone = ""
	result.Query = &query
	ok(c, result)
}
