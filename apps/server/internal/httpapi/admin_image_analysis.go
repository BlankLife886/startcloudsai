package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func selectAdminImageAnalysisModel(cfg modelconfig.Config, providerID, modelID, reasoningEffort string) (*modelconfig.Selection, string, bool) {
	providerID = strings.TrimSpace(providerID)
	modelID = strings.TrimSpace(modelID)
	if providerID == "" || modelID == "" {
		return nil, "", false
	}
	var provider *modelconfig.Provider
	for index := range cfg.Providers {
		candidate := &cfg.Providers[index]
		if candidate.ID == providerID && candidate.Enabled {
			provider = candidate
			break
		}
	}
	if provider == nil {
		return nil, "", false
	}
	routes := modelconfig.ExecutionRoutes(*provider)
	if len(routes) == 0 {
		return nil, "", false
	}
	for index := range cfg.Models {
		model := cfg.Models[index]
		if model.ID != modelID || model.ProviderID != providerID || !model.Enabled || model.Kind != modelconfig.ModelKindChat {
			continue
		}
		effort := strings.ToLower(strings.TrimSpace(reasoningEffort))
		if effort == "" && model.ReasoningPricing != nil {
			effort = model.ReasoningPricing.DefaultEffort
		}
		if effort != "" && !containsReasoningEffort(model.SupportedReasoningEfforts, effort) {
			return nil, "", false
		}
		return &modelconfig.Selection{Provider: routes[0], Model: model}, effort, true
	}
	return nil, "", false
}

func containsReasoningEffort(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (s *Server) adminImageAnalysisClient(ctx context.Context) (*sub2api.Client, error) {
	providerID, err := settings.GetString(ctx, s.St.Pool, "admin_image_analysis_provider_id")
	if err != nil {
		return nil, err
	}
	modelID, err := settings.GetString(ctx, s.St.Pool, "admin_image_analysis_model_id")
	if err != nil {
		return nil, err
	}
	reasoningEffort, err := settings.GetString(ctx, s.St.Pool, "admin_image_analysis_reasoning_effort")
	if err != nil {
		return nil, err
	}
	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	selection, effort, ok := selectAdminImageAnalysisModel(cfg, providerID, modelID, reasoningEffort)
	if !ok {
		return nil, apperr.E("assistant_unavailable", "后台图片分析服务尚未正确配置", http.StatusServiceUnavailable)
	}
	client, err := s.analysisClientForSelection(selection)
	if err != nil {
		return nil, err
	}
	if effort != "" {
		client = client.WithReasoningEffort(effort)
	}
	return client, nil
}

func (s *Server) analysisClientForSelection(selection *modelconfig.Selection) (*sub2api.Client, error) {
	provider := selection.Provider
	if strings.TrimSpace(provider.APIKey) == "" {
		return nil, apperr.E("assistant_unavailable", "图片分析服务商没有可用的 API Key", http.StatusServiceUnavailable)
	}
	client, err := sub2api.New(
		provider.BaseURL, provider.APIKey, selection.Model.UpstreamModel,
		s.Cfg.Sub2APIImageModel, provider.TimeoutSecs,
	)
	if err != nil {
		return nil, apperr.E("assistant_unavailable", "图片分析模型配置无效", http.StatusServiceUnavailable)
	}
	if provider.Adapter == modelconfig.AdapterCRUN {
		client = client.WithAPIKeyHeader("x-api-key")
	}
	return client, nil
}
