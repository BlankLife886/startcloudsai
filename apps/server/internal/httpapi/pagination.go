// cursor 分页：cursor = urlsafe_base64("<created_at_iso>|<id>[|<排序值>]")，按 (created_at, id) 倒序；
// 按热度等其他列排序的列表额外带上游标行的排序值。后台接口的游标另附 ".<筛选哈希>"，
// 换了筛选条件却沿用旧游标时拒绝请求，而不是返回错位的数据。
package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func encodeCursor(createdAt time.Time, id uuid.UUID) string {
	return encodeValueCursor(createdAt, id, nil)
}

func encodeValueCursor(createdAt time.Time, id uuid.UUID, value *int64) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()
	if value != nil {
		raw += "|" + strconv.FormatInt(*value, 10)
	}
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

var errBadCursor = apperr.E("validation_error", "无效的 cursor", 422)

var errCursorScope = apperr.E("validation_error", "筛选条件已变化，请从第一页重新加载", 422)

func decodeCursor(cursor string) (*store.Cursor, error) {
	cursor, _, _ = strings.Cut(cursor, ".")
	raw, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		if raw, err = base64.RawURLEncoding.DecodeString(cursor); err != nil {
			return nil, errBadCursor
		}
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 2 && len(parts) != 3 {
		return nil, errBadCursor
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, errBadCursor
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, errBadCursor
	}
	out := &store.Cursor{CreatedAt: ts, ID: id}
	if len(parts) == 3 {
		value, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil {
			return nil, errBadCursor
		}
		out.Value = &value
	}
	return out, nil
}

const cursorScopeKey = "cursorScope"

// cursorScopeIgnored 列出不影响结果集的参数：翻页位置、页大小与是否附带统计。
var cursorScopeIgnored = map[string]bool{"cursor": true, "page": true, "limit": true, "summary": true}

// cursorScope 为后台列表的筛选条件生成短哈希；非后台接口返回空（不做绑定，
// 避免未核对过请求参数的用户端与 App 因参数差异被拒绝）。
func cursorScope(c *gin.Context) string {
	if c.Request == nil || !strings.HasPrefix(c.Request.URL.Path, "/api/v1/admin/") {
		return ""
	}
	query := c.Request.URL.Query()
	keys := make([]string, 0, len(query))
	for key := range query {
		if !cursorScopeIgnored[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	canonical := url.Values{}
	for _, key := range keys {
		values := append([]string(nil), query[key]...)
		for i := range values {
			values[i] = strings.TrimSpace(values[i])
		}
		canonical[key] = values
	}
	sum := sha256.Sum256([]byte(c.Request.URL.Path + "?" + canonical.Encode()))
	return hex.EncodeToString(sum[:4])
}

// scopeResponseCursors 给后台响应里的 nextCursor/cursor 附上筛选哈希（由 ok 调用）。
func scopeResponseCursors(c *gin.Context, data any) {
	scope, _ := c.Get(cursorScopeKey)
	suffix, _ := scope.(string)
	page, isMap := data.(gin.H)
	if suffix == "" || !isMap {
		return
	}
	for _, key := range []string{"nextCursor", "cursor"} {
		if value, ok := page[key].(string); ok && value != "" && !strings.Contains(value, ".") {
			page[key] = value + "." + suffix
		}
	}
}

// pageParams 解析 ?limit=&cursor=（limit 1-100 默认 20）。
func pageParams(c *gin.Context) (int, *store.Cursor, error) {
	limit := 20
	if s := c.Query("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 100 {
			return 0, nil, apperr.E("validation_error", "limit: 须在 1-100 之间", 422)
		}
		limit = n
	}
	scope := cursorScope(c)
	if scope != "" {
		c.Set(cursorScopeKey, scope)
	}
	var cursor *store.Cursor
	if s := c.Query("cursor"); s != "" {
		// 未带哈希的旧游标仍然接受，保证发布前后正在翻页的请求不受影响。
		if _, got, scoped := strings.Cut(s, "."); scoped && scope != "" && got != scope {
			return 0, nil, errCursorScope
		}
		cur, err := decodeCursor(s)
		if err != nil {
			return 0, nil, err
		}
		cursor = cur
	}
	return limit, cursor, nil
}

type cursorItem interface {
	CursorKey() (time.Time, uuid.UUID)
}

// cursorValuer 由按非时间列排序的条目实现，其排序值会写入游标。
type cursorValuer interface {
	CursorValue() *int64
}

// buildPage rows 为 limit+1 条查询结果。
func buildPage[T cursorItem](rows []T, limit int, serialize func(T) gin.H) gin.H {
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		items = append(items, serialize(r))
	}
	var next any
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		t, id := last.CursorKey()
		var value *int64
		if valued, ok := any(last).(cursorValuer); ok {
			value = valued.CursorValue()
		}
		next = encodeValueCursor(t, id, value)
	}
	return gin.H{"items": items, "nextCursor": next}
}

var errPageBeyondCap = apperr.E("validation_error",
	"页码分页只能浏览前 "+strconv.Itoa(store.ListCountCap)+" 条记录，请缩小筛选范围后再查看", 422)

// pageWindow 解析纯页码分页的 ?limit=&page=（page 默认 1），并限制只能浏览前 ListCountCap 条。
func pageWindow(c *gin.Context, defaultLimit, maxLimit int) (limit, page int, err error) {
	limit = defaultLimit
	if s := c.Query("limit"); s != "" {
		n, convErr := strconv.Atoi(s)
		if convErr != nil || n < 1 || n > maxLimit {
			return 0, 0, apperr.E("validation_error", "limit: 须在 1-"+strconv.Itoa(maxLimit)+" 之间", 422)
		}
		limit = n
	}
	page, err = pageNumber(c)
	if err != nil {
		return 0, 0, err
	}
	page = max(page, 1)
	if (page-1)*limit >= store.ListCountCap {
		return 0, 0, errPageBeyondCap
	}
	return limit, page, nil
}

// pageSeek 解析页码跳转 ?page=N（N ≥ 1）。第 1 页返回 nil 游标；之后返回 Offset 游标，
// 只能传给支持 Cursor.Offset 的列表函数。未传 page 时 page 为 0。
func pageSeek(c *gin.Context, limit int) (*store.Cursor, int, error) {
	page, err := pageNumber(c)
	if err != nil || page == 0 {
		return nil, 0, err
	}
	if (page-1)*limit >= store.ListCountCap {
		return nil, 0, errPageBeyondCap
	}
	if page == 1 {
		return nil, 1, nil
	}
	return &store.Cursor{Offset: (page - 1) * limit}, page, nil
}

func pageNumber(c *gin.Context) (int, error) {
	s := strings.TrimSpace(c.Query("page"))
	if s == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 || n > 10000 {
		return 0, apperr.E("validation_error", "page: 须在 1-10000 之间", 422)
	}
	return n, nil
}
