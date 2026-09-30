package httpapi

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modelprovider"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) adminGetModelConfig(c *gin.Context, _ *store.User) {
	cfg, err := modelconfig.AdminView(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, cfg)
}

func (s *Server) adminPutModelConfig(c *gin.Context, _ *store.User) {
	var input modelconfig.Config
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	allowPrivate := s.Cfg.C2APrivateNetworkAllowed()
	for index := range input.Providers {
		provider := &input.Providers[index]
		if len(provider.Routes) == 0 {
			provider.BaseURL = strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
			if provider.BaseURL == "" || netguard.ValidateURL(provider.BaseURL, allowPrivate, false) != nil {
				fail(c, apperr.E("validation_error", "服务商 "+provider.Name+" 的地址无效或指向受限网络", 422))
				return
			}
		}
		for routeIndex := range provider.Routes {
			route := &provider.Routes[routeIndex]
			route.BaseURL = strings.TrimRight(strings.TrimSpace(route.BaseURL), "/")
			if route.BaseURL == "" || netguard.ValidateURL(route.BaseURL, allowPrivate, false) != nil {
				fail(c, apperr.E("validation_error", "服务商 "+provider.Name+" 的线路地址无效或指向受限网络", 422))
				return
			}
		}
	}
	prepared, err := modelconfig.PrepareAdminSave(c.Request.Context(), s.St.Pool, input, s.Cfg.AppSecret)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	// Deleting, disabling, pausing or re-routing a site model that a callable
	// API model points at makes /v1 answer 503; the admin confirms first.
	if c.Query("confirmApiImpact") != "1" {
		impacted, err := s.apiModelsBrokenBy(c.Request.Context(), prepared)
		if err != nil {
			fail(c, err)
			return
		}
		if len(impacted) > 0 {
			names := make([]string, 0, len(impacted))
			for _, item := range impacted {
				names = append(names, fmt.Sprintf("「%s」（%s）", item["apiName"], item["reason"]))
			}
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"success": false, "code": "api_model_impact",
				"error": "这次保存会让以下API 调用模型无法调用（返回 503）：" + strings.Join(names, "、"),
				"data":  gin.H{"models": impacted}})
			return
		}
	}
	if err := modelconfig.Save(c.Request.Context(), s.St.Pool, prepared); err != nil {
		fail(c, err)
		return
	}
	// Site price changes reach following API models now rather than at the
	// next sweep, so increases are announced right away.
	if _, err := apicatalog.Reconcile(c.Request.Context(), s.St.Pool, time.Now().UTC()); err != nil {
		log.Printf("reconcile developer API models after model config save: %v", err)
	}
	out, err := modelconfig.AdminView(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (s *Server) adminDiscoverProviderModels(c *gin.Context, _ *store.User) {
	var provider modelconfig.Provider
	if err := bindJSON(c, &provider); err != nil {
		fail(c, err)
		return
	}
	provider.BaseURL = strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
	// Test the requested draft route, not the (possibly empty/stale) primary route.
	if routeID := strings.TrimSpace(c.Query("routeId")); routeID != "" {
		found := false
		for _, route := range provider.Routes {
			if route.ID == routeID {
				provider.Routes = []modelconfig.ProviderRoute{route}
				provider.BaseURL = strings.TrimRight(strings.TrimSpace(route.BaseURL), "/")
				provider.APIKey = route.APIKey
				provider.TimeoutSecs = route.TimeoutSecs
				found = true
				break
			}
		}
		if !found {
			fail(c, apperr.E("validation_error", "线路不存在", 422))
			return
		}
	}
	allowPrivate := s.Cfg.C2APrivateNetworkAllowed()
	if !modelconfig.ValidAdapter(provider.Adapter) {
		fail(c, apperr.E("validation_error", "请选择有效的调用协议", 422))
		return
	}
	if provider.BaseURL == "" || netguard.ValidateURL(provider.BaseURL, allowPrivate, false) != nil {
		fail(c, apperr.E("validation_error", "服务商地址无效或指向受限网络", 422))
		return
	}
	needsSavedSecrets := provider.APIKey == "" || strings.HasPrefix(provider.APIKey, "****")
	for _, route := range provider.Routes {
		if route.APIKey == "" || strings.HasPrefix(route.APIKey, "****") {
			needsSavedSecrets = true
			break
		}
	}
	if needsSavedSecrets {
		runtimeCfg, err := modelconfig.Runtime(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
		if err != nil {
			fail(c, err)
			return
		}
		for _, saved := range runtimeCfg.Providers {
			if saved.ID == provider.ID {
				if provider.APIKey == "" || strings.HasPrefix(provider.APIKey, "****") {
					provider.APIKey = saved.APIKey
				}
				for index := range provider.Routes {
					route := &provider.Routes[index]
					if route.APIKey != "" && !strings.HasPrefix(route.APIKey, "****") {
						continue
					}
					for _, savedRoute := range saved.Routes {
						if savedRoute.ID == route.ID {
							route.APIKey = savedRoute.APIKey
							break
						}
					}
				}
				break
			}
		}
	}
	if routeID := strings.TrimSpace(c.Query("routeId")); routeID != "" {
		found := false
		for _, route := range provider.Routes {
			if route.ID != routeID {
				continue
			}
			provider.BaseURL = strings.TrimRight(strings.TrimSpace(route.BaseURL), "/")
			provider.APIKey = route.APIKey
			provider.TimeoutSecs = route.TimeoutSecs
			found = true
			break
		}
		if !found {
			fail(c, apperr.E("validation_error", "线路不存在", 422))
			return
		}
		if provider.BaseURL == "" || netguard.ValidateURL(provider.BaseURL, allowPrivate, false) != nil {
			fail(c, apperr.E("validation_error", "线路地址无效或指向受限网络", 422))
			return
		}
	}
	if strings.TrimSpace(provider.APIKey) == "" {
		fail(c, apperr.E("validation_error", "请先填写 API Key", 422))
		return
	}
	if model := strings.TrimSpace(c.Query("model")); model != "" {
		entry, err := modelprovider.DescribeCRUNModel(
			c.Request.Context(), provider, model, allowPrivate,
		)
		if err != nil {
			fail(c, apperr.E("model_schema_failed", err.Error(), 502))
			return
		}
		ok(c, entry)
		return
	}
	catalog, err := modelprovider.DiscoverModels(c.Request.Context(), provider, allowPrivate)
	if err != nil {
		fail(c, apperr.E("model_discovery_failed", err.Error(), 502))
		return
	}
	if len(catalog.Models) == 0 {
		fail(c, apperr.E("model_discovery_empty", "服务商连接成功，但没有返回模型", 502))
		return
	}
	if strings.TrimSpace(c.Query("routeId")) != "" {
		ok(c, gin.H{
			"ok": true, "modelCount": len(catalog.Models), "models": catalog.Models,
			"warning": catalog.Warning,
			"compatibleCount": catalog.CompatibleCount, "taskModelCount": catalog.TaskModelCount,
		})
		return
	}
	ok(c, gin.H{
		"models": catalog.Models, "modelCount": len(catalog.Models),
		"entries":         catalog.Entries,
		"compatibleCount": catalog.CompatibleCount, "taskModelCount": catalog.TaskModelCount,
		"catalogSource": catalog.Source, "warning": catalog.Warning,
	})
}

// apiModelsBrokenBy lists callable API models whose site model runs under
// the current configuration but would not under next.
func (s *Server) apiModelsBrokenBy(ctx context.Context, next modelconfig.Config) ([]gin.H, error) {
	current, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		return nil, err
	}
	entries, err := s.developerCatalog(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	impacted := []gin.H{}
	for _, entry := range entries {
		if !entry.CallableAt(now) {
			continue
		}
		if _, before := apicatalog.Runnable(current, entry.TargetModelID); !before {
			continue
		}
		if _, after := apicatalog.Runnable(next, entry.TargetModelID); after {
			continue
		}
		reason := "服务商停用或线路不是 OpenAI 协议"
		if model, found := siteModelByID(next, entry.TargetModelID); !found {
			reason = "站内模型被删除"
		} else if !model.Enabled {
			reason = "站内模型被停用"
		} else if !model.Available() {
			reason = "站内模型设为维护"
		}
		impacted = append(impacted, gin.H{"id": entry.ID, "apiName": entry.APIName, "targetModelId": entry.TargetModelID, "reason": reason})
	}
	return impacted, nil
}
