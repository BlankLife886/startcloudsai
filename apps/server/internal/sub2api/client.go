// Package sub2api provides the server-side bridge to a Sub2API OpenAI-compatible gateway.
package sub2api

import (
	"bufio"
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
	"time"
)

const (
	maxImageResponseBytes = 32 << 20
	chatStreamAttempts    = 2
	chatStreamRetryDelay  = 200 * time.Millisecond
)

type Client struct {
	baseURL      string
	apiKey       string
	apiKeyHeader string
	chatModel    string
	imageModel   string
	httpClient   *http.Client
}

type Message struct {
	Role            string   `json:"role"`
	Content         string   `json:"content"`
	ReferenceImages []string `json:"referenceImages,omitempty"`
}

type FunctionTool struct {
	Name        string
	Description string
	Parameters  map[string]any
}

type ToolCall struct {
	Name      string
	Arguments string
}

type AgentChatResult struct {
	Text      string
	Reasoning string
	ToolCall  *ToolCall
}

type Image struct {
	DataURL       string `json:"dataUrl"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
}

type ImageOptions struct {
	InputFidelity string
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

// WithChatModel returns a request-scoped client that shares the HTTP transport
// while using a user-selected, server-approved conversation model.
func (c *Client) WithChatModel(model string) *Client {
	if c == nil || strings.TrimSpace(model) == "" {
		return c
	}
	clone := *c
	clone.chatModel = strings.TrimSpace(model)
	return &clone
}

// WithImageModel returns a request-scoped client while preserving the shared transport.
func (c *Client) WithImageModel(model string) *Client {
	if c == nil || strings.TrimSpace(model) == "" {
		return c
	}
	clone := *c
	clone.imageModel = strings.TrimSpace(model)
	return &clone
}

// WithAPIKeyHeader adds provider-specific key authentication while retaining
// Bearer auth for OpenAI-compatible endpoints.
func (c *Client) WithAPIKeyHeader(header string) *Client {
	if c == nil || strings.TrimSpace(header) == "" {
		return c
	}
	clone := *c
	clone.apiKeyHeader = strings.TrimSpace(header)
	return &clone
}

func (c *Client) applyAuth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if c.apiKeyHeader != "" {
		req.Header.Set(c.apiKeyHeader, c.apiKey)
	}
}

// ListModels validates gateway connectivity and returns the visible model IDs.
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	c.applyAuth(req)
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
	c.applyAuth(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream, application/json")
	req.Header.Set("User-Agent", "StarCloudsAI/1.0")
	return req, nil
}

func (c *Client) ChatStream(ctx context.Context, messages []Message) (*http.Response, error) {
	return c.ChatStreamWithImages(ctx, messages, nil)
}

// ChatTextWithImages consumes the streaming API server-side. The callback is
// used by durable assistant jobs to checkpoint partial output in PostgreSQL.
func (c *Client) ChatTextWithImages(ctx context.Context, messages []Message, imageURLs []string, onText func(string) error) (string, error) {
	var lastErr error
	for attempt := 0; attempt < chatStreamAttempts; attempt++ {
		text, receivedOutput, err := c.chatTextWithImages(ctx, messages, imageURLs, onText)
		if err == nil {
			return text, nil
		}
		lastErr = err
		if receivedOutput || !transientChatError(ctx, err) || attempt == chatStreamAttempts-1 {
			return text, err
		}
		timer := time.NewTimer(chatStreamRetryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return text, ctx.Err()
		case <-timer.C:
		}
	}
	return "", lastErr
}

func (c *Client) chatTextWithImages(ctx context.Context, messages []Message, imageURLs []string, onText func(string) error) (string, bool, error) {
	resp, err := c.ChatStreamWithImages(ctx, messages, imageURLs)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 2<<20)
	fullText := ""
	receivedOutput := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if raw == "" || raw == "[DONE]" {
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			continue
		}
		if message := streamError(payload); message != "" {
			return fullText, receivedOutput, errors.New(message)
		}
		changed := false
		for _, fragment := range streamTextFragments(payload) {
			receivedOutput = true
			before := fullText
			if fragment.replace {
				fullText = fragment.value
			} else {
				fullText += fragment.value
			}
			changed = changed || fullText != before
		}
		if changed && onText != nil {
			if err := onText(fullText); err != nil {
				return fullText, receivedOutput, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fullText, receivedOutput, err
	}
	return fullText, receivedOutput, nil
}

// ChatAgentWithImages performs one streamed chat-completions request that can
// either answer normally or return a structured function call. Text and
// reasoning snapshots are delivered while the tool arguments are still being
// assembled, so callers do not need a separate intent-classification request.
func (c *Client) ChatAgentWithImages(
	ctx context.Context,
	messages []Message,
	imageURLs []string,
	tool FunctionTool,
	forceTool bool,
	onUpdate func(text, reasoning string) error,
) (AgentChatResult, error) {
	payload := map[string]any{
		"model":    c.chatModel,
		"messages": chatPayloadMessages(messages, imageURLs),
		"stream":   true,
		"tools": []any{map[string]any{
			"type": "function",
			"function": map[string]any{
				"name": tool.Name, "description": tool.Description, "parameters": tool.Parameters,
			},
		}},
		"tool_choice": "auto",
	}
	if forceTool {
		payload["tool_choice"] = map[string]any{
			"type": "function", "function": map[string]any{"name": tool.Name},
		}
	}
	var lastErr error
	for attempt := 0; attempt < chatStreamAttempts; attempt++ {
		result, receivedOutput, err := c.chatAgentWithPayload(ctx, payload, onUpdate)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if receivedOutput || !transientChatError(ctx, err) || attempt == chatStreamAttempts-1 {
			return result, err
		}
		timer := time.NewTimer(chatStreamRetryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return result, ctx.Err()
		case <-timer.C:
		}
	}
	return AgentChatResult{}, lastErr
}

func (c *Client) chatAgentWithPayload(
	ctx context.Context,
	payload map[string]any,
	onUpdate func(text, reasoning string) error,
) (AgentChatResult, bool, error) {
	resp, err := c.chatStreamWithPayload(ctx, payload)
	if err != nil {
		return AgentChatResult{}, false, err
	}
	defer resp.Body.Close()

	result := AgentChatResult{}
	receivedOutput := false
	toolNames := map[int]string{}
	toolArguments := map[int]string{}
	minToolIndex := -1
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 2<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if raw == "" || raw == "[DONE]" {
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			continue
		}
		if message := streamError(event); message != "" {
			return result, receivedOutput, errors.New(message)
		}
		changed := false
		for _, fragment := range streamTextFragments(event) {
			before := result.Text
			if fragment.replace {
				result.Text = fragment.value
			} else {
				result.Text += fragment.value
			}
			changed = changed || result.Text != before
			receivedOutput = true
		}
		for _, fragment := range streamReasoningFragments(event) {
			before := result.Reasoning
			if fragment.replace {
				result.Reasoning = fragment.value
			} else {
				result.Reasoning += fragment.value
			}
			changed = changed || result.Reasoning != before
			receivedOutput = true
		}
		for _, fragment := range streamToolCallFragments(event) {
			receivedOutput = true
			if minToolIndex < 0 || fragment.index < minToolIndex {
				minToolIndex = fragment.index
			}
			if fragment.name != "" {
				toolNames[fragment.index] = fragment.name
			}
			if fragment.replace {
				toolArguments[fragment.index] = fragment.arguments
			} else {
				toolArguments[fragment.index] += fragment.arguments
			}
		}
		if changed && onUpdate != nil {
			if err := onUpdate(result.Text, result.Reasoning); err != nil {
				return result, receivedOutput, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return result, receivedOutput, err
	}
	if minToolIndex >= 0 {
		result.ToolCall = &ToolCall{Name: toolNames[minToolIndex], Arguments: toolArguments[minToolIndex]}
	}
	return result, receivedOutput, nil
}

type streamStringFragment struct {
	value   string
	replace bool
}

func streamTextFragments(payload map[string]any) []streamStringFragment {
	fragments := make([]streamStringFragment, 0, 2)
	for _, field := range []string{"delta", "output_text"} {
		if value, ok := payload[field].(string); ok && value != "" {
			return append(fragments, streamStringFragment{value: value})
		}
	}
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return fragments
	}
	choice, _ := choices[0].(map[string]any)
	if delta, ok := choice["delta"].(map[string]any); ok {
		if value, ok := delta["content"].(string); ok && value != "" {
			fragments = append(fragments, streamStringFragment{value: value})
		}
	}
	if message, ok := choice["message"].(map[string]any); ok {
		if value, ok := message["content"].(string); ok {
			fragments = append(fragments, streamStringFragment{value: value, replace: true})
		}
	}
	return fragments
}

func streamReasoningFragments(payload map[string]any) []streamStringFragment {
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return nil
	}
	choice, _ := choices[0].(map[string]any)
	fragments := make([]streamStringFragment, 0, 2)
	for _, containerName := range []string{"delta", "message"} {
		container, _ := choice[containerName].(map[string]any)
		for _, field := range []string{"reasoning_content", "reasoning", "reasoning_text"} {
			if value, ok := container[field].(string); ok && value != "" {
				fragments = append(fragments, streamStringFragment{
					value: value, replace: containerName == "message",
				})
				break
			}
		}
	}
	return fragments
}

func transientChatError(ctx context.Context, err error) bool {
	if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		return upstream.Status == http.StatusTooManyRequests || upstream.Status >= http.StatusInternalServerError
	}
	var netErr interface {
		Timeout() bool
		Temporary() bool
	}
	if errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary()) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "timeout") ||
		strings.Contains(message, "temporarily unavailable") ||
		strings.Contains(message, "service unavailable") ||
		strings.Contains(message, "overloaded") ||
		strings.Contains(message, "rate limit") ||
		strings.Contains(message, "connection reset") ||
		strings.Contains(message, "unexpected eof")
}

type toolCallFragment struct {
	index     int
	name      string
	arguments string
	replace   bool
}

func streamToolCallFragments(payload map[string]any) []toolCallFragment {
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return nil
	}
	choice, _ := choices[0].(map[string]any)
	fragments := make([]toolCallFragment, 0, 1)
	for _, containerName := range []string{"delta", "message"} {
		container, _ := choice[containerName].(map[string]any)
		if legacy, ok := container["function_call"].(map[string]any); ok {
			name, _ := legacy["name"].(string)
			arguments, _ := legacy["arguments"].(string)
			if name != "" || arguments != "" {
				fragments = append(fragments, toolCallFragment{
					index: 0, name: name, arguments: arguments, replace: containerName == "message",
				})
			}
		}
		calls, _ := container["tool_calls"].([]any)
		for _, rawCall := range calls {
			call, _ := rawCall.(map[string]any)
			function, _ := call["function"].(map[string]any)
			index := 0
			switch value := call["index"].(type) {
			case float64:
				index = int(value)
			case int:
				index = value
			}
			name, _ := function["name"].(string)
			arguments, _ := function["arguments"].(string)
			if name == "" && arguments == "" {
				continue
			}
			fragments = append(fragments, toolCallFragment{
				index: index, name: name, arguments: arguments, replace: containerName == "message",
			})
		}
	}
	return fragments
}

func streamError(payload map[string]any) string {
	if payload["type"] == "error" {
		if item, ok := payload["error"].(map[string]any); ok {
			if message, ok := item["message"].(string); ok {
				return message
			}
		}
	}
	if item, ok := payload["error"].(map[string]any); ok {
		if message, ok := item["message"].(string); ok {
			return message
		}
	}
	if message, ok := payload["error"].(string); ok {
		return message
	}
	return ""
}

// ChatStreamWithImages 将每轮参考图转换成 OpenAI chat-completions
// 多模态 content parts。imageURLs 保留为旧客户端的兼容入口。
func (c *Client) ChatStreamWithImages(ctx context.Context, messages []Message, imageURLs []string) (*http.Response, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	return c.chatStreamWithPayload(ctx, map[string]any{
		"model": c.chatModel, "messages": chatPayloadMessages(messages, imageURLs), "stream": true,
	})
}

func chatPayloadMessages(messages []Message, imageURLs []string) []any {
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
	return payloadMessages
}

func (c *Client) chatStreamWithPayload(ctx context.Context, payload map[string]any) (*http.Response, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	req, err := c.newJSONRequest(ctx, "/v1/chat/completions", payload)
	if err != nil {
		return nil, err
	}
	// http.Client.Timeout covers the entire response body and therefore aborts healthy SSE
	// streams once the configured duration elapses. The request context already carries the
	// worker/task deadline and cancellation, so keep the stream alive while data is arriving.
	streamClient := *c.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(req)
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
	return c.GenerateImageProgressiveWithOptions(ctx, prompt, size, quality, count, referenceImages, ImageOptions{}, nil)
}

// GenerateImageProgressive fans out multi-image requests and calls onImage as
// soon as each indexed result is available. The returned slice remains ordered
// by requested index for callers that only need the final aggregate.
func (c *Client) GenerateImageProgressive(ctx context.Context, prompt, size, quality string, count int, referenceImages []string, onImage func(index int, image Image) error) ([]Image, error) {
	return c.GenerateImageProgressiveWithOptions(ctx, prompt, size, quality, count, referenceImages, ImageOptions{}, onImage)
}

func (c *Client) GenerateImageProgressiveWithOptions(ctx context.Context, prompt, size, quality string, count int, referenceImages []string, options ImageOptions, onImage func(index int, image Image) error) ([]Image, error) {
	if !c.Configured() {
		return nil, errors.New("Sub2API API key is not configured")
	}
	if count < 1 || count > 4 {
		return nil, errors.New("image count must be between 1 and 4")
	}
	if count == 1 {
		generated, err := c.generateSingleImageWithRetry(ctx, prompt, size, quality, referenceImages, options)
		if err != nil {
			return nil, err
		}
		if onImage != nil {
			if err := onImage(0, generated[0]); err != nil {
				return nil, err
			}
		}
		return generated, nil
	}

	type result struct {
		index int
		image Image
		err   error
	}
	images := make([]Image, count)
	errorsByIndex := make([]error, count)
	results := make(chan result, count)
	for index := 0; index < count; index++ {
		go func(index int) {
			generated, err := c.generateSingleImageWithRetry(ctx, prompt, size, quality, referenceImages, options)
			if err != nil {
				results <- result{index: index, err: err}
				return
			}
			results <- result{index: index, image: generated[0]}
		}(index)
	}
	for completed := 0; completed < count; completed++ {
		result := <-results
		if result.err != nil {
			errorsByIndex[result.index] = result.err
			continue
		}
		if onImage != nil {
			if err := onImage(result.index, result.image); err != nil {
				errorsByIndex[result.index] = err
				continue
			}
		}
		images[result.index] = result.image
	}
	completed := images[:0]
	var firstErr error
	for index, image := range images {
		if image.DataURL != "" {
			completed = append(completed, image)
			continue
		}
		if firstErr == nil && errorsByIndex[index] != nil {
			firstErr = fmt.Errorf("generate image %d/%d: %w", index+1, count, errorsByIndex[index])
		}
	}
	// A transient failure in one branch must not discard images that the
	// upstream already generated successfully. The caller records the actual
	// completed count in the assistant message.
	if len(completed) > 0 {
		return completed, nil
	}
	return nil, firstErr
}

func (c *Client) generateSingleImageWithRetry(ctx context.Context, prompt, size, quality string, referenceImages []string, options ImageOptions) ([]Image, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		images, err := c.generateSingleImage(ctx, prompt, size, quality, referenceImages, options)
		if err == nil {
			return images, nil
		}
		lastErr = err
		if !transientImageError(err) || attempt == 1 {
			break
		}
		timer := time.NewTimer(800 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

func transientImageError(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		return upstream.Status == 429 || upstream.Status == 502 || upstream.Status == 503 ||
			upstream.Status == 504 || upstream.Status == 524
	}
	var netErr interface{ Temporary() bool }
	return errors.As(err, &netErr) && netErr.Temporary()
}

func (c *Client) generateSingleImage(ctx context.Context, prompt, size, quality string, referenceImages []string, options ImageOptions) ([]Image, error) {
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
		switch fidelity := strings.ToLower(strings.TrimSpace(options.InputFidelity)); fidelity {
		case "low", "high":
			payload["input_fidelity"] = fidelity
		}
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
		Detail  string `json:"detail"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &payload) == nil {
		if payload.Error.Message != "" {
			message = payload.Error.Message
		} else if payload.Message != "" {
			message = payload.Message
		} else if payload.Detail != "" {
			message = payload.Detail
		}
	}
	if resp.StatusCode == 524 {
		message = "上游图片生成超过 120 秒网关等待时间，系统已自动重试；请稍后再试或降低一次生成张数"
	}
	if message == "" {
		message = http.StatusText(resp.StatusCode)
	}
	if len([]rune(message)) > 500 {
		message = string([]rune(message)[:500])
	}
	return &UpstreamError{Status: resp.StatusCode, Message: message}
}
