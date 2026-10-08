package httpapi

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modelprovider"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) adminGetModelPresets(c *gin.Context, _ *store.User) {
	presets, customized, err := modelconfig.LoadPresets(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"presets": presets, "customized": customized})
}

func (s *Server) adminPutModelPresets(c *gin.Context, _ *store.User) {
	var input struct {
		Presets []modelconfig.ProviderPreset `json:"presets"`
	}
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	presets, err := modelconfig.SavePresets(c.Request.Context(), s.St.Pool, input.Presets)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	ok(c, gin.H{"presets": presets, "customized": true})
}

func (s *Server) adminResetModelPresets(c *gin.Context, _ *store.User) {
	if err := modelconfig.ResetPresets(c.Request.Context(), s.St.Pool); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"presets": modelconfig.DefaultPresets(), "customized": false})
}

func (s *Server) adminGetImageParamProfiles(c *gin.Context, _ *store.User) {
	profiles, customized, err := modelconfig.LoadImageParamProfiles(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"profiles": profiles, "customized": customized, "droppable": modelconfig.ImageParamDroppable})
}

// adminPutImageParamProfiles saves the profiles and refreshes every model
// that uses one, so edits take effect without re-saving models.
func (s *Server) adminPutImageParamProfiles(c *gin.Context, _ *store.User) {
	var input struct {
		Profiles []modelconfig.ImageParamProfile `json:"profiles"`
	}
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	profiles, err := modelconfig.SaveImageParamProfiles(c.Request.Context(), s.St.Pool, input.Profiles)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	ok(c, gin.H{"profiles": profiles, "customized": true, "droppable": modelconfig.ImageParamDroppable})
}

func (s *Server) adminResetImageParamProfiles(c *gin.Context, _ *store.User) {
	if err := modelconfig.ResetImageParamProfiles(c.Request.Context(), s.St.Pool); err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	ok(c, gin.H{"profiles": modelconfig.DefaultImageParamProfiles(), "customized": false, "droppable": modelconfig.ImageParamDroppable})
}

type connectionCheck struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Detail    string `json:"detail,omitempty"`
	Error     string `json:"error,omitempty"`
}

// adminTestProviderConnection checks that a provider draft is reachable: its
// address, path and key can read the model list. Chat and image calls are
// tested per model from the model catalog (adminTestModel).
func (s *Server) adminTestProviderConnection(c *gin.Context, _ *store.User) {
	provider, valid := s.draftProvider(c)
	if !valid {
		return
	}
	ctx := c.Request.Context()
	checks := []connectionCheck{}

	started := time.Now()
	catalog, err := modelprovider.DiscoverModels(ctx, provider, s.Cfg.C2APrivateNetworkAllowed())
	listCheck := connectionCheck{Name: "models", LatencyMs: time.Since(started).Milliseconds()}
	switch {
	case err != nil:
		listCheck.Error = err.Error()
	case catalog.CompatibleCount == 0 && len(catalog.Entries) > 0:
		ids := make([]string, 0, len(catalog.Entries))
		for _, entry := range catalog.Entries {
			ids = append(ids, entry.ID)
		}
		listCheck.Error = "连接正常，但上游返回的模型都无法用于对话或生图：" + strings.Join(ids, "、")
	case len(catalog.Models) == 0:
		listCheck.Error = "连接正常，但上游没有返回任何模型"
	default:
		listCheck.OK = true
		listCheck.Detail = strings.TrimSpace(strconv.Itoa(len(catalog.Models)) + " 个可用模型：" + catalogPreview(catalog.Models) + " " + catalog.Warning)
	}
	checks = append(checks, listCheck)

	allOK := true
	for _, check := range checks {
		allOK = allOK && check.OK
	}
	ok(c, gin.H{"ok": allOK, "checks": checks})
}

func catalogPreview(models []string) string {
	if len(models) <= 6 {
		return strings.Join(models, "、")
	}
	return strings.Join(models[:6], "、") + " 等"
}
