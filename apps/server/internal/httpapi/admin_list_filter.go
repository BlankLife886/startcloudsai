package httpapi

import (
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"strings"
	"time"
)

func adminListFilter(c *gin.Context) (store.AdminListFilter, error) {
	f := store.AdminListFilter{Search: strings.TrimSpace(c.Query("search")), UserSearch: strings.TrimSpace(c.Query("user")), Method: strings.TrimSpace(c.Query("method"))}
	zone := time.FixedZone("Asia/Shanghai", 8*3600)
	for _, entry := range []struct {
		key  string
		dest **time.Time
		end  bool
	}{{"createdFrom", &f.From, false}, {"createdTo", &f.To, true}} {
		raw := strings.TrimSpace(c.Query(entry.key))
		if raw == "" {
			continue
		}
		parsed, err := time.ParseInLocation("2006-01-02", raw, zone)
		if err != nil {
			return f, apperr.E("validation_error", entry.key+": 请使用 YYYY-MM-DD 日期", 422)
		}
		if entry.end {
			parsed = parsed.AddDate(0, 0, 1)
		}
		*entry.dest = &parsed
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		return f, apperr.E("validation_error", "结束日期不能早于开始日期", 422)
	}
	if len([]rune(f.Search)) > 200 || len([]rune(f.UserSearch)) > 200 {
		return f, apperr.E("validation_error", "搜索内容不能超过 200 个字符", 422)
	}
	if f.Method != "" && !store.Contains([]string{"GET", "POST", "PUT", "PATCH", "DELETE"}, f.Method) {
		return f, apperr.E("validation_error", "无效的请求方法", 422)
	}
	return f, nil
}
