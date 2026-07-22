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
	maxResponseBytes   int64 = 64 << 20
	maxImageBytes      int64 = 20 << 20
	asyncSubmitTimeout       = 30 * time.Second
	asyncPollTimeout         = 15 * time.Second
	asyncPollInterval        = 2 * time.Second
)

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
}

type imageTaskList struct {
	Items      []imageTask `json:"items"`
	MissingIDs []string    `json:"missing_ids"`
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
	timeout := c.Timeout
	if timeout <= 0 || timeout > time.Minute {
		timeout = time.Minute
	}
	resp, err := netguard.NewHTTPClient(timeout, c.AllowPrivate, false).Do(req)
	if err != nil {
		return "", &NetworkError{Message: fmt.Sprintf("下载上游图片失败：%v", err)}
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL == nil || netguard.ValidateURL(resp.Request.URL.String(), c.AllowPrivate, false) != nil {
		return "", &UpstreamError{Message: "上游图片下载跳转地址不安全"}
	}
	if resp.StatusCode >= 400 {
		return "", &UpstreamError{Message: fmt.Sprintf("下载上游图片失败（HTTP %d）", resp.StatusCode), StatusCode: resp.StatusCode}
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

func (c *Client) completedTaskImages(ctx context.Context, task imageTask, expected int) ([]string, bool, error) {
	status := strings.ToLower(strings.TrimSpace(task.Status))
	if len(task.Data) > 0 && (status == "success" || status == "error" || len(task.Data) >= expected) {
		images, err := c.taskImagesB64(ctx, task.Data)
		if err != nil {
			return nil, true, err
		}
		if len(images) > 0 {
			return images, true, nil
		}
	}
	switch status {
	case "queued", "running", "":
		return nil, false, nil
	case "success":
		return nil, true, &UpstreamError{Message: "上游图片任务成功但未返回图片", StatusCode: http.StatusBadGateway}
	case "error":
		return nil, true, imageTaskError(task)
	default:
		return nil, true, &UpstreamError{Message: "上游返回未知图片任务状态：" + status, StatusCode: http.StatusBadGateway}
	}
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
	bestData := task.Data
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
			if len(task.Data) > len(bestData) {
				bestData = task.Data
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

func isRetryablePollError(err error) bool {
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

func shouldFallbackToSync(err error) bool {
	var upstream *UpstreamError
	return errors.As(err, &upstream) && (upstream.StatusCode == http.StatusNotFound || upstream.StatusCode == http.StatusMethodNotAllowed)
}

// GenerateImages 文生图 /v1/images/generations → base64 列表。
func (c *Client) GenerateImages(ctx context.Context, prompt, model string, n int, size string) ([]string, error) {
	return c.GenerateImagesWithID(ctx, uuid.NewString(), prompt, model, n, size)
}

// GenerateImagesWithID 优先使用 chatgpt2api 异步图片任务接口；taskID 使重试幂等。
func (c *Client) GenerateImagesWithID(ctx context.Context, taskID, prompt, model string, n int, size string) ([]string, error) {
	payload := map[string]any{
		"model": model, "prompt": prompt, "n": n,
		"quality": "auto", "response_format": "b64_json",
		"history_disabled": true, "stream": false,
	}
	if size != "" {
		payload["size"] = size
	}
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

// EditImages 图生图 /v1/images/edits（JSON base64 引用）→ base64 列表。
func (c *Client) EditImages(ctx context.Context, prompt, model string, n int, inputImagesB64 []string, size string) ([]string, error) {
	return c.EditImagesWithID(ctx, uuid.NewString(), prompt, model, n, inputImagesB64, size)
}

// EditImagesWithID 使用幂等异步任务提交图生图请求，并在旧上游不支持时回退同步接口。
func (c *Client) EditImagesWithID(ctx context.Context, taskID, prompt, model string, n int, inputImagesB64 []string, size string) ([]string, error) {
	images := make([]map[string]string, 0, len(inputImagesB64))
	for _, b64 := range inputImagesB64 {
		images = append(images, map[string]string{"b64_json": b64})
	}
	payload := map[string]any{
		"model": model, "prompt": prompt, "n": n,
		"quality": "auto", "response_format": "b64_json",
		"history_disabled": true, "stream": false, "images": images,
	}
	if size != "" {
		payload["size"] = size
	}
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
