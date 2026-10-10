package httpapi

import (
	"errors"
	"net/url"
	"strings"
	"unicode"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Only root-relative paths and explicit HTTP(S) URLs can become browser links.
func validHomeBannerURL(value string) bool {
	if value == "" || len(value) > 2048 || strings.Contains(value, "\\") || strings.IndexFunc(value, func(r rune) bool { return unicode.IsControl(r) || unicode.IsSpace(r) }) >= 0 {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil {
		return false
	}
	if strings.HasPrefix(value, "/") {
		return !strings.HasPrefix(value, "//") && u.Host == ""
	}
	return (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != ""
}

func validateHomeBanner(b *store.HomeBanner) error {
	b.Title = strings.TrimSpace(b.Title)
	b.Subtitle = strings.TrimSpace(b.Subtitle)
	b.ImageURL = strings.TrimSpace(b.ImageURL)
	b.LinkURL = strings.TrimSpace(b.LinkURL)
	b.ButtonText = strings.TrimSpace(b.ButtonText)
	message := ""
	switch {
	case len([]rune(b.Title)) > 60:
		message = "标题不能超过 60 字"
	case len([]rune(b.Subtitle)) > 160:
		message = "副标题不能超过 160 字"
	case !validHomeBannerURL(b.ImageURL):
		message = "图片地址无效"
	case b.LinkURL != "" && !validHomeBannerURL(b.LinkURL):
		message = "跳转地址须为站内路径或 HTTP(S) 地址"
	case len([]rune(b.ButtonText)) > 20:
		message = "按钮文字不能超过 20 字"
	case b.SortOrder < 0 || b.SortOrder > 99999:
		message = "排序须为 0-99999"
	case b.DurationMS < 3000 || b.DurationMS > 20000:
		message = "播放时长须为 3-20 秒"
	case b.StartsAt != nil && b.EndsAt != nil && !b.EndsAt.After(*b.StartsAt):
		message = "结束时间必须晚于开始时间"
	}
	if message != "" {
		return apperr.E("validation_error", message, 422)
	}
	return nil
}

func (s *Server) homeBanners(c *gin.Context) {
	items, err := store.ListHomeBanners(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	ok(c, gin.H{"items": items})
}
func (s *Server) adminHomeBanners(c *gin.Context, _ *store.User) {
	items, err := store.ListHomeBanners(c.Request.Context(), s.St.Pool, false)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items})
}
func (s *Server) adminSaveHomeBanner(c *gin.Context, _ *store.User) {
	b := store.HomeBanner{Active: true, DurationMS: 5000}
	if err := bindJSON(c, &b); err != nil {
		fail(c, err)
		return
	}
	create := c.Request.Method == "POST"
	b.ID = uuid.New()
	if !create {
		id, err := parseUUIDParam(c, "id")
		if err != nil {
			fail(c, err)
			return
		}
		b.ID = id
	}
	if err := validateHomeBanner(&b); err != nil {
		fail(c, err)
		return
	}
	saved, err := store.SaveHomeBanner(c.Request.Context(), s.St.Pool, &b, create)
	if errors.Is(err, pgx.ErrNoRows) {
		err = apperr.E("not_found", "轮播图不存在", 404)
	}
	if err != nil {
		fail(c, err)
		return
	}
	if create {
		respondCreated(c, saved)
	} else {
		ok(c, saved)
	}
}
func (s *Server) adminDeleteHomeBanner(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	result, err := s.St.Pool.Exec(c.Request.Context(), `DELETE FROM home_banners WHERE id=$1`, id)
	if err != nil {
		fail(c, err)
		return
	}
	if result.RowsAffected() == 0 {
		fail(c, apperr.E("not_found", "轮播图不存在", 404))
		return
	}
	respondNoContent(c)
}
