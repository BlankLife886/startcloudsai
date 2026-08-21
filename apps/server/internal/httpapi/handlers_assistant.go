package httpapi

import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const (
	maxAssistantMessages     = 60
	maxAssistantMessageRunes = 12000
	maxAssistantTotalRunes   = 80000
	maxAssistantReferences   = 4
	maxAssistantImageBytes   = 8 << 20
	maxAssistantImagesBytes  = 12 << 20
)

type assistantChatIn struct {
	Messages        []sub2api.Message `json:"messages"`
	ReferenceImages []string          `json:"referenceImages"`
}

type assistantImageIn struct {
	Prompt          string   `json:"prompt"`
	Size            string   `json:"size"`
	Quality         string   `json:"quality"`
	Count           int      `json:"n"`
	ReferenceImages []string `json:"referenceImages"`
}

func (s *Server) assistantClient(ctx *gin.Context) (*sub2api.Client, error) {
	resolved, err := s.assistantResolvedConfig(ctx.Request.Context())
	if err != nil {
		return nil, err
	}
	client, err := sub2api.New(resolved.BaseURL, resolved.APIKey, resolved.ChatModel, resolved.ImageModel, resolved.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if !client.Configured() {
		return nil, apperr.E("assistant_unavailable", "AI 对话服务尚未配置", http.StatusServiceUnavailable)
	}
	return client, nil
}

func (s *Server) assistantResolvedConfig(ctx context.Context) (settings.Sub2APIConfig, error) {
	return settings.ResolveSub2API(ctx, s.St.Pool, settings.Sub2APIConfig{
		BaseURL: s.Cfg.Sub2APIBaseURL, APIKey: s.Cfg.Sub2APIAPIKey,
		ChatModel: s.Cfg.Sub2APIChatModel, ImageModel: s.Cfg.Sub2APIImageModel,
		TimeoutSecs: s.Cfg.Sub2APITimeoutSecs,
	}, s.Cfg.AppSecret)
}

func (s *Server) requireAssistant(c *gin.Context) (*sub2api.Client, error) {
	if _, err := s.requireUser(c); err != nil {
		return nil, err
	}
	return s.assistantClient(c)
}

func reasoningModelPayload(model modelconfig.Model) ([]string, string, gin.H) {
	efforts := model.SupportedReasoningEfforts
	if len(efforts) == 0 {
		efforts = modelconfig.ReasoningEffortsForModel(model.UpstreamModel)
	}
	defaultEffort := ""
	if model.ReasoningPricing != nil {
		defaultEffort = model.ReasoningPricing.DefaultEffort
	}
	if defaultEffort == "" {
		if containsString(efforts, "medium") {
			defaultEffort = "medium"
		} else if len(efforts) > 0 {
			defaultEffort = efforts[0]
		}
	}
	prices := gin.H{}
	for _, effort := range efforts {
		assistantPrice := modelconfig.ResolveReasoningPrice(model, effort, modelconfig.ReasoningPriceScopeAssistant)
		canvasPrice := modelconfig.ResolveReasoningPrice(model, effort, modelconfig.ReasoningPriceScopeCanvasAgent)
		prices[effort] = gin.H{
			"assistantStandardPricePoints":   assistantPrice.StandardCents,
			"assistantPricePoints":           assistantPrice.EffectiveCents,
			"canvasAgentStandardPricePoints": canvasPrice.StandardCents,
			"canvasAgentPricePoints":         canvasPrice.EffectiveCents,
		}
	}
	return append([]string(nil), efforts...), defaultEffort, prices
}

func (s *Server) assistantConfig(c *gin.Context) {
	user, err := s.currentUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	modelCfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	type modelOption struct {
		Label                     string              `json:"label"`
		Model                     string              `json:"model"`
		Source                    string              `json:"source"`
		Provider                  string              `json:"provider"`
		Description               string              `json:"description"`
		StandardPricePoints       *int64              `json:"standardPricePoints,omitempty"`
		DiscountPricePoints       *int64              `json:"discountPricePoints"`
		PricePoints               *int64              `json:"pricePoints,omitempty"`
		Resolutions               []string            `json:"resolutions,omitempty"`
		Default                   bool                `json:"default,omitempty"`
		FastMode                  bool                `json:"fastMode,omitempty"`
		AspectRatios              []string            `json:"aspectRatios,omitempty"`
		AspectRatiosByResolution  map[string][]string `json:"aspectRatiosByResolution,omitempty"`
		Qualities                 []string            `json:"qualities,omitempty"`
		TransparentBackground     bool                `json:"transparentBackground"`
		OutputFormats             []string            `json:"outputFormats"`
		ModerationLevels          []string            `json:"moderationLevels"`
		MaxReferenceImages        int                 `json:"maxReferenceImages"`
		SupportedReasoningEfforts []string            `json:"supportedReasoningEfforts,omitempty"`
		DefaultReasoningEffort    string              `json:"defaultReasoningEffort,omitempty"`
		ReasoningPrices           gin.H               `json:"reasoningPrices,omitempty"`
	}
	reasoningOptions := func(model string) ([]string, string) {
		efforts := modelconfig.ReasoningEffortsForModel(model)
		defaultEffort := ""
		if containsString(efforts, "medium") {
			defaultEffort = "medium"
		} else if len(efforts) > 0 {
			defaultEffort = efforts[0]
		}
		return efforts, defaultEffort
	}
	buildOptions := func(kind string) []modelOption {
		selections := modelconfig.PublicModelsForWorkspace(modelCfg, modelconfig.WorkspaceAssistant, kind)
		options := make([]modelOption, 0, len(selections))
		for index, selection := range selections {
			standardPrice := selection.Model.PriceCents
			effectivePrice := modelconfig.EffectivePrice(selection.Model)
			description := selection.Model.Description
			if description == "" {
				if kind == modelconfig.ModelKindImage {
					description = "图片生成模型"
				} else {
					description = "对话与图片理解模型"
				}
			}
			reasoningEfforts, defaultReasoningEffort, reasoningPrices := []string(nil), "", gin.H(nil)
			if kind == modelconfig.ModelKindChat {
				reasoningEfforts, defaultReasoningEffort, reasoningPrices = reasoningModelPayload(selection.Model)
			}
			options = append(options, modelOption{
				Label: selection.Model.Name, Model: selection.Model.ID, Source: "configured",
				Provider: selection.Provider.Name, Description: description,
				StandardPricePoints: &standardPrice,
				DiscountPricePoints: selection.Model.DiscountPriceCents,
				PricePoints:         &effectivePrice,
				Resolutions:         selection.Model.Resolutions, Default: index == 0, FastMode: selection.Model.FastMode,
				AspectRatios: selection.Model.AspectRatios, AspectRatiosByResolution: selection.Model.AspectRatiosByResolution,
				Qualities:             selection.Model.Qualities,
				TransparentBackground: selection.Model.TransparentBackground,
				OutputFormats:         selection.Model.OutputFormats, ModerationLevels: selection.Model.ModerationLevels,
				MaxReferenceImages:        selection.Model.MaxReferenceImages,
				SupportedReasoningEfforts: reasoningEfforts, DefaultReasoningEffort: defaultReasoningEffort,
				ReasoningPrices: reasoningPrices,
			})
		}
		return options
	}
	conversationOptions := buildOptions(modelconfig.ModelKindChat)
	imageOptions := buildOptions(modelconfig.ModelKindImage)
	if len(conversationOptions) > 0 || len(imageOptions) > 0 {
		chatModel, imageModel := "", ""
		if len(conversationOptions) > 0 {
			chatModel = conversationOptions[0].Model
		}
		if len(imageOptions) > 0 {
			imageModel = imageOptions[0].Model
		}
		ok(c, gin.H{
			"chatModel": chatModel, "imageModel": imageModel,
			"conversationModels": conversationOptions, "imageModels": imageOptions,
			"modelDiscoveryAvailable": true, "conversationModelMode": "configured",
		})
		return
	}
	// Anonymous visitors may inspect explicitly assigned public model metadata,
	// but must never fall back to legacy provider discovery.
	if user == nil {
		ok(c, gin.H{
			"chatModel": "", "imageModel": "",
			"conversationModels": []modelOption{}, "imageModels": []modelOption{},
			"modelDiscoveryAvailable": false, "conversationModelMode": "configured",
		})
		return
	}

	client, err := s.requireAssistant(c)
	if err != nil {
		fail(c, err)
		return
	}
	resolved, resolveErr := s.assistantResolvedConfig(c.Request.Context())
	if resolveErr != nil {
		fail(c, resolveErr)
		return
	}
	options := make([]modelOption, 0, len(resolved.ChatModels)+8)
	configuredCatalog := len(resolved.ChatModels) > 0
	seenModels := map[string]bool{}
	aliasLabels := make([]string, 0, len(resolved.ChatModels))
	for label := range resolved.ChatModels {
		aliasLabels = append(aliasLabels, label)
	}
	sort.Strings(aliasLabels)
	for _, label := range aliasLabels {
		model := strings.TrimSpace(resolved.ChatModels[label])
		if model == "" {
			continue
		}
		reasoningEfforts, defaultReasoningEffort := reasoningOptions(model)
		options = append(options, modelOption{Label: label, Model: model, Source: "legacy", SupportedReasoningEfforts: reasoningEfforts, DefaultReasoningEffort: defaultReasoningEffort})
		seenModels[model] = true
	}
	if !seenModels[client.ChatModel()] {
		reasoningEfforts, defaultReasoningEffort := reasoningOptions(client.ChatModel())
		options = append(options, modelOption{Label: client.ChatModel(), Model: client.ChatModel(), Source: "default", SupportedReasoningEfforts: reasoningEfforts, DefaultReasoningEffort: defaultReasoningEffort})
		seenModels[client.ChatModel()] = true
	}
	modelCtx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Second)
	upstreamModels, modelErr := client.ListModels(modelCtx)
	cancel()
	sort.Strings(upstreamModels)
	if !configuredCatalog {
		for _, model := range upstreamModels {
			if seenModels[model] || !assistantConversationModel(model, client.ImageModel()) {
				continue
			}
			reasoningEfforts, defaultReasoningEffort := reasoningOptions(model)
			options = append(options, modelOption{Label: model, Model: model, Source: "upstream", SupportedReasoningEfforts: reasoningEfforts, DefaultReasoningEffort: defaultReasoningEffort})
			seenModels[model] = true
		}
	}
	modelMode := "upstream"
	if configuredCatalog {
		modelMode = "configured"
	}
	ok(c, gin.H{
		"chatModel": client.ChatModel(), "imageModel": client.ImageModel(),
		"conversationModels":      options,
		"imageModels":             []modelOption{{Label: client.ImageModel(), Model: client.ImageModel(), Source: "legacy"}},
		"modelDiscoveryAvailable": modelErr == nil,
		"conversationModelMode":   modelMode,
	})
}

func assistantConversationModel(model, imageModel string) bool {
	value := strings.ToLower(strings.TrimSpace(model))
	if value == "" || value == strings.ToLower(strings.TrimSpace(imageModel)) {
		return false
	}
	for _, token := range []string{"image", "dall-e", "sora", "video", "embedding", "whisper", "tts"} {
		if strings.Contains(value, token) {
			return false
		}
	}
	return true
}

func (s *Server) assistantChat(c *gin.Context) {
	client, err := s.requireAssistant(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body assistantChatIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := validateAssistantMessages(body.Messages); err != nil {
		fail(c, err)
		return
	}
	referenceImages, err := normalizeAssistantChatReferenceImages(body.Messages, body.ReferenceImages)
	if err != nil {
		fail(c, err)
		return
	}

	resp, err := client.ChatStreamWithImages(c.Request.Context(), body.Messages, referenceImages)
	if err != nil {
		fail(c, assistantUpstreamError(err))
		return
	}
	defer resp.Body.Close()

	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher, _ := c.Writer.(http.Flusher)
	reader := bufio.NewReader(resp.Body)
	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			if _, err := io.WriteString(c.Writer, line); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) && c.Request.Context().Err() == nil {
				log.Printf("Sub2API chat stream interrupted: %v", readErr)
			}
			return
		}
	}
}

func normalizeAssistantChatReferenceImages(messages []sub2api.Message, legacyImages []string) ([]string, error) {
	allImages := make([]string, 0, maxAssistantReferences)
	for index, message := range messages {
		if len(message.ReferenceImages) > 0 && message.Role != "user" {
			return nil, apperr.E(
				"validation_error",
				fmt.Sprintf("messages[%d].referenceImages: 仅用户消息可以携带图片", index),
				422,
			)
		}
		allImages = append(allImages, message.ReferenceImages...)
	}
	allImages = append(allImages, legacyImages...)
	normalized, err := validateAssistantReferenceImages(allImages)
	if err != nil {
		return nil, err
	}

	cursor := 0
	for index := range messages {
		count := len(messages[index].ReferenceImages)
		messages[index].ReferenceImages = append([]string(nil), normalized[cursor:cursor+count]...)
		cursor += count
	}
	return append([]string(nil), normalized[cursor:]...), nil
}

func (s *Server) assistantImages(c *gin.Context) {
	client, err := s.requireAssistant(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body assistantImageIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	body.Prompt = strings.TrimSpace(body.Prompt)
	if body.Prompt == "" || len([]rune(body.Prompt)) > 4000 {
		fail(c, apperr.E("validation_error", "prompt: 长度须在 1-4000 之间", 422))
		return
	}
	if body.Size == "" {
		body.Size = "1024x1024"
	}
	if body.Quality == "" {
		body.Quality = "high"
	}
	if body.Count == 0 {
		body.Count = 2
	}
	if err := validateAssistantImageSize(body.Size); err != nil {
		fail(c, err)
		return
	}
	if !containsString([]string{"low", "medium", "high"}, body.Quality) {
		fail(c, apperr.E("validation_error", "quality: 不支持的图片质量", 422))
		return
	}
	if body.Count < 1 || body.Count > 4 {
		fail(c, apperr.E("validation_error", "n: 须在 1-4 之间", 422))
		return
	}
	referenceImages, err := validateAssistantReferenceImages(body.ReferenceImages)
	if err != nil {
		fail(c, err)
		return
	}
	images, err := client.GenerateImage(c.Request.Context(), body.Prompt, body.Size, body.Quality, body.Count, referenceImages)
	if err != nil {
		fail(c, assistantUpstreamError(err))
		return
	}
	ok(c, gin.H{"images": images, "model": client.ImageModel()})
}

func validateAssistantReferenceImages(sources []string) ([]string, error) {
	if len(sources) > maxAssistantReferences {
		return nil, apperr.E("validation_error", "referenceImages: 最多允许 4 张参考图", 422)
	}
	normalized := make([]string, 0, len(sources))
	totalBytes := 0
	for index, source := range sources {
		source = strings.TrimSpace(source)
		if source == "" {
			return nil, apperr.E("validation_error", fmt.Sprintf("referenceImages[%d]: 图片内容为空", index), 422)
		}
		if strings.HasPrefix(strings.ToLower(source), "data:image/") {
			parts := strings.SplitN(source, ",", 2)
			if len(parts) != 2 || !strings.HasSuffix(strings.ToLower(parts[0]), ";base64") {
				return nil, apperr.E("validation_error", fmt.Sprintf("referenceImages[%d]: 图片数据格式无效", index), 422)
			}
			decoded, decodeErr := base64.StdEncoding.DecodeString(parts[1])
			if decodeErr != nil || len(decoded) == 0 {
				return nil, apperr.E("validation_error", fmt.Sprintf("referenceImages[%d]: 图片数据损坏", index), 422)
			}
			if len(decoded) > maxAssistantImageBytes {
				return nil, apperr.E("validation_error", fmt.Sprintf("referenceImages[%d]: 单张图片不能超过 8 MiB", index), 422)
			}
			totalBytes += len(decoded)
		} else {
			parsed, parseErr := url.Parse(source)
			if parseErr != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
				return nil, apperr.E("validation_error", fmt.Sprintf("referenceImages[%d]: 图片地址无效", index), 422)
			}
		}
		if totalBytes > maxAssistantImagesBytes {
			return nil, apperr.E("validation_error", "referenceImages: 图片总大小不能超过 12 MiB", 422)
		}
		normalized = append(normalized, source)
	}
	return normalized, nil
}

func validateAssistantImageSize(size string) error {
	if size == "auto" {
		return nil
	}
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return apperr.E("validation_error", "size: 格式须为 宽x高", 422)
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width < 256 || width > 4096 || height < 256 || height > 4096 {
		return apperr.E("validation_error", "size: 宽高须在 256-4096 之间", 422)
	}
	return nil
}

func validateAssistantMessages(messages []sub2api.Message) error {
	if len(messages) == 0 || len(messages) > maxAssistantMessages {
		return apperr.E("validation_error", fmt.Sprintf("messages: 须包含 1-%d 条消息", maxAssistantMessages), 422)
	}
	total := 0
	for i, message := range messages {
		if message.Role != "user" && message.Role != "assistant" && message.Role != "system" {
			return apperr.E("validation_error", fmt.Sprintf("messages[%d].role: 无效角色", i), 422)
		}
		length := len([]rune(strings.TrimSpace(message.Content)))
		if length == 0 || length > maxAssistantMessageRunes {
			return apperr.E("validation_error", fmt.Sprintf("messages[%d].content: 长度须在 1-%d 之间", i, maxAssistantMessageRunes), 422)
		}
		total += length
	}
	if total > maxAssistantTotalRunes {
		return apperr.E("validation_error", "messages: 上下文总长度过长", 422)
	}
	return nil
}

func assistantUpstreamError(err error) error {
	var upstream *sub2api.UpstreamError
	if errors.As(err, &upstream) {
		message := strings.TrimSpace(upstream.Message)
		if message == "" {
			message = "AI 服务返回错误"
		}
		return apperr.E("assistant_upstream_error", message, http.StatusBadGateway)
	}
	log.Printf("Sub2API request failed: %v", err)
	return apperr.E("assistant_unavailable", "AI 服务暂时不可用，请稍后重试", http.StatusBadGateway)
}

func containsString(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
