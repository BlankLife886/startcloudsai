// Package sub2api provides the server-side bridge to a Sub2API OpenAI-compatible gateway.
package sub2api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxImageResponseBytes = 32 << 20

type Client struct {
	baseURL    string
	apiKey     string
	chatModel  string
	imageModel string
	httpClient *http.Client
}

type Message struct {
	Role            string   `json:"role"`
	Content         string   `json:"content"`
	ReferenceImages []string `json:"referenceImages,omitempty"`
}

type Image struct {
	DataURL       string `json:"dataUrl"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
}

type UpstreamError struct {
	Status  int
	Message string
}

func (e *UpstreamError) Error() string { return e.Message }

func New(baseURL, apiKey, chatModel, imageModel string, timeoutSecs int) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, errors.New("Sub2API base URL is empty")
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("Sub2API base URL must be an http(s) origin")
	}
	if strings.HasSuffix(u.Path, "/v1") {
		u.Path = strings.TrimSuffix(u.Path, "/v1")
		baseURL = strings.TrimRight(u.String(), "/")
	}
	if timeoutSecs < 30 {
		timeoutSecs = 300
	}
	return &Client{
		baseURL:    baseURL,
		apiKey:     strings.TrimSpace(apiKey),
		chatModel:  fallback(strings.TrimSpace(chatModel), "gpt-5.4"),
		imageModel: fallback(strings.TrimSpace(imageModel), "gpt-image-2"),
		httpClient: &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
	}, nil
}

func fallback(value, def string) string {
	if value == "" {
		return def
	}
	return value
}

func (c *Client) Configured() bool   { return c != nil && c.apiKey != "" }
func (c *Client) ChatModel() string  { return c.chatModel }
func (c *Client) ImageModel() string { return c.imageModel }

// ListModels validates gateway connectivity and returns the visible model IDs.
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "StarCloudsAI/1.0")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeUpstreamError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode Sub2API models response: %w", err)
	}
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if item.ID != "" {
			models = append(models, item.ID)
		}
	}
	return models, nil
}

func (c *Client) newJSONRequest(ctx context.Context, path string, body any) (*http.Request, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream, application/json")
	req.Header.Set("User-Agent", "StarCloudsAI/1.0")
	return req, nil
}

func (c *Client) ChatStream(ctx context.Context, messages []Message) (*http.Response, error) {
	return c.ChatStreamWithImages(ctx, messages, nil)
}

// ChatStreamWithImages 将每轮参考图转换成 OpenAI chat-completions
// 多模态 content parts。imageURLs 保留为旧客户端的兼容入口。
func (c *Client) ChatStreamWithImages(ctx context.Context, messages []Message, imageURLs []string) (*http.Response, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	payloadMessages := make([]any, len(messages))
	lastUserIndex := -1
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == "user" {
			lastUserIndex = index
			break
		}
	}
	for index, message := range messages {
		content := any(message.Content)
		messageImages := append([]string(nil), message.ReferenceImages...)
		if index == lastUserIndex {
			for _, imageURL := range imageURLs {
				if !contains(messageImages, imageURL) {
					messageImages = append(messageImages, imageURL)
				}
			}
		}
		if message.Role == "user" && len(messageImages) > 0 {
			parts := make([]any, 0, len(messageImages)+1)
			parts = append(parts, map[string]any{"type": "text", "text": message.Content})
			for _, imageURL := range messageImages {
				parts = append(parts, map[string]any{
					"type":      "image_url",
					"image_url": map[string]string{"url": imageURL},
				})
			}
			content = parts
		}
		payloadMessages[index] = map[string]any{"role": message.Role, "content": content}
	}
	req, err := c.newJSONRequest(ctx, "/v1/chat/completions", map[string]any{
		"model": c.chatModel, "messages": payloadMessages, "stream": true,
	})
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, decodeUpstreamError(resp)
	}
	return resp, nil
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func (c *Client) GenerateImage(ctx context.Context, prompt, size, quality string, count int, referenceImages []string) ([]Image, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	if count < 1 || count > 4 {
		return nil, errors.New("image count must be between 1 and 4")
	}
	if count == 1 {
		return c.generateSingleImage(ctx, prompt, size, quality, referenceImages)
	}

	batchCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	images := make([]Image, count)
	var wg sync.WaitGroup
	var firstErr error
	var errOnce sync.Once
	for index := 0; index < count; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			generated, err := c.generateSingleImage(batchCtx, prompt, size, quality, referenceImages)
			if err != nil {
				errOnce.Do(func() {
					firstErr = fmt.Errorf("generate image %d/%d: %w", index+1, count, err)
					cancel()
				})
				return
			}
			images[index] = generated[0]
		}(index)
	}
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	return images, nil
}

func (c *Client) generateSingleImage(ctx context.Context, prompt, size, quality string, referenceImages []string) ([]Image, error) {
	prompt = buildImagePrompt(prompt, size, quality)
	path := "/v1/images/generations"
	payload := map[string]any{
		"model": c.imageModel, "prompt": prompt, "size": size, "quality": quality,
		"stream": false, "response_format": "b64_json",
	}
	if len(referenceImages) > 0 {
		path = "/v1/images/edits"
		images := make([]map[string]string, 0, len(referenceImages))
		for _, imageURL := range referenceImages {
			images = append(images, map[string]string{"image_url": imageURL})
		}
		payload["images"] = images
	}
	req, err := c.newJSONRequest(ctx, path, payload)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeUpstreamError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxImageResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxImageResponseBytes {
		return nil, errors.New("Sub2API image response exceeds 32 MiB")
	}
	var responsePayload struct {
		Data []struct {
			B64JSON       string `json:"b64_json"`
			URL           string `json:"url"`
			RevisedPrompt string `json:"revised_prompt"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &responsePayload); err != nil {
		return nil, fmt.Errorf("decode Sub2API image response: %w", err)
	}
	images := make([]Image, 0, len(responsePayload.Data))
	for _, item := range responsePayload.Data {
		dataURL := strings.TrimSpace(item.URL)
		if item.B64JSON != "" {
			dataURL = "data:image/png;base64," + item.B64JSON
		}
		if dataURL != "" {
			images = append(images, Image{DataURL: dataURL, RevisedPrompt: item.RevisedPrompt})
		}
	}
	if len(images) == 0 {
		return nil, errors.New("Sub2API returned no images")
	}
	return images, nil
}

func buildImagePrompt(prompt, size, quality string) string {
	hints := make([]string, 0, 3)
	if size = strings.TrimSpace(size); size != "" && size != "auto" {
		hints = append(hints, fmt.Sprintf("输出图片尺寸为 %s。", size))
		if resolution := imageResolutionTier(size); resolution != "" {
			hints = append(hints, fmt.Sprintf("输出图片分辨率为 %s。", resolution))
		}
	}
	if quality = strings.TrimSpace(quality); quality != "" && quality != "auto" {
		hints = append(hints, fmt.Sprintf("输出图片质量为 %s。", quality))
	}
	if len(hints) == 0 {
		return strings.TrimSpace(prompt)
	}
	return strings.TrimSpace(prompt) + "\n\n" + strings.Join(hints, "")
}

func imageResolutionTier(size string) string {
	parts := strings.Split(strings.TrimSpace(size), "x")
	if len(parts) != 2 {
		return ""
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width < 1 || height < 1 {
		return ""
	}
	longEdge := max(width, height)
	switch {
	case longEdge <= 1024:
		return "1K"
	case longEdge <= 2048:
		return "2K"
	case longEdge <= 4096:
		return "4K"
	default:
		return ""
	}
}

func decodeUpstreamError(resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	message := strings.TrimSpace(string(raw))
	var payload struct {
		Message string `json:"message"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &payload) == nil {
		if payload.Error.Message != "" {
			message = payload.Error.Message
		} else if payload.Message != "" {
			message = payload.Message
		}
	}
	if message == "" {
		message = http.StatusText(resp.StatusCode)
	}
	if len([]rune(message)) > 500 {
		message = string([]rune(message)[:500])
	}
	return &UpstreamError{Status: resp.StatusCode, Message: message}
}
