package httpapi

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) adminUserAnalytics(c *gin.Context, _ *store.User) {
	result, err := store.GetUserAnalytics(c.Request.Context(), s.St.Pool, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, result)
}
