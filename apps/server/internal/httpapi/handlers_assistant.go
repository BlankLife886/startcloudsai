package httpapi

import (
	"bufio"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
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
	resolved, err := settings.ResolveSub2API(ctx.Request.Context(), s.St.Pool, settings.Sub2APIConfig{
		BaseURL: s.Cfg.Sub2APIBaseURL, APIKey: s.Cfg.Sub2APIAPIKey,
		ChatModel: s.Cfg.Sub2APIChatModel, ImageModel: s.Cfg.Sub2APIImageModel,
		TimeoutSecs: s.Cfg.Sub2APITimeoutSecs,
	}, s.Cfg.AppSecret)
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

func (s *Server) requireAssistant(c *gin.Context) (*sub2api.Client, error) {
	if _, err := s.requireUser(c); err != nil {
		return nil, err
	}
	return s.assistantClient(c)
}

func (s *Server) assistantConfig(c *gin.Context) {
	client, err := s.requireAssistant(c)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{
		"chatModel": client.ChatModel(), "imageModel": client.ImageModel(),
	})
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
