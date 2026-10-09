package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modeltest"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type modelTestRequest struct {
	ProviderID    string                     `json:"providerId"`
	UpstreamModel string                     `json:"upstreamModel"`
	Kind          string                     `json:"kind"`
	Compat        *modelconfig.RequestCompat `json:"compat"`
	Prompt        string                     `json:"prompt"`
	EditPrompt    string                     `json:"editPrompt"`
	Size          string                     `json:"size"`
	Edit          bool                       `json:"edit"`
	SkipTools     bool                       `json:"skipTools"`
	// ReasoningEffort is sent as reasoning_effort; empty lets the model decide.
	ReasoningEffort string `json:"reasoningEffort"`
	// Quality is the platform image quality to request (default medium).
	Quality string `json:"quality"`
	// ImageParamRules tries unsaved profile rules instead of the model's
	// saved profile (the profile editor's test).
	ImageParamRules *modelconfig.ImageParamRules `json:"imageParamRules"`
	// CRUNModel is the page's copy of a schema-driven CRUN image model; CRUN
	// images are tested through its task API with these stored parameters.
	CRUNModel    *modelconfig.Model `json:"crunModel"`
	Resolution   string             `json:"resolution"`
	AspectRatio  string             `json:"aspectRatio"`
	ReferenceURL string             `json:"referenceUrl"`
}

// adminTestModel makes real chat or image calls for one model from the model
// catalog. The provider (address and key) comes from the saved configuration;
// the model's kind and request rules come from the request, so unsaved edits
// can be tried before saving. Disabled providers and models can be tested.
func (s *Server) adminTestModel(c *gin.Context, _ *store.User) {
	var input modelTestRequest
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	input.UpstreamModel = strings.TrimSpace(input.UpstreamModel)
	if input.UpstreamModel == "" {
		fail(c, apperr.E("validation_error", "请填写上游模型 ID", 422))
		return
	}
	if input.Kind != modelconfig.ModelKindChat && input.Kind != modelconfig.ModelKindImage {
		fail(c, apperr.E("validation_error", "只能测试对话或生图模型，请先设定模型类型", 422))
		return
	}
	if err := modelconfig.ValidateCompat("模型 "+input.UpstreamModel, input.Compat); err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	ctx := c.Request.Context()
	if input.ImageParamRules != nil {
		rules := modelconfig.NormalizeImageParamRules(*input.ImageParamRules)
		if err := modelconfig.ValidateImageParamRules("档案草稿", rules); err != nil {
			fail(c, apperr.E("validation_error", err.Error(), 422))
			return
		}
		if input.Compat == nil {
			input.Compat = &modelconfig.RequestCompat{}
		}
		if input.Compat.ImageParams == "" {
			input.Compat.ImageParams = "draft"
		}
		input.Compat.ImageParamRules = &rules
	} else if input.Compat != nil {
		// Ignore any stale copy from the page; use the saved profile.
		input.Compat.ImageParamRules = nil
		if err := modelconfig.ResolveCompatImageParams(ctx, s.St.Pool, input.Compat); err != nil {
			fail(c, apperr.E("validation_error", err.Error(), 422))
			return
		}
	}
	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	var provider modelconfig.Provider
	found := false
	for _, candidate := range cfg.Providers {
		if candidate.ID == strings.TrimSpace(input.ProviderID) {
			provider, found = candidate, true
			break
		}
	}
	if !found {
		fail(c, apperr.E("validation_error", "服务商还没有保存，请先保存配置再测试", 422))
		return
	}
	provider, hasKey := modelconfig.TestRoute(provider)
	if !hasKey {
		fail(c, apperr.E("validation_error", "服务商 "+provider.Name+" 没有填写 API Key 的线路", 422))
		return
	}
	selection := &modelconfig.Selection{Provider: provider, Model: modelconfig.Model{
		ID: input.UpstreamModel, Name: input.UpstreamModel, ProviderID: provider.ID,
		UpstreamModel: input.UpstreamModel, Kind: input.Kind, Compat: input.Compat,
	}}
	var result modeltest.Result
	if input.Kind == modelconfig.ModelKindImage && provider.Adapter == modelconfig.AdapterCRUN {
		if input.CRUNModel == nil || len(input.CRUNModel.UpstreamInputFields) == 0 {
			fail(c, apperr.E("validation_error", "CRUN 生图模型需要先读取上游参数再测试", 422))
			return
		}
		model := *input.CRUNModel
		model.UpstreamModel, model.ProviderID, model.Kind = input.UpstreamModel, provider.ID, modelconfig.ModelKindImage
		result = modeltest.CRUNImage(ctx, provider, model, modeltest.CRUNImageOptions{
			Prompt: input.Prompt, EditPrompt: input.EditPrompt, Edit: input.Edit, Quality: input.Quality,
			Resolution: input.Resolution, AspectRatio: input.AspectRatio, ReferenceURL: input.ReferenceURL,
		})
		ok(c, gin.H{"ok": result.OK(), "result": result, "provider": provider.Name, "route": provider.RouteName})
		return
	}
	if input.Kind == modelconfig.ModelKindChat {
		result = modeltest.Chat(ctx, selection, modeltest.ChatOptions{
			Prompt: input.Prompt, SkipTools: input.SkipTools, ReasoningEffort: input.ReasoningEffort,
		})
	} else {
		result = modeltest.Image(ctx, selection, s.Cfg.C2APrivateNetworkAllowed(), modeltest.ImageOptions{
			Prompt: input.Prompt, EditPrompt: input.EditPrompt, Size: input.Size, Edit: input.Edit, Quality: input.Quality,
		})
	}
	ok(c, gin.H{"ok": result.OK(), "result": result, "provider": provider.Name, "route": provider.RouteName})
}

type crunPriceQuoteRequest struct {
	ProviderID    string             `json:"providerId"`
	UpstreamModel string             `json:"upstreamModel"`
	CRUNModel     *modelconfig.Model `json:"crunModel"`
}

// adminCRUNPriceQuotes shows what CRUN would charge for each of a model's own
// resolution × quality × reference options, from its EstimateTask. It is a
// reference for the admin and is never saved; nothing is generated or billed.
func (s *Server) adminCRUNPriceQuotes(c *gin.Context, _ *store.User) {
	var input crunPriceQuoteRequest
	if err := bindJSON(c, &input); err != nil {
		fail(c, err)
		return
	}
	input.UpstreamModel = strings.TrimSpace(input.UpstreamModel)
	if input.UpstreamModel == "" || input.CRUNModel == nil || len(input.CRUNModel.UpstreamInputFields) == 0 {
		fail(c, apperr.E("validation_error", "请先选择 CRUN 模型并读取上游参数", 422))
		return
	}
	ctx := c.Request.Context()
	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		fail(c, err)
		return
	}
	var provider modelconfig.Provider
	found := false
	for _, candidate := range cfg.Providers {
		if candidate.ID == strings.TrimSpace(input.ProviderID) {
			provider, found = candidate, true
			break
		}
	}
	if !found || provider.Adapter != modelconfig.AdapterCRUN {
		fail(c, apperr.E("validation_error", "只能查询已保存的 CRUN 服务商", 422))
		return
	}
	provider, hasKey := modelconfig.TestRoute(provider)
	if !hasKey {
		fail(c, apperr.E("validation_error", "服务商 "+provider.Name+" 没有填写 API Key 的线路", 422))
		return
	}
	model := *input.CRUNModel
	model.UpstreamModel, model.ProviderID, model.Kind = input.UpstreamModel, provider.ID, modelconfig.ModelKindImage
	quotes, balance, err := modeltest.CRUNPriceQuotes(ctx, provider, model)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	ok(c, gin.H{"quotes": quotes, "balance": balance, "provider": provider.Name})
}
