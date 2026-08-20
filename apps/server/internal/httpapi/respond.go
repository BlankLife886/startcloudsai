package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
)

// ok 输出 {"success": true, "data": ...}。
func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// created returns a newly created resource using the HTTP 201 semantic.
func respondCreated(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": data})
}

// noContent confirms a successful mutation that has no response representation.
func respondNoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// fail 输出统一错误格式；非 apperr 记录日志并回 500 internal_error。
func fail(c *gin.Context, err error) {
	if errors.Is(err, context.Canceled) ||
		(c.Request != nil && errors.Is(c.Request.Context().Err(), context.Canceled)) {
		c.Abort()
		return
	}
	if e, isApp := apperr.As(err); isApp {
		c.AbortWithStatusJSON(e.Status, gin.H{"success": false, "code": e.Code, "error": e.Message})
		return
	}
	log.Printf("unhandled error on %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	c.AbortWithStatusJSON(500, gin.H{"success": false, "code": "internal_error", "error": "服务器内部错误"})
}

// isoValue 时间 → UTC ISO8601（微秒精度，Z 后缀），与 Python isoformat 一致。
func isoValue(t time.Time) string {
	u := t.UTC()
	if u.Nanosecond() == 0 {
		return u.Format("2006-01-02T15:04:05") + "Z"
	}
	return u.Format("2006-01-02T15:04:05") + fmt.Sprintf(".%06d", u.Nanosecond()/1000) + "Z"
}

// iso 可空时间序列化：nil → null。
func iso(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := isoValue(*t)
	return &s
}
