package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"

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
	if err := modelconfig.Save(c.Request.Context(), s.St.Pool, prepared); err != nil {
		fail(c, err)
		return
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
			"ok": true, "modelCount": len(catalog.Models),
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
