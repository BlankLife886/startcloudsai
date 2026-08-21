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
	"sync/atomic"
	"time"
)

const (
	maxImageResponseBytes = 32 << 20
	chatStreamAttempts    = 2
	chatStreamRetryDelay  = 200 * time.Millisecond
)

type Client struct {
	baseURL           string
	apiKey            string
	apiKeyHeader      string
	chatModel         string
	reasoningEffort   string
	imageModel        string
	httpClient        *http.Client
	streamIdleTimeout time.Duration
	maxOutputTokens   int
}

type Message struct {
	Role            string     `json:"role"`
	Content         string     `json:"content"`
	ReferenceImages []string   `json:"referenceImages,omitempty"`
	Name            string     `json:"name,omitempty"`
	ToolCallID      string     `json:"toolCallId,omitempty"`
	ToolCalls       []ToolCall `json:"toolCalls,omitempty"`
}

type FunctionTool struct {
	Name        string
	Description string
	Parameters  map[string]any
	Strict      bool
}

const RequiredToolChoice = "required"

type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

type ChatUsage struct {
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	ReasoningTokens  int64
	FirstTokenMs     int64
	DurationMs       int64
}

func (u ChatUsage) Add(other ChatUsage) ChatUsage {
	out := ChatUsage{
		PromptTokens:     u.PromptTokens + other.PromptTokens,
		CompletionTokens: u.CompletionTokens + other.CompletionTokens,
		TotalTokens:      u.TotalTokens + other.TotalTokens,
		ReasoningTokens:  u.ReasoningTokens + other.ReasoningTokens,
		DurationMs:       u.DurationMs + other.DurationMs,
	}
	if u.FirstTokenMs > 0 {
		out.FirstTokenMs = u.FirstTokenMs
	} else {
		out.FirstTokenMs = other.FirstTokenMs
	}
	return out
}

func (u ChatUsage) Map() map[string]any {
	out := make(map[string]any, 6)
	if u.PromptTokens > 0 {
		out["inputTokens"] = u.PromptTokens
	}
	if u.CompletionTokens > 0 {
		out["outputTokens"] = u.CompletionTokens
	}
	if u.TotalTokens > 0 {
		out["totalTokens"] = u.TotalTokens
	}
	if u.ReasoningTokens > 0 {
		out["reasoningTokens"] = u.ReasoningTokens
	}
	if u.FirstTokenMs > 0 {
		out["firstTokenMs"] = u.FirstTokenMs
	}
	if u.DurationMs > 0 {
		out["durationMs"] = u.DurationMs
	}
	return out
}

type ChatCompletion struct {
	Text      string
	Reasoning string
	Usage     ChatUsage
}

type AgentChatResult struct {
	Text            string
	Reasoning       string
	ReasoningTokens int64
	ToolCall        *ToolCall
	Usage           ChatUsage
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

var (
	errChatStreamIncomplete = errors.New("chat stream ended before a completion marker")
	errChatStreamTruncated  = errors.New("chat stream reached the model output limit")
	errChatStreamFiltered   = errors.New("chat stream was blocked by content filtering")
	errChatStreamEmpty      = errors.New("chat stream completed without output")
	errChatStreamIdle       = errors.New("chat stream timed out while waiting for data")
)

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
	timeout := time.Duration(timeoutSecs) * time.Second
	idleTimeout := min(timeout, 90*time.Second)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = min(timeout, 30*time.Second)
	return &Client{
		baseURL:           baseURL,
		apiKey:            strings.TrimSpace(apiKey),
		chatModel:         fallback(strings.TrimSpace(chatModel), "gpt-5.4"),
		imageModel:        fallback(strings.TrimSpace(imageModel), "gpt-image-2"),
		httpClient:        &http.Client{Timeout: timeout, Transport: transport},
		streamIdleTimeout: idleTimeout,
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

// WithReasoningEffort returns a request-scoped client that forwards the
// OpenAI-compatible reasoning_effort parameter on chat requests.
func (c *Client) WithReasoningEffort(effort string) *Client {
	if c == nil {
		return c
	}
	clone := *c
	clone.reasoningEffort = strings.ToLower(strings.TrimSpace(effort))
	return &clone
}

func (c *Client) WithMaxOutputTokens(tokens int) *Client {
	if c == nil || tokens <= 0 {
		return c
	}
	clone := *c
	clone.maxOutputTokens = tokens
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
	var onUpdate func(string, string) error
	if onText != nil {
		onUpdate = func(text, _ string) error { return onText(text) }
	}
	result, err := c.CompleteChatTextWithImages(ctx, messages, imageURLs, onUpdate)
	return result.Text, err
}

func (c *Client) CompleteChatTextWithImages(ctx context.Context, messages []Message, imageURLs []string, onUpdate func(text, reasoning string) error) (ChatCompletion, error) {
	var lastErr error
	for attempt := 0; attempt < chatStreamAttempts; attempt++ {
		result, receivedOutput, err := c.chatTextWithImages(ctx, messages, imageURLs, onUpdate)
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
	return ChatCompletion{}, lastErr
}

func (c *Client) chatTextWithImages(ctx context.Context, messages []Message, imageURLs []string, onUpdate func(text, reasoning string) error) (ChatCompletion, bool, error) {
	streamCtx, cancelStream, idleTimer, idleTimedOut := c.chatStreamContext(ctx)
	defer cancelStream()
	defer idleTimer.Stop()
	started := time.Now()
	resp, err := c.ChatStreamWithImages(streamCtx, messages, imageURLs)
	if err != nil {
		return ChatCompletion{}, false, err
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 2<<20)
	result := ChatCompletion{}
	receivedOutput := false
	var firstToken time.Time
	completed := false
	for scanner.Scan() {
		idleTimer.Reset(c.effectiveStreamIdleTimeout())
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if raw == "" {
			continue
		}
		if raw == "[DONE]" {
			completed = true
			continue
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			return result, receivedOutput, fmt.Errorf("decode chat stream event: %w", err)
		}
		if message := streamError(payload); message != "" {
			return result, receivedOutput, errors.New(message)
		}
		if reason := streamFinishReason(payload); reason != "" {
			if err := validateChatFinishReason(reason); err != nil {
				return result, receivedOutput, err
			}
			completed = true
		}
		if usage := streamUsage(payload); usage.PromptTokens > 0 || usage.CompletionTokens > 0 || usage.TotalTokens > 0 || usage.ReasoningTokens > 0 {
			result.Usage.PromptTokens = usage.PromptTokens
			result.Usage.CompletionTokens = usage.CompletionTokens
			result.Usage.TotalTokens = usage.TotalTokens
			result.Usage.ReasoningTokens = usage.ReasoningTokens
		}
		changed := false
		for _, fragment := range streamTextFragments(payload) {
			receivedOutput = true
			if firstToken.IsZero() {
				firstToken = time.Now()
			}
			before := result.Text
			if fragment.replace {
				result.Text = fragment.value
			} else {
				result.Text += fragment.value
			}
			changed = changed || result.Text != before
		}
		for _, fragment := range streamReasoningFragments(payload) {
			receivedOutput = true
			if firstToken.IsZero() {
				firstToken = time.Now()
			}
			before := result.Reasoning
			result.Reasoning = applyReasoningFragment(result.Reasoning, fragment)
			changed = changed || result.Reasoning != before
		}
		if changed && onUpdate != nil {
			if err := onUpdate(result.Text, result.Reasoning); err != nil {
				return result, receivedOutput, err
			}
		}
	}
	finishChatUsage(&result.Usage, started, firstToken)
	if err := scanner.Err(); err != nil {
		if idleTimedOut.Load() && ctx.Err() == nil {
			return result, receivedOutput, errChatStreamIdle
		}
		return result, receivedOutput, err
	}
	if !completed {
		return result, receivedOutput, errChatStreamIncomplete
	}
	if strings.TrimSpace(result.Text) == "" {
		return result, receivedOutput, errChatStreamEmpty
	}
	return result, receivedOutput, nil
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
	forced := ""
	if forceTool {
		forced = tool.Name
	}
	return c.ChatAgentWithTools(ctx, messages, imageURLs, []FunctionTool{tool}, forced, onUpdate)
}

// ChatAgentWithTools exposes several function tools in one streamed request so
// callers can drive a multi-step tool loop. toolChoice may be empty for auto,
// RequiredToolChoice to require any declared tool, or a tool name to force it.
func (c *Client) ChatAgentWithTools(
	ctx context.Context,
	messages []Message,
	imageURLs []string,
	tools []FunctionTool,
	toolChoice string,
	onUpdate func(text, reasoning string) error,
) (AgentChatResult, error) {
	if len(tools) == 0 {
		return AgentChatResult{}, errors.New("no tools provided")
	}
	declarations := make([]any, 0, len(tools))
	for _, tool := range tools {
		function := map[string]any{
			"name": tool.Name, "description": tool.Description, "parameters": tool.Parameters,
		}
		if tool.Strict {
			function["strict"] = true
		}
		declarations = append(declarations, map[string]any{
			"type": "function", "function": function,
		})
	}
	payload := map[string]any{
		"model":               c.chatModel,
		"messages":            chatPayloadMessages(messages, imageURLs),
		"stream":              true,
		"stream_options":      map[string]any{"include_usage": true},
		"tools":               declarations,
		"tool_choice":         "auto",
		"parallel_tool_calls": false,
	}
	c.applyChatOutputLimit(payload)
	c.applyReasoningRequest(payload)
	choice := strings.TrimSpace(toolChoice)
	if choice == RequiredToolChoice {
		payload["tool_choice"] = RequiredToolChoice
	} else if choice != "" {
		payload["tool_choice"] = map[string]any{
			"type": "function", "function": map[string]any{"name": choice},
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
	streamCtx, cancelStream, idleTimer, idleTimedOut := c.chatStreamContext(ctx)
	defer cancelStream()
	defer idleTimer.Stop()
	started := time.Now()
	resp, err := c.chatStreamWithPayload(streamCtx, payload)
	if err != nil {
		return AgentChatResult{}, false, err
	}
	defer resp.Body.Close()

	result := AgentChatResult{}
	receivedOutput := false
	var firstToken time.Time
	toolNames := map[int]string{}
	toolArguments := map[int]string{}
	toolIDs := map[int]string{}
	minToolIndex := -1
	completed := false
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 2<<20)
	for scanner.Scan() {
		idleTimer.Reset(c.effectiveStreamIdleTimeout())
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if raw == "" {
			continue
		}
		if raw == "[DONE]" {
			completed = true
			continue
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			return result, receivedOutput, fmt.Errorf("decode chat agent stream event: %w", err)
		}
		if message := streamError(event); message != "" {
			return result, receivedOutput, errors.New(message)
		}
		if reason := streamFinishReason(event); reason != "" {
			if err := validateChatFinishReason(reason); err != nil {
				return result, receivedOutput, err
			}
			completed = true
		}
		if usage := streamUsage(event); usage.PromptTokens > 0 || usage.CompletionTokens > 0 || usage.TotalTokens > 0 || usage.ReasoningTokens > 0 {
			result.Usage.PromptTokens = usage.PromptTokens
			result.Usage.CompletionTokens = usage.CompletionTokens
			result.Usage.TotalTokens = usage.TotalTokens
			result.Usage.ReasoningTokens = usage.ReasoningTokens
			result.ReasoningTokens = usage.ReasoningTokens
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
			if firstToken.IsZero() {
				firstToken = time.Now()
			}
		}
		for _, fragment := range streamReasoningFragments(event) {
			before := result.Reasoning
			result.Reasoning = applyReasoningFragment(result.Reasoning, fragment)
			changed = changed || result.Reasoning != before
			receivedOutput = true
			if firstToken.IsZero() {
				firstToken = time.Now()
			}
		}
		for _, fragment := range streamToolCallFragments(event) {
			receivedOutput = true
			if firstToken.IsZero() {
				firstToken = time.Now()
			}
			if minToolIndex < 0 || fragment.index < minToolIndex {
				minToolIndex = fragment.index
			}
			if fragment.name != "" {
				toolNames[fragment.index] = fragment.name
			}
			if fragment.id != "" {
				toolIDs[fragment.index] = fragment.id
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
	finishChatUsage(&result.Usage, started, firstToken)
	if err := scanner.Err(); err != nil {
		if idleTimedOut.Load() && ctx.Err() == nil {
			return result, receivedOutput, errChatStreamIdle
		}
		return result, receivedOutput, err
	}
	if !completed {
		return result, receivedOutput, errChatStreamIncomplete
	}
	if len(toolNames) > 1 || len(toolArguments) > 1 {
		return result, receivedOutput, errors.New("provider returned multiple tool calls while parallel tool calls are disabled")
	}
	if minToolIndex >= 0 {
		callID := toolIDs[minToolIndex]
		if callID == "" {
			callID = fmt.Sprintf("call_%d", minToolIndex)
		}
		result.ToolCall = &ToolCall{ID: callID, Name: toolNames[minToolIndex], Arguments: toolArguments[minToolIndex]}
	}
	return result, receivedOutput, nil
}

func (c *Client) effectiveStreamIdleTimeout() time.Duration {
	if c != nil && c.streamIdleTimeout > 0 {
		return c.streamIdleTimeout
	}
	return 90 * time.Second
}

func (c *Client) chatStreamContext(ctx context.Context) (context.Context, context.CancelFunc, *time.Timer, *atomic.Bool) {
	streamCtx, cancel := context.WithCancel(ctx)
	timedOut := &atomic.Bool{}
	timer := time.AfterFunc(c.effectiveStreamIdleTimeout(), func() {
		timedOut.Store(true)
		cancel()
	})
	return streamCtx, cancel, timer, timedOut
}

func streamFinishReason(payload map[string]any) string {
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return ""
	}
	choice, _ := choices[0].(map[string]any)
	reason, _ := choice["finish_reason"].(string)
	return strings.TrimSpace(reason)
}

func validateChatFinishReason(reason string) error {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "stop", "tool_calls", "function_call":
		return nil
	case "length", "max_tokens":
		return errChatStreamTruncated
	case "content_filter", "safety":
		return errChatStreamFiltered
	default:
		return fmt.Errorf("unsupported chat finish reason %q", reason)
	}
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
	fragments := make([]streamStringFragment, 0, 4)
	fragments = append(fragments, collectReasoningValue(payload["reasoning_content"], false)...)
	if len(fragments) == 0 {
		fragments = append(fragments, collectReasoningValue(payload["reasoning"], false)...)
		fragments = append(fragments, collectReasoningValue(payload["reasoning_summary"], false)...)
	}
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return fragments
	}
	choice, _ := choices[0].(map[string]any)
	for _, containerName := range []string{"delta", "message"} {
		container, _ := choice[containerName].(map[string]any)
		if container == nil {
			continue
		}
		replace := containerName == "message"
		content := collectReasoningValue(container["reasoning_content"], replace)
		content = append(content, collectReasoningValue(container["reasoning_text"], replace)...)
		content = append(content, collectReasoningValue(container["thinking"], replace)...)
		if len(content) > 0 {
			fragments = append(fragments, content...)
			continue
		}
		fragments = append(fragments, collectReasoningValue(container["reasoning"], replace)...)
		fragments = append(fragments, collectReasoningValue(container["reasoning_summary"], replace)...)
	}
	return fragments
}

func collectReasoningValue(raw any, replace bool) []streamStringFragment {
	switch value := raw.(type) {
	case string:
		if strings.TrimSpace(value) == "" {
			return nil
		}
		return []streamStringFragment{{value: value, replace: replace}}
	case []any:
		out := make([]streamStringFragment, 0, len(value))
		for _, item := range value {
			out = append(out, collectReasoningValue(item, replace)...)
		}
		return out
	case map[string]any:
		if typ, _ := value["type"].(string); strings.Contains(strings.ToLower(typ), "summary") {
			if text := reasoningTextFromMap(value); text != "" {
				return []streamStringFragment{{value: text, replace: replace}}
			}
		}
		for _, key := range []string{"reasoning_content", "reasoning_text", "thinking", "text", "content", "summary", "summary_text"} {
			if inner, ok := value[key]; ok {
				if fragments := collectReasoningValue(inner, replace); len(fragments) > 0 {
					return fragments
				}
			}
		}
	}
	return nil
}

func reasoningTextFromMap(value map[string]any) string {
	for _, key := range []string{"text", "content", "summary", "reasoning_content"} {
		if text, ok := value[key].(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

func applyReasoningFragment(current string, fragment streamStringFragment) string {
	next := fragment.value
	if strings.TrimSpace(next) == "" {
		return current
	}
	if fragment.replace {
		if current == "" || len(next) >= len(current) {
			return next
		}
		return current
	}
	return joinReasoningChunks(current, next)
}

func joinReasoningChunks(current, next string) string {
	if current == "" {
		return next
	}
	if next == "" {
		return current
	}
	if strings.HasPrefix(next, current) {
		return next
	}
	if len(next) > 16 && strings.Contains(current, next) {
		return current
	}
	currentTrim := strings.TrimSpace(current)
	nextTrim := strings.TrimSpace(next)
	if strings.HasSuffix(currentTrim, "**") && strings.HasPrefix(nextTrim, "**") {
		return strings.TrimRight(current, " \t") + "\n\n" + nextTrim
	}
	return current + next
}

func streamUsage(payload map[string]any) ChatUsage {
	raw, _ := payload["usage"].(map[string]any)
	if raw == nil {
		return ChatUsage{}
	}
	usage := ChatUsage{
		PromptTokens:     jsonInt64(raw, "prompt_tokens", "input_tokens", "promptTokens", "inputTokens"),
		CompletionTokens: jsonInt64(raw, "completion_tokens", "output_tokens", "completionTokens", "outputTokens"),
		TotalTokens:      jsonInt64(raw, "total_tokens", "totalTokens"),
	}
	details, _ := raw["completion_tokens_details"].(map[string]any)
	usage.ReasoningTokens = jsonInt64(details, "reasoning_tokens", "reasoningTokens")
	if usage.TotalTokens == 0 && (usage.PromptTokens > 0 || usage.CompletionTokens > 0) {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	return usage
}

func jsonInt64(raw map[string]any, keys ...string) int64 {
	if raw == nil {
		return 0
	}
	for _, key := range keys {
		switch value := raw[key].(type) {
		case int:
			if value > 0 {
				return int64(value)
			}
		case int64:
			if value > 0 {
				return value
			}
		case float64:
			if value > 0 {
				return int64(value)
			}
		case json.Number:
			parsed, err := value.Int64()
			if err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func finishChatUsage(usage *ChatUsage, started, firstToken time.Time) {
	if usage == nil {
		return
	}
	if !started.IsZero() && usage.DurationMs <= 0 {
		elapsed := time.Since(started).Milliseconds()
		if elapsed <= 0 {
			elapsed = 1
		}
		usage.DurationMs = elapsed
	}
	if !firstToken.IsZero() && !started.IsZero() && usage.FirstTokenMs <= 0 {
		elapsed := firstToken.Sub(started).Milliseconds()
		if elapsed <= 0 {
			elapsed = 1
		}
		usage.FirstTokenMs = elapsed
	}
	if usage.TotalTokens == 0 && (usage.PromptTokens > 0 || usage.CompletionTokens > 0) {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
}

func streamReasoningTokens(payload map[string]any) int64 {
	return streamUsage(payload).ReasoningTokens
}

func transientChatError(ctx context.Context, err error) bool {
	if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	if errors.Is(err, errChatStreamIncomplete) || errors.Is(err, errChatStreamIdle) || errors.Is(err, errChatStreamEmpty) {
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

func RetryableOnAlternateRoute(ctx context.Context, err error) bool {
	if transientChatError(ctx, err) {
		return true
	}
	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		return upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden ||
			upstream.Status == http.StatusRequestTimeout
	}
	return false
}

// FailureCode turns provider and streaming failures into stable operational
// categories without exposing upstream response bodies or request content.
func FailureCode(err error) string {
	if err == nil {
		return ""
	}
	switch {
	case errors.Is(err, context.Canceled):
		return "assistant_interrupted"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, errChatStreamIdle):
		return "upstream_timeout"
	case errors.Is(err, errChatStreamTruncated):
		return "output_limit_reached"
	case errors.Is(err, errChatStreamFiltered):
		return "content_filtered"
	case errors.Is(err, errChatStreamIncomplete), errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "upstream_stream_incomplete"
	case errors.Is(err, errChatStreamEmpty):
		return "upstream_empty_response"
	}
	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		switch {
		case upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden:
			return "upstream_auth_failed"
		case upstream.Status == http.StatusTooManyRequests:
			return "upstream_rate_limited"
		case upstream.Status >= http.StatusInternalServerError:
			return "upstream_unavailable"
		default:
			return "upstream_rejected"
		}
	}
	var netErr interface{ Timeout() bool }
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "upstream_timeout"
	}
	return "assistant_run_failed"
}

type toolCallFragment struct {
	index     int
	id        string
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
					index: 0, id: "call_0", name: name, arguments: arguments, replace: containerName == "message",
				})
			}
		}
		calls, _ := container["tool_calls"].([]any)
		for _, rawCall := range calls {
			call, _ := rawCall.(map[string]any)
			function, _ := call["function"].(map[string]any)
			id, _ := call["id"].(string)
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
				index: index, id: id, name: name, arguments: arguments, replace: containerName == "message",
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
	payload := map[string]any{
		"model": c.chatModel, "messages": chatPayloadMessages(messages, imageURLs), "stream": true,
		"stream_options": map[string]any{"include_usage": true},
	}
	c.applyChatOutputLimit(payload)
	c.applyReasoningRequest(payload)
	return c.chatStreamWithPayload(ctx, payload)
}

func (c *Client) applyChatOutputLimit(payload map[string]any) {
	if c == nil || c.maxOutputTokens <= 0 || payload == nil {
		return
	}
	if c.usesCompletionTokenLimit() {
		payload["max_completion_tokens"] = c.maxOutputTokens
		return
	}
	payload["max_tokens"] = c.maxOutputTokens
}

func (c *Client) usesCompletionTokenLimit() bool {
	if c == nil {
		return false
	}
	model := strings.ToLower(strings.TrimSpace(c.chatModel))
	return strings.HasPrefix(model, "gpt-5") || strings.HasPrefix(model, "o1") ||
		strings.HasPrefix(model, "o3") || strings.HasPrefix(model, "o4")
}

func (c *Client) applyReasoningRequest(payload map[string]any) {
	if c == nil || payload == nil {
		return
	}
	effort := strings.TrimSpace(c.reasoningEffort)
	if effort != "" {
		payload["reasoning_effort"] = effort
	}
	if !c.usesCompletionTokenLimit() {
		return
	}
	reasoning := map[string]any{"summary": "detailed"}
	if effort != "" {
		reasoning["effort"] = effort
	}
	payload["reasoning"] = reasoning
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
		item := map[string]any{"role": message.Role, "content": message.Content}
		if message.Name != "" {
			item["name"] = message.Name
		}
		if message.ToolCallID != "" {
			item["tool_call_id"] = message.ToolCallID
		}
		if len(message.ToolCalls) > 0 {
			calls := make([]any, 0, len(message.ToolCalls))
			for callIndex, call := range message.ToolCalls {
				callID := strings.TrimSpace(call.ID)
				if callID == "" {
					callID = fmt.Sprintf("call_%d", callIndex)
				}
				calls = append(calls, map[string]any{
					"id": callID, "type": "function",
					"function": map[string]any{"name": call.Name, "arguments": call.Arguments},
				})
			}
			item["tool_calls"] = calls
		}
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
		item["content"] = content
		payloadMessages[index] = item
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
