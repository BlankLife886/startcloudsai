// Package c2a 是 chatgpt2api 客户端（OpenAI Images 兼容，b64_json）。
package c2a

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/google/uuid"
)

const (
	maxResponseBytes        int64 = 64 << 20
	maxImageBytes           int64 = 20 << 20
	asyncSubmitTimeout            = 30 * time.Second
	asyncPollTimeout              = 15 * time.Second
	asyncPollInterval             = 2 * time.Second
	maxImageDownloadTimeout       = 3 * time.Minute
)

func imageDownloadTimeout(configured time.Duration) time.Duration {
	if configured <= 0 || configured > maxImageDownloadTimeout {
		return maxImageDownloadTimeout
	}
	return configured
}

// UpstreamError 上游返回的业务错误（不重试）。
type UpstreamError struct {
	Message    string
	StatusCode int
}

func (e *UpstreamError) Error() string { return e.Message }

// NetworkError 连接/超时类错误（可重试一次）。
type NetworkError struct {
	Message string
}

func (e *NetworkError) Error() string { return e.Message }

type imageNotReadyError struct {
	err error
}

func (e *imageNotReadyError) Error() string { return e.err.Error() }
func (e *imageNotReadyError) Unwrap() error { return e.err }

type Client struct {
	BaseURL      string
	APIKey       string
	Timeout      time.Duration
	HTTPClient   *http.Client
	AllowPrivate bool
}

func New(baseURL, apiKey string, timeoutSecs int) *Client {
	return NewWithPolicy(baseURL, apiKey, timeoutSecs, false)
}

func NewWithPolicy(baseURL, apiKey string, timeoutSecs int, allowPrivate bool) *Client {
	timeout := time.Duration(timeoutSecs) * time.Second
	return &Client{
		BaseURL:      strings.TrimRight(baseURL, "/"),
		APIKey:       apiKey,
		Timeout:      timeout,
		HTTPClient:   netguard.NewHTTPClient(timeout, allowPrivate, false),
		AllowPrivate: allowPrivate,
	}
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// endpointURL accepts both an origin (https://host) and an OpenAI-style
// versioned base URL (https://host/v1) without producing /v1/v1 paths.
func (c *Client) endpointURL(requestPath string) (string, error) {
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("invalid upstream base URL")
	}
	rel, err := url.Parse("/" + strings.TrimLeft(requestPath, "/"))
	if err != nil {
		return "", fmt.Errorf("invalid upstream request path")
	}
	requestPath = rel.Path
	basePath := strings.TrimRight(base.Path, "/")
	if strings.HasSuffix(basePath, "/v1") {
		switch {
		case strings.HasPrefix(requestPath, "/v1/"):
			requestPath = strings.TrimPrefix(requestPath, "/v1")
		case strings.HasPrefix(requestPath, "/api/"):
			basePath = strings.TrimSuffix(basePath, "/v1")
		}
	}
	base.Path = path.Clean(basePath + requestPath)
	base.RawPath = ""
	base.RawQuery = rel.RawQuery
	base.Fragment = ""
	return base.String(), nil
}

// errorMessage 提取上游错误：body.detail / body.error / 整个 body；dict 再取 error/message。
func errorMessage(body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return truncate(string(body), 2000)
	}
	detail, ok := payload["detail"]
	if !ok || detail == nil {
		detail, ok = payload["error"]
	}
	if !ok || detail == nil {
		detail = payload
	}
	if m, isMap := detail.(map[string]any); isMap {
		if v, ok := m["error"]; ok && v != nil {
			detail = v
		} else if v, ok := m["message"]; ok && v != nil {
			detail = v
		} else {
			detail = fmt.Sprintf("%v", m)
		}
	}
	return truncate(fmt.Sprintf("%v", detail), 2000)
}

func (c *Client) doRequest(ctx context.Context, method, path string, payload any, timeout time.Duration) ([]byte, error) {
	var body io.Reader
	if payload != nil {
		buf, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(buf)
	}
	endpoint, err := c.endpointURL(path)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	client := c.HTTPClient
	if timeout != c.Timeout {
		client = netguard.NewHTTPClient(timeout, c.AllowPrivate, false)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", err)}
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", err)}
	}
	if int64(len(respBody)) > maxResponseBytes {
		return nil, &UpstreamError{Message: "上游响应超过 64 MiB 限制", StatusCode: http.StatusBadGateway}
	}
	if resp.StatusCode >= 400 {
		return nil, &UpstreamError{Message: errorMessage(respBody), StatusCode: resp.StatusCode}
	}
	return respBody, nil
}

func extractB64List(body []byte) ([]string, error) {
	var payload struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, &UpstreamError{Message: "上游未返回图片数据"}
	}
	var images []string
	for _, item := range payload.Data {
		if b64, ok := item["b64_json"].(string); ok && b64 != "" {
			if len(images) >= 4 {
				return nil, &UpstreamError{Message: "上游返回图片数量超过限制"}
			}
			if len(b64) > 32<<20 {
				return nil, &UpstreamError{Message: "上游返回的单张图片超过限制"}
			}
			images = append(images, b64)
		}
	}
	if len(images) == 0 {
		return nil, &UpstreamError{Message: "上游未返回图片数据"}
	}
	return images, nil
}

type imageTask struct {
	ID        string           `json:"id"`
	Status    string           `json:"status"`
	Progress  string           `json:"progress"`
	Error     string           `json:"error"`
	ErrorCode string           `json:"error_code"`
	Data      []map[string]any `json:"data"`
	Results   []map[string]any `json:"results"`
}

type imageTaskList struct {
	Items      []imageTask `json:"items"`
	MissingIDs []string    `json:"missing_ids"`
}

type ImageTaskPollResult struct {
	Images          []string
	Pending         bool
	Missing         bool
	ExplicitFailure bool
	Err             error
}

func parseImageTask(body []byte) (imageTask, error) {
	var task imageTask
	if err := json.Unmarshal(body, &task); err != nil || task.ID == "" {
		return imageTask{}, &UpstreamError{Message: "上游未返回有效的图片任务"}
	}
	return task, nil
}

func parseImageTaskList(body []byte, taskID string) (imageTask, error) {
	var payload imageTaskList
	if err := json.Unmarshal(body, &payload); err != nil {
		return imageTask{}, &UpstreamError{Message: "上游未返回有效的图片任务状态"}
	}
	for _, task := range payload.Items {
		if task.ID == taskID {
			return task, nil
		}
	}
	return imageTask{}, &NetworkError{Message: "上游图片任务暂时不可查询"}
}

func (c *Client) normalizeImageURL(raw string) (*url.URL, bool, error) {
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, false, &UpstreamError{Message: "上游图片地址无效"}
	}
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, false, &UpstreamError{Message: "上游图片地址无效"}
	}
	if !target.IsAbs() {
		origin := *base
		origin.Path, origin.RawPath, origin.RawQuery, origin.Fragment = "/", "", "", ""
		target = origin.ResolveReference(target)
	}
	if err := netguard.ValidateURL(target.String(), c.AllowPrivate, false); err != nil {
		return nil, false, &UpstreamError{Message: "上游图片地址不安全"}
	}
	sameOrigin := target.Scheme == base.Scheme && strings.EqualFold(target.Host, base.Host)
	return target, sameOrigin, nil
}

func (c *Client) downloadImageB64(ctx context.Context, rawURL string) (string, error) {
	target, sameOrigin, err := c.normalizeImageURL(rawURL)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return "", err
	}
	if sameOrigin {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	timeout := imageDownloadTimeout(c.Timeout)
	resp, err := netguard.NewHTTPClient(timeout, c.AllowPrivate, false).Do(req)
	if err != nil {
		return "", &NetworkError{Message: fmt.Sprintf("下载上游图片失败：%v", err)}
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL == nil || netguard.ValidateURL(resp.Request.URL.String(), c.AllowPrivate, false) != nil {
		return "", &UpstreamError{Message: "上游图片下载跳转地址不安全"}
	}
	if resp.StatusCode >= 400 {
		err := &UpstreamError{Message: fmt.Sprintf("下载上游图片失败（HTTP %d）", resp.StatusCode), StatusCode: resp.StatusCode}
		if resp.StatusCode == http.StatusNotFound {
			return "", &imageNotReadyError{err: err}
		}
		return "", err
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return "", &NetworkError{Message: fmt.Sprintf("下载上游图片失败：%v", err)}
	}
	if len(data) == 0 || int64(len(data)) > maxImageBytes {
		return "", &UpstreamError{Message: "上游图片为空或超过 20 MiB 限制"}
	}
	if !strings.HasPrefix(http.DetectContentType(data), "image/") {
		return "", &UpstreamError{Message: "上游图片格式无效"}
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func (c *Client) taskImagesB64(ctx context.Context, data []map[string]any) ([]string, error) {
	images := make([]string, 0, len(data))
	for _, item := range data {
		if len(images) >= 4 {
			return nil, &UpstreamError{Message: "上游返回图片数量超过限制"}
		}
		if b64, ok := item["b64_json"].(string); ok && b64 != "" {
			if len(b64) > 32<<20 {
				return nil, &UpstreamError{Message: "上游返回的单张图片超过限制"}
			}
			images = append(images, b64)
			continue
		}
		if rawURL, ok := item["url"].(string); ok && rawURL != "" {
			b64, err := c.downloadImageB64(ctx, rawURL)
			if err != nil {
				return nil, err
			}
			images = append(images, b64)
		}
	}
	return images, nil
}

func imageTaskError(task imageTask) error {
	message := strings.TrimSpace(task.Error)
	if message == "" {
		message = "上游图片任务失败"
	}
	if task.ErrorCode != "" {
		message = task.ErrorCode + ": " + message
	}
	return &UpstreamError{Message: truncate(message, 2000), StatusCode: http.StatusBadGateway}
}

func imageTaskResults(task imageTask) []map[string]any {
	if len(task.Data) > 0 {
		return task.Data
	}
	return task.Results
}

func normalizedImageTaskStatus(task imageTask) string {
	return strings.ToLower(strings.TrimSpace(task.Status))
}

func imageTaskStatusPending(status string) bool {
	switch status {
	case "", "queued", "pending", "running", "processing", "in_progress":
		return true
	default:
		return false
	}
}

func imageTaskStatusSucceeded(status string) bool {
	switch status {
	case "success", "succeeded", "completed":
		return true
	default:
		return false
	}
}

func imageTaskStatusFailed(status string) bool {
	switch status {
	case "error", "failed", "canceled", "cancelled":
		return true
	default:
		return false
	}
}

func (c *Client) completedTaskImages(ctx context.Context, task imageTask, expected int) ([]string, bool, error) {
	status := normalizedImageTaskStatus(task)
	results := imageTaskResults(task)
	if len(results) > 0 && (imageTaskStatusSucceeded(status) || imageTaskStatusFailed(status) || len(results) >= expected) {
		images, err := c.taskImagesB64(ctx, results)
		if err != nil {
			return nil, true, err
		}
		if len(images) > 0 {
			return images, true, nil
		}
	}
	if imageTaskStatusPending(status) {
		return nil, false, nil
	}
	if imageTaskStatusSucceeded(status) {
		return nil, true, &UpstreamError{Message: "上游图片任务成功但未返回图片", StatusCode: http.StatusBadGateway}
	}
	if imageTaskStatusFailed(status) {
		return nil, true, imageTaskError(task)
	}
	return nil, true, &UpstreamError{Message: "上游返回未知图片任务状态：" + status, StatusCode: http.StatusBadGateway}
}

func (c *Client) submitAndPollImageTask(ctx context.Context, endpoint, taskID string, payload map[string]any, expected int) ([]string, error) {
	payload["client_task_id"] = taskID
	if c.Timeout <= 0 {
		return nil, &NetworkError{Message: "上游图片任务超时配置无效"}
	}
	taskCtx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	body, err := c.doRequest(taskCtx, http.MethodPost, endpoint, payload, asyncSubmitTimeout)
	if err != nil {
		return nil, err
	}
	task, err := parseImageTask(body)
	if err != nil {
		return nil, err
	}
	bestData := imageTaskResults(task)
	if images, done, err := c.completedTaskImages(taskCtx, task, expected); done {
		return images, err
	}
	recoverBest := func(fallback error) ([]string, error) {
		if len(bestData) == 0 {
			return nil, fallback
		}
		images, imageErr := c.taskImagesB64(ctx, bestData)
		if imageErr != nil {
			return nil, imageErr
		}
		if len(images) == 0 {
			return nil, fallback
		}
		return images, nil
	}

	statusPath := "/api/image-tasks?ids=" + url.QueryEscape(taskID)
	ticker := time.NewTicker(asyncPollInterval)
	defer ticker.Stop()
	var lastPollError error
	for {
		select {
		case <-taskCtx.Done():
			if lastPollError != nil {
				return recoverBest(&NetworkError{Message: "上游图片任务等待超时；最后一次查询失败：" + lastPollError.Error()})
			}
			return recoverBest(&NetworkError{Message: "上游图片任务等待超时"})
		case <-ticker.C:
			body, err = c.doRequest(taskCtx, http.MethodGet, statusPath, nil, asyncPollTimeout)
			if err != nil {
				if isRetryablePollError(err) {
					lastPollError = err
					continue
				}
				return recoverBest(err)
			}
			task, err = parseImageTaskList(body, taskID)
			if err != nil {
				if isRetryablePollError(err) {
					lastPollError = err
					continue
				}
				return recoverBest(err)
			}
			lastPollError = nil
			if results := imageTaskResults(task); len(results) > len(bestData) {
				bestData = results
			}
			if images, done, err := c.completedTaskImages(taskCtx, task, expected); done {
				if err != nil {
					return recoverBest(err)
				}
				return images, nil
			}
		}
	}
}

// SubmitImageTask submits once and reports whether the upstream task still
// needs polling. It is used by queue workers so upstream wait time does not
// occupy a worker goroutine.
func (c *Client) SubmitImageTask(ctx context.Context, endpoint, taskID string, payload map[string]any, expected int) ([]string, bool, error) {
	payload["client_task_id"] = taskID
	body, err := c.doRequest(ctx, http.MethodPost, endpoint, payload, asyncSubmitTimeout)
	if err != nil {
		return nil, false, err
	}
	task, err := parseImageTask(body)
	if err != nil {
		return nil, false, err
	}
	images, done, err := c.completedTaskImages(ctx, task, expected)
	return images, !done, err
}

// PollImageTask performs exactly one status request.
func (c *Client) PollImageTask(ctx context.Context, taskID string, expected int) ([]string, bool, error) {
	results := c.PollImageTasks(ctx, []string{taskID}, map[string]int{taskID: expected})
	result := results[taskID]
	return result.Images, result.Pending, result.Err
}

// PollImageTasksEach streams one batch response and emits each task before
// decoding the next one. This keeps memory proportional to one task's images,
// rather than retaining every completed image in the provider batch.
func (c *Client) PollImageTasksEach(ctx context.Context, taskIDs []string, expected map[string]int, emit func(string, ImageTaskPollResult)) {
	c.pollImageTasksEach(ctx, taskIDs, expected, nil, emit)
}

// PollImageTasksEachGuarded invokes beforeImages immediately before a terminal
// task's image payload is downloaded or decoded. Returning false skips that
// task, allowing workers to acquire a database completion claim only when the
// task can actually produce a result.
func (c *Client) PollImageTasksEachGuarded(ctx context.Context, taskIDs []string, expected map[string]int, beforeImages func(string) bool, emit func(string, ImageTaskPollResult)) {
	c.pollImageTasksEach(ctx, taskIDs, expected, beforeImages, emit)
}

func (c *Client) pollImageTasksEach(ctx context.Context, taskIDs []string, expected map[string]int, beforeImages func(string) bool, emit func(string, ImageTaskPollResult)) {
	if len(taskIDs) == 0 || emit == nil {
		return
	}
	if len(taskIDs) > 100 {
		taskIDs = taskIDs[:100]
	}
	requested := make(map[string]struct{}, len(taskIDs))
	for _, taskID := range taskIDs {
		requested[taskID] = struct{}{}
	}
	seen := make(map[string]struct{}, len(taskIDs))
	emitRemaining := func(result ImageTaskPollResult) {
		for _, taskID := range taskIDs {
			if _, ok := seen[taskID]; ok {
				continue
			}
			seen[taskID] = struct{}{}
			emit(taskID, result)
		}
	}

	statusPath := "/api/image-tasks?ids=" + url.QueryEscape(strings.Join(taskIDs, ","))
	endpoint, err := c.endpointURL(statusPath)
	if err != nil {
		emitRemaining(ImageTaskPollResult{Err: err})
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		emitRemaining(ImageTaskPollResult{Err: err})
		return
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	// Persistence is deliberately performed while streaming the response. Give
	// the bounded poll job enough time to apply backpressure without buffering
	// the whole response in memory.
	client := netguard.NewHTTPClient(10*time.Minute, c.AllowPrivate, false)
	resp, err := client.Do(req)
	if err != nil {
		emitRemaining(ImageTaskPollResult{Err: &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", err)}})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
		if readErr != nil {
			emitRemaining(ImageTaskPollResult{Err: &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", readErr)}})
			return
		}
		emitRemaining(ImageTaskPollResult{Err: &UpstreamError{Message: errorMessage(body), StatusCode: resp.StatusCode}})
		return
	}

	limited := &io.LimitedReader{R: resp.Body, N: maxResponseBytes + 1}
	decoder := json.NewDecoder(limited)
	failDecode := func(decodeErr error) {
		if limited.N <= 0 {
			decodeErr = &UpstreamError{Message: "上游响应超过 64 MiB 限制", StatusCode: http.StatusBadGateway}
		} else {
			decodeErr = &UpstreamError{Message: "上游未返回有效的图片任务状态：" + truncate(decodeErr.Error(), 500)}
		}
		emitRemaining(ImageTaskPollResult{Err: decodeErr})
	}
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		if err == nil {
			err = errors.New("invalid response object")
		}
		failDecode(err)
		return
	}
	for decoder.More() {
		keyToken, keyErr := decoder.Token()
		if keyErr != nil {
			failDecode(keyErr)
			return
		}
		key, _ := keyToken.(string)
		if key != "items" {
			var discard json.RawMessage
			if err := decoder.Decode(&discard); err != nil {
				failDecode(err)
				return
			}
			continue
		}
		arrayToken, arrayErr := decoder.Token()
		if arrayErr != nil || arrayToken != json.Delim('[') {
			if arrayErr == nil {
				arrayErr = errors.New("invalid items array")
			}
			failDecode(arrayErr)
			return
		}
		for decoder.More() {
			var task imageTask
			if err := decoder.Decode(&task); err != nil {
				failDecode(err)
				return
			}
			if _, wanted := requested[task.ID]; !wanted {
				continue
			}
			seen[task.ID] = struct{}{}
			if imageTaskNeedsCompletionClaim(task, expected[task.ID]) && beforeImages != nil && !beforeImages(task.ID) {
				continue
			}
			images, done, taskErr := c.completedTaskImages(ctx, task, expected[task.ID])
			emit(task.ID, ImageTaskPollResult{
				Images: images, Pending: !done,
				ExplicitFailure: imageTaskStatusFailed(normalizedImageTaskStatus(task)),
				Err:             taskErr,
			})
		}
		if _, err := decoder.Token(); err != nil {
			failDecode(err)
			return
		}
	}
	if _, err := decoder.Token(); err != nil {
		failDecode(err)
		return
	}
	// A requested task omitted from items is not evidence of success or
	// failure. Expose it as an explicit unknown/missing outcome so callers can
	// apply a short consistency grace and then fail over without hanging.
	emitRemaining(ImageTaskPollResult{Pending: true, Missing: true})
}

func imageTaskNeedsCompletionClaim(task imageTask, expected int) bool {
	status := normalizedImageTaskStatus(task)
	if !imageTaskStatusPending(status) {
		return true
	}
	results := imageTaskResults(task)
	return len(results) > 0 && len(results) >= expected
}

// PollImageTasks fetches up to 100 task states in one upstream request.
func (c *Client) PollImageTasks(ctx context.Context, taskIDs []string, expected map[string]int) map[string]ImageTaskPollResult {
	results := make(map[string]ImageTaskPollResult, len(taskIDs))
	c.PollImageTasksEach(ctx, taskIDs, expected, func(taskID string, result ImageTaskPollResult) {
		results[taskID] = result
	})
	return results
}

func imageGenerationPayload(prompt, model string, n int, size string, options ImageOptions) map[string]any {
	payload := map[string]any{
		"model": model, "prompt": prompt, "n": n,
		"response_format":  "b64_json",
		"history_disabled": true, "stream": false,
	}
	applyImageOptions(payload, options)
	if size != "" {
		payload["size"] = size
	}
	return payload
}

func imageEditPayload(prompt, model string, n int, inputImagesB64 []string, size string, options ImageOptions) map[string]any {
	images := make([]map[string]string, 0, len(inputImagesB64))
	for _, b64 := range inputImagesB64 {
		images = append(images, map[string]string{"b64_json": b64})
	}
	payload := imageGenerationPayload(prompt, model, n, size, options)
	payload["images"] = images
	switch fidelity := strings.ToLower(strings.TrimSpace(options.InputFidelity)); fidelity {
	case "low", "high":
		payload["input_fidelity"] = fidelity
	}
	return payload
}

func isRetryablePollError(err error) bool {
	var imageNotReady *imageNotReadyError
	if errors.As(err, &imageNotReady) {
		return true
	}
	var networkErr *NetworkError
	if errors.As(err, &networkErr) {
		return true
	}
	var upstreamErr *UpstreamError
	if !errors.As(err, &upstreamErr) {
		return false
	}
	switch upstreamErr.StatusCode {
	case http.StatusRequestTimeout,
		http.StatusTooEarly,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func IsRetryableError(err error) bool { return isRetryablePollError(err) }

func shouldFallbackToSync(err error) bool {
	var upstream *UpstreamError
	return errors.As(err, &upstream) && (upstream.StatusCode == http.StatusNotFound || upstream.StatusCode == http.StatusMethodNotAllowed)
}

// GenerateImages 文生图 /v1/images/generations → base64 列表。
func (c *Client) GenerateImages(ctx context.Context, prompt, model string, n int, size string) ([]string, error) {
	return c.GenerateImagesWithID(ctx, uuid.NewString(), prompt, model, n, size)
}

type ImageOptions struct {
	Quality               string
	InputFidelity         string
	TransparentBackground bool
	OutputFormat          string
	ModerationLevel       string
}

func applyImageOptions(payload map[string]any, options ImageOptions) {
	payload["quality"] = normalizedImageQuality(options.Quality)
	if options.TransparentBackground {
		payload["background"] = "transparent"
	}
	switch format := strings.ToLower(strings.TrimSpace(options.OutputFormat)); format {
	case "jpg":
		payload["output_format"] = "jpeg"
	case "png", "jpeg", "webp":
		payload["output_format"] = format
	}
	switch moderation := strings.ToLower(strings.TrimSpace(options.ModerationLevel)); moderation {
	case "auto", "low":
		payload["moderation"] = moderation
	}
}

// GenerateImagesWithID 优先使用 chatgpt2api 异步图片任务接口；taskID 使重试幂等。
func (c *Client) GenerateImagesWithID(ctx context.Context, taskID, prompt, model string, n int, size string, requestedQuality ...string) ([]string, error) {
	quality := ""
	if len(requestedQuality) > 0 {
		quality = requestedQuality[0]
	}
	return c.GenerateImagesWithOptions(ctx, taskID, prompt, model, n, size, ImageOptions{Quality: quality})
}

func (c *Client) GenerateImagesWithOptions(ctx context.Context, taskID, prompt, model string, n int, size string, options ImageOptions) ([]string, error) {
	payload := imageGenerationPayload(prompt, model, n, size, options)
	images, err := c.submitAndPollImageTask(ctx, "/api/image-tasks/generations", taskID, payload, n)
	if err == nil || !shouldFallbackToSync(err) {
		return images, err
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/generations", payload, c.Timeout)
	if err != nil {
		return nil, err
	}
	return extractB64List(body)
}

func (c *Client) SubmitGenerateImages(ctx context.Context, taskID, prompt, model string, n int, size string, options ImageOptions) ([]string, bool, error) {
	payload := imageGenerationPayload(prompt, model, n, size, options)
	images, pending, err := c.SubmitImageTask(ctx, "/api/image-tasks/generations", taskID, payload, n)
	if err == nil || !shouldFallbackToSync(err) {
		return images, pending, err
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/generations", payload, c.Timeout)
	if err != nil {
		return nil, false, err
	}
	images, err = extractB64List(body)
	return images, false, err
}

// EditImages 图生图 /v1/images/edits（JSON base64 引用）→ base64 列表。
func (c *Client) EditImages(ctx context.Context, prompt, model string, n int, inputImagesB64 []string, size string) ([]string, error) {
	return c.EditImagesWithID(ctx, uuid.NewString(), prompt, model, n, inputImagesB64, size)
}

// EditImagesWithID 使用幂等异步任务提交图生图请求，并在旧上游不支持时回退同步接口。
func (c *Client) EditImagesWithID(ctx context.Context, taskID, prompt, model string, n int, inputImagesB64 []string, size string, requestedQuality ...string) ([]string, error) {
	quality := ""
	if len(requestedQuality) > 0 {
		quality = requestedQuality[0]
	}
	return c.EditImagesWithOptions(ctx, taskID, prompt, model, n, inputImagesB64, size, ImageOptions{Quality: quality})
}

func (c *Client) EditImagesWithOptions(ctx context.Context, taskID, prompt, model string, n int, inputImagesB64 []string, size string, options ImageOptions) ([]string, error) {
	payload := imageEditPayload(prompt, model, n, inputImagesB64, size, options)
	result, err := c.submitAndPollImageTask(ctx, "/api/image-tasks/edits", taskID, payload, n)
	if err == nil || !shouldFallbackToSync(err) {
		return result, err
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/edits", payload, c.Timeout)
	if err != nil {
		return nil, err
	}
	return extractB64List(body)
}

func (c *Client) SubmitEditImages(ctx context.Context, taskID, prompt, model string, n int, inputImagesB64 []string, size string, options ImageOptions) ([]string, bool, error) {
	payload := imageEditPayload(prompt, model, n, inputImagesB64, size, options)
	images, pending, err := c.SubmitImageTask(ctx, "/api/image-tasks/edits", taskID, payload, n)
	if err == nil || !shouldFallbackToSync(err) {
		return images, pending, err
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/edits", payload, c.Timeout)
	if err != nil {
		return nil, false, err
	}
	images, err = extractB64List(body)
	return images, false, err
}

func normalizedImageQuality(values ...string) string {
	if len(values) == 0 {
		return "auto"
	}
	switch quality := strings.ToLower(strings.TrimSpace(values[0])); quality {
	case "low", "medium", "high", "auto":
		return quality
	default:
		return "auto"
	}
}

// ListModels 连通性测试 GET /v1/models（15s 超时）。
func (c *Client) ListModels(ctx context.Context) (map[string]any, error) {
	body, err := c.doRequest(ctx, http.MethodGet, "/v1/models", nil, 15*time.Second)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, &UpstreamError{Message: truncate(string(body), 2000)}
	}
	return payload, nil
}
