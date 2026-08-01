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
	for index := range input.Providers {
		provider := &input.Providers[index]
		if len(provider.Routes) == 0 {
			provider.BaseURL = strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
			if provider.BaseURL == "" || netguard.ValidateURL(provider.BaseURL, s.Cfg.AppEnv == "development", false) != nil {
				fail(c, apperr.E("validation_error", "服务商 "+provider.Name+" 的地址无效或指向受限网络", 422))
				return
			}
		}
		for routeIndex := range provider.Routes {
			route := &provider.Routes[routeIndex]
			route.BaseURL = strings.TrimRight(strings.TrimSpace(route.BaseURL), "/")
			if route.BaseURL == "" || netguard.ValidateURL(route.BaseURL, s.Cfg.AppEnv == "development", false) != nil {
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
	if !modelconfig.ValidAdapter(provider.Adapter) {
		fail(c, apperr.E("validation_error", "请选择有效的调用协议", 422))
		return
	}
	if provider.BaseURL == "" || netguard.ValidateURL(provider.BaseURL, s.Cfg.AppEnv == "development", false) != nil {
		fail(c, apperr.E("validation_error", "服务商地址无效或指向受限网络", 422))
		return
	}
	if provider.APIKey == "" || strings.HasPrefix(provider.APIKey, "****") {
		runtimeCfg, err := modelconfig.Runtime(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
		if err != nil {
			fail(c, err)
			return
		}
		for _, saved := range runtimeCfg.Providers {
			if saved.ID == provider.ID {
				provider.APIKey = saved.APIKey
				break
			}
		}
	}
	if strings.TrimSpace(provider.APIKey) == "" {
		fail(c, apperr.E("validation_error", "请先填写 API Key", 422))
		return
	}
	catalog, err := modelprovider.DiscoverModels(c.Request.Context(), provider, s.Cfg.AppEnv == "development")
	if err != nil {
		fail(c, apperr.E("model_discovery_failed", err.Error(), 502))
		return
	}
	if len(catalog.Models) == 0 {
		fail(c, apperr.E("model_discovery_empty", "服务商连接成功，但没有返回模型", 502))
		return
	}
	ok(c, gin.H{
		"models": catalog.Models, "modelCount": len(catalog.Models),
		"compatibleCount": catalog.CompatibleCount, "taskModelCount": catalog.TaskModelCount,
		"catalogSource": catalog.Source, "warning": catalog.Warning,
	})
}
