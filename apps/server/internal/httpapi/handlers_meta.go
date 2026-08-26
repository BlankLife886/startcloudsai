package httpapi

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (s *Server) pricing(c *gin.Context) {
	ctx := c.Request.Context()
	legacyPrices, _, err := settings.TaskPrices(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	modelCfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	prices, priceRanges := modelconfig.OverlayTaskPrices(modelCfg, legacyPrices)
	pointRanges := make(map[string]gin.H, len(priceRanges))
	for taskType, priceRange := range priceRanges {
		pointRanges[taskType] = gin.H{"minPoints": priceRange.MinCents, "maxPoints": priceRange.MaxCents}
	}
	ok(c, gin.H{
		"taskPointPrices": prices, "taskPointPriceRanges": pointRanges,
		// Legacy aliases remain until older clients stop reading the historical Cents names.
		"taskPrices": prices, "taskPriceRanges": priceRanges,
	})
}

func (s *Server) runtimeConfig(c *gin.Context) {
	ctx := c.Request.Context()
	pageControls, err := settings.ResolvePageControls(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	allModels := modelconfig.PublicModels(cfg, "")
	allImageModels := make([]gin.H, 0)
	backgroundRemovalModels := make([]gin.H, 0)
	mediaTools := make([]gin.H, 0)
	catalogModels := make([]gin.H, 0, len(allModels))
	providerModels := make(map[string][]gin.H)
	imageItem := func(selection modelconfig.Selection, isDefault bool, workspace string) gin.H {
		model := selection.Model
		price := modelconfig.ResolveWorkspacePrice(cfg, workspace, model)
		return gin.H{
			"id": model.ID, "publicModelKey": model.ID, "label": model.Name, "name": model.Name,
			"kind":        model.Kind,
			"description": model.Description, "provider": selection.Provider.ID,
			"providerId": selection.Provider.ID, "providerName": selection.Provider.Name,
			"capabilities": []string{"textToImage", "imageToImage", "image.generate", "image.edit"},
			"billingMode":  "wallet", "creditCost": price.EffectiveCents,
			"pricePoints": price.EffectiveCents, "priceCents": price.EffectiveCents,
			"standardPricePoints": price.PriceCents, "discountPricePoints": price.DiscountPriceCents,
			"workspacePriceOverridden": price.Overridden,
			"default":                  isDefault, "fastMode": model.FastMode, "resolutions": model.Resolutions,
			"aspectRatios": model.AspectRatios, "aspectRatiosByResolution": model.AspectRatiosByResolution, "qualities": model.Qualities,
			"transparentBackground": model.TransparentBackground, "outputFormats": model.OutputFormats,
			"moderationLevels": model.ModerationLevels, "maxReferenceImages": model.MaxReferenceImages,
			"maxImages":   model.GenerationMaxImages(),
			"inputFields": model.UpstreamInputFields, "inputSchema": model.UpstreamInputSchema,
		}
	}
	chatItem := func(selection modelconfig.Selection, isDefault bool, workspace string) gin.H {
		model := selection.Model
		price := modelconfig.ResolveWorkspacePrice(cfg, workspace, model)
		reasoningEfforts, defaultReasoningEffort, reasoningPrices, reasoningEffortItems := reasoningModelPayload(model, &cfg)
		return gin.H{
			"id": model.ID, "model": model.ID, "label": model.Name, "name": model.Name,
			"kind":        model.Kind,
			"description": model.Description, "provider": selection.Provider.Name,
			"providerId": selection.Provider.ID, "providerName": selection.Provider.Name,
			"pricePoints": price.EffectiveCents, "standardPricePoints": price.PriceCents,
			"discountPricePoints": price.DiscountPriceCents, "workspacePriceOverridden": price.Overridden,
			"default":                   isDefault,
			"supportedReasoningEfforts": reasoningEfforts, "defaultReasoningEffort": defaultReasoningEffort,
			"reasoningPrices": reasoningPrices, "reasoningEfforts": reasoningEffortItems,
		}
	}
	toolItem := func(selection modelconfig.Selection) gin.H {
		model := selection.Model
		price := modelconfig.EffectivePrice(model)
		item := gin.H{
			"id": model.ID, "publicModelKey": model.ID, "label": model.Name, "name": model.Name,
			"description": model.Description, "tool": model.Tool,
			"pricePoints": price, "standardPricePoints": model.PriceCents,
			"discountPricePoints": model.DiscountPriceCents, "default": model.Default,
			"modality": model.Modality, "operations": model.Operations,
			"inputFields":         model.UpstreamInputFields,
			"requiredInputFields": model.UpstreamRequiredInputFields,
			"inputSchema":         model.UpstreamInputSchema,
		}
		if pricing := model.ImageUpscalePricing; pricing != nil && model.Tool == modelconfig.ImageToolUpscale {
			highPrice := pricing.HighPriceCents
			if pricing.HighDiscountPriceCents != nil {
				highPrice = *pricing.HighDiscountPriceCents
			}
			item["imageUpscalePricing"] = gin.H{
				"thresholdPixels":         pricing.ThresholdPixels,
				"lowStandardPricePoints":  model.PriceCents,
				"lowDiscountPricePoints":  model.DiscountPriceCents,
				"lowPricePoints":          price,
				"highStandardPricePoints": pricing.HighPriceCents,
				"highDiscountPricePoints": pricing.HighDiscountPriceCents,
				"highPricePoints":         highPrice,
			}
		}
		return item
	}
	for _, selection := range allModels {
		model := selection.Model
		if model.Kind == modelconfig.ModelKindImageTool {
			if model.Tool == modelconfig.ImageToolBackgroundRemove {
				backgroundRemovalModels = append(backgroundRemovalModels, toolItem(selection))
			} else {
				mediaTools = append(mediaTools, toolItem(selection))
			}
			continue
		}
		capabilities := []string{"text.chat", "text.analysis", "image.understand"}
		if model.Kind == modelconfig.ModelKindImage {
			capabilities = []string{"textToImage", "imageToImage", "image.generate", "image.edit"}
		}
		price := modelconfig.EffectivePrice(model)
		item := gin.H{
			"id": model.ID, "label": model.Name, "name": model.Name,
			"provider": selection.Provider.ID, "providerId": selection.Provider.ID,
			"providerName": selection.Provider.Name,
			"kind":         model.Kind, "tool": model.Tool, "description": model.Description, "capabilities": capabilities,
			"adapterReady": true, "default": model.Default, "fastMode": model.FastMode,
			"resolutions": model.Resolutions, "aspectRatios": model.AspectRatios,
			"aspectRatiosByResolution": model.AspectRatiosByResolution, "qualities": model.Qualities,
			"transparentBackground": model.TransparentBackground, "outputFormats": model.OutputFormats,
			"moderationLevels": model.ModerationLevels, "maxReferenceImages": model.MaxReferenceImages,
			"maxImages":   model.GenerationMaxImages(),
			"inputFields": model.UpstreamInputFields, "inputSchema": model.UpstreamInputSchema,
			"pricing": gin.H{
				"points": price, "cents": price, "standardPoints": model.PriceCents,
				"discountPoints": model.DiscountPriceCents,
				"unit":           map[bool]string{true: "image", false: "token"}[model.Kind != modelconfig.ModelKindChat],
			},
		}
		catalogModels = append(catalogModels, item)
		providerModels[selection.Provider.ID] = append(providerModels[selection.Provider.ID], item)
		if model.Kind == modelconfig.ModelKindImage {
			allImageModels = append(allImageModels, imageItem(selection, model.Default, ""))
		}
	}
	providers := make([]gin.H, 0, len(cfg.Providers))
	for _, provider := range cfg.Providers {
		if !provider.Enabled || len(providerModels[provider.ID]) == 0 {
			continue
		}
		providers = append(providers, gin.H{
			"id": provider.ID, "label": provider.Name, "adapter": provider.Adapter,
			"note": "由后台统一连接", "models": providerModels[provider.ID],
		})
	}
	workspaceImageModels := func(workspace string) []gin.H {
		selections := modelconfig.PublicModelsForWorkspace(cfg, workspace, modelconfig.ModelKindImage)
		items := make([]gin.H, 0, len(selections))
		for index, selection := range selections {
			items = append(items, imageItem(selection, index == 0, workspace))
		}
		return items
	}
	workspaceChatModels := func(workspace string) []gin.H {
		selections := modelconfig.PublicModelsForWorkspace(cfg, workspace, modelconfig.ModelKindChat)
		if workspace == modelconfig.WorkspaceUIDesign && len(selections) == 0 {
			selections = modelconfig.PublicModelsForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat)
		}
		items := make([]gin.H, 0, len(selections))
		for index, selection := range selections {
			items = append(items, chatItem(selection, index == 0, workspace))
		}
		return items
	}
	canvasImageModels := workspaceImageModels(modelconfig.WorkspaceCanvas)
	canvasTextModels := workspaceChatModels(modelconfig.WorkspaceCanvas)
	assistantImageModels := workspaceImageModels(modelconfig.WorkspaceAssistant)
	assistantTextModels := workspaceChatModels(modelconfig.WorkspaceAssistant)
	features := gin.H{
		"ai.assistant": gin.H{"enabled": len(assistantImageModels)+len(assistantTextModels) > 0, "config": gin.H{
			"imageModels": assistantImageModels,
			"textModels":  assistantTextModels,
		}},
		"ai.imageTools":           gin.H{"enabled": len(backgroundRemovalModels) > 0, "config": gin.H{"backgroundRemovalModels": backgroundRemovalModels}},
		"ai.mediaTools":           gin.H{"enabled": len(mediaTools) > 0, "config": gin.H{"tools": mediaTools}},
		"ai.wallpaperGeneration":  gin.H{"enabled": true, "config": gin.H{"publicModels": workspaceImageModels(modelconfig.WorkspaceT2I)}},
		"wallpaper":               gin.H{"enabled": true, "config": gin.H{"publicModels": workspaceImageModels(modelconfig.WorkspaceT2I)}},
		"ai.illustrationColoring": gin.H{"enabled": true, "config": gin.H{"publicModels": workspaceImageModels(modelconfig.WorkspaceColoring)}},
		"ai.uiDesign": gin.H{"enabled": true, "config": gin.H{
			"publicModels":   workspaceImageModels(modelconfig.WorkspaceUIDesign),
			"analysisModels": workspaceChatModels(modelconfig.WorkspaceUIDesign),
		}},
		"ai.ecommerceDesign": gin.H{"enabled": true, "config": gin.H{
			"publicModels":   workspaceImageModels(modelconfig.WorkspaceEcommerce),
			"analysisModels": workspaceChatModels(modelconfig.WorkspaceEcommerce),
		}},
		"ai.ultraModelSheet": gin.H{"enabled": true, "config": gin.H{"publicModels": workspaceImageModels(modelconfig.WorkspaceModelSheet)}},
		"ai.gameDesign":      gin.H{"enabled": true, "config": gin.H{"publicModels": workspaceImageModels(modelconfig.WorkspaceGameArt)}},
		"ai.optimize":        gin.H{"enabled": true, "config": gin.H{"publicModels": workspaceImageModels(modelconfig.WorkspaceT2I)}},
		"ai.puzzle":          gin.H{"enabled": true, "config": gin.H{"publicModels": allImageModels}},
		"ai.infiniteCanvas": gin.H{"enabled": len(canvasImageModels)+len(canvasTextModels) > 0, "config": gin.H{
			"imageModels": canvasImageModels,
			"textModels":  canvasTextModels,
		}},
	}
	ok(c, gin.H{
		"routes": gin.H{}, "features": features, "pageLayout": gin.H{}, "pageControls": pageControls,
		"aiModelCatalog": gin.H{
			"providers": providers, "models": catalogModels, "publicModels": allImageModels,
			"featurePublicModels": []any{}, "updatedAt": time.Now().UTC().Format(time.RFC3339),
		},
		"blacklist": gin.H{"blocked": false, "reason": ""}, "mqtt": nil,
	})
}

func (s *Server) metaChangelog(c *gin.Context) {
	rows, err := store.ListChangelog(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, entry := range rows {
		items = append(items, changelogDict(entry))
	}
	ok(c, gin.H{"items": items})
}

func (s *Server) metaChangelogLatest(c *gin.Context) {
	entry, err := store.LatestChangelog(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	if entry == nil {
		ok(c, nil)
		return
	}
	ok(c, changelogDict(entry))
}

func (s *Server) metaAnnouncements(c *gin.Context) {
	now := time.Now().UTC()
	rows, err := store.ListAnnouncements(c.Request.Context(), s.St.Pool, &now)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, a := range rows {
		items = append(items, announcementDict(a))
	}
	ok(c, gin.H{"items": items})
}

// health H3：db + redis 连通性检查，任一失败返回 503（compose healthcheck 在用）。
func (s *Server) health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	dbStatus, redisStatus := "ok", "ok"
	if err := s.St.Pool.Ping(ctx); err != nil {
		dbStatus = "error"
	}
	if err := s.Queue.Ping(); err != nil {
		redisStatus = "error"
	}
	status := "ok"
	if dbStatus != "ok" || redisStatus != "ok" {
		status = "degraded"
		c.JSON(503, gin.H{"success": false, "code": "unhealthy",
			"error": "服务依赖不可用", "data": gin.H{"status": status, "db": dbStatus, "redis": redisStatus}})
		return
	}
	ok(c, gin.H{"status": status, "db": dbStatus, "redis": redisStatus})
}
