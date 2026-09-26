package httpapi

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
)

const pageControlCacheTTL = 5 * time.Second

type pageControlCache struct {
	mu        sync.Mutex
	controls  map[string]settings.PageControl
	expiresAt time.Time
}

func (s *Server) resolvePageControls(ctx context.Context) (map[string]settings.PageControl, error) {
	now := time.Now()
	s.pageControls.mu.Lock()
	defer s.pageControls.mu.Unlock()
	if s.pageControls.controls != nil && now.Before(s.pageControls.expiresAt) {
		return s.pageControls.controls, nil
	}
	controls, err := settings.ResolvePageControls(ctx, s.St.Pool)
	if err != nil {
		return nil, err
	}
	s.pageControls.controls = controls
	s.pageControls.expiresAt = now.Add(pageControlCacheTTL)
	return controls, nil
}

func (s *Server) invalidatePageControls() {
	s.pageControls.mu.Lock()
	s.pageControls.controls = nil
	s.pageControls.expiresAt = time.Time{}
	s.pageControls.mu.Unlock()
}

func (s *Server) developerAPIEnabled(c *gin.Context) bool {
	controls, err := s.resolvePageControls(c.Request.Context())
	if err != nil {
		fail(c, err)
		return false
	}
	control := controls["developer_api"]
	if control.Status == settings.PageStatusNormal {
		return true
	}
	message := strings.TrimSpace(control.Reason)
	if control.Status == settings.PageStatusRemoved {
		if message == "" {
			message = "开放 API 暂未开放。"
		}
		fail(c, apperr.E("open_api_disabled", message, http.StatusNotFound))
		return false
	}
	if message == "" {
		message = "开放 API 暂时不可用。"
	}
	fail(c, apperr.E("open_api_unavailable", message, http.StatusServiceUnavailable))
	return false
}

func (s *Server) developerAPIOnly(handler gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !s.developerAPIEnabled(c) {
			return
		}
		handler(c)
	}
}
