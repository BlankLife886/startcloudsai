package httpapi

import (
	"crypto/rand"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	canvasHTMLShareMaxBytes  = 3 << 20
	canvasHTMLShareMaxActive = 50
	canvasHTMLShareSlugLen   = 12
	canvasHTMLSharePathBase  = "/api/v1/public/html-shares/"
)

var canvasHTMLShareSlugPattern = regexp.MustCompile(`^[A-Za-z0-9]{8,32}$`)

// Shared pages are untrusted user HTML served from the site's own domain. The CSP sandbox (without allow-same-origin)
// gives the document an opaque origin, so its scripts cannot read the site's cookies, storage or APIs as the viewer.
const canvasHTMLShareCSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"

type canvasHTMLShareIn struct {
	HTML    string `json:"html"`
	Title   string `json:"title"`
	ShareID string `json:"shareId"`
}

func newCanvasHTMLShareSlug() (string, error) {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	out := make([]byte, canvasHTMLShareSlugLen)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		out[i] = alphabet[n.Int64()]
	}
	return string(out), nil
}

func canvasHTMLShareTitle(value string) string {
	title := strings.TrimSpace(value)
	if utf8.RuneCountInString(title) > 120 {
		title = string([]rune(title)[:120])
	}
	return title
}

// publishCanvasHTMLShare creates a share, or replaces the page of the caller's existing share when shareId is given.
func (s *Server) publishCanvasHTMLShare(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var in canvasHTMLShareIn
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, apperr.E("validation_error", "请求格式无效", 422))
		return
	}
	html := strings.TrimSpace(in.HTML)
	if html == "" {
		fail(c, apperr.E("validation_error", "网页内容为空", 422))
		return
	}
	if len(html) > canvasHTMLShareMaxBytes {
		fail(c, apperr.E("validation_error", "网页超过 3 MB，无法分享", 422))
		return
	}
	title := canvasHTMLShareTitle(in.Title)
	ctx := c.Request.Context()
	now := time.Now().UTC()

	if slug := strings.TrimSpace(in.ShareID); slug != "" && canvasHTMLShareSlugPattern.MatchString(slug) {
		updated, err := store.UpdateCanvasHTMLShare(ctx, s.St.Pool, user.ID, slug, title, html, now)
		if err != nil {
			fail(c, err)
			return
		}
		if updated {
			ok(c, gin.H{"id": slug, "path": canvasHTMLSharePathBase + slug})
			return
		}
		// The old link was revoked or never belonged to this user: publish a new one instead.
	}

	active, err := store.CountActiveCanvasHTMLShares(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if active >= canvasHTMLShareMaxActive {
		fail(c, apperr.E("quota_exceeded", "分享链接已达 50 个上限，请先撤销不用的链接", 429))
		return
	}
	for attempt := 0; attempt < 3; attempt++ {
		slug, err := newCanvasHTMLShareSlug()
		if err != nil {
			fail(c, err)
			return
		}
		if err := store.CreateCanvasHTMLShare(ctx, s.St.Pool, user.ID, slug, title, html, now); err != nil {
			if strings.Contains(err.Error(), "canvas_html_shares_slug_key") {
				continue
			}
			fail(c, err)
			return
		}
		respondCreated(c, gin.H{"id": slug, "path": canvasHTMLSharePathBase + slug})
		return
	}
	fail(c, apperr.E("unavailable", "生成分享链接失败，请重试", 503))
}

func (s *Server) revokeCanvasHTMLShare(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	slug := strings.TrimSpace(c.Param("id"))
	if !canvasHTMLShareSlugPattern.MatchString(slug) {
		fail(c, apperr.E("not_found", "分享不存在", 404))
		return
	}
	revoked, err := store.RevokeCanvasHTMLShare(c.Request.Context(), s.St.Pool, user.ID, slug, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	if !revoked {
		fail(c, apperr.E("not_found", "分享不存在", 404))
		return
	}
	respondNoContent(c)
}

// publicCanvasHTMLShare serves a shared page to anyone, sandboxed and kept out of search engines.
func (s *Server) publicCanvasHTMLShare(c *gin.Context) {
	header := c.Writer.Header()
	header.Set("Content-Security-Policy", canvasHTMLShareCSP)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Robots-Tag", "noindex, nofollow")
	header.Set("Referrer-Policy", "no-referrer")
	slug := strings.TrimSpace(c.Param("id"))
	var share *store.CanvasHTMLShare
	if canvasHTMLShareSlugPattern.MatchString(slug) {
		found, err := store.GetActiveCanvasHTMLShare(c.Request.Context(), s.St.Pool, slug)
		if err != nil {
			c.Data(http.StatusServiceUnavailable, "text/plain; charset=utf-8", []byte("暂时无法打开，请稍后再试"))
			return
		}
		share = found
	}
	if share == nil {
		c.Data(http.StatusNotFound, "text/html; charset=utf-8", []byte(`<!doctype html><meta charset="utf-8"><title>链接已失效</title><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#6b6780">这个分享链接不存在或已被撤销</body>`))
		return
	}
	header.Set("Cache-Control", "public, max-age=60")
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(share.HTML))
}
