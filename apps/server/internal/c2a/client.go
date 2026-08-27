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
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"
)

const (
	maxResponseBytes int64 = 64 << 20
	maxImageBytes    int64 = 20 << 20
	// Reference images are uploaded by the upstream before it acknowledges an
	// async task. Under concurrency that handoff can legitimately exceed one
	// minute, so keep the POST alive long enough to receive the canonical task
	// ID instead of cancelling valid work and trying to recover by client ID.
	asyncSubmitTimeout                   = 2 * time.Minute
	asyncPollTimeout                     = 15 * time.Second
	asyncPollInterval                    = 2 * time.Second
	maxImageDownloadTimeout              = 3 * time.Minute
	imagePollStatusTimeout               = 10 * time.Second
	imageResultDownloadConcurrency int64 = 2
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
	Err     error
}

func (e *NetworkError) Error() string { return e.Message }
func (e *NetworkError) Unwrap() error { return e.Err }
func (e *NetworkError) Timeout() bool {
	var timeout interface{ Timeout() bool }
	if errors.As(e.Err, &timeout) && timeout.Timeout() {
		return true
	}
	message := strings.ToLower(e.Message)
	return strings.Contains(message, "timeout") || strings.Contains(message, "deadline exceeded") ||
		strings.Contains(message, "超时")
}

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
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		Timeout: timeout,
		// Timeout=0: a single pooled client is held for the client's lifetime and
		// every request drives its own deadline via context.WithTimeout, so
		// submit/poll/download all reuse keep-alive connections instead of
		// allocating a fresh Transport (and handshaking) per request.
		HTTPClient:   netguard.NewHTTPClient(0, allowPrivate, false),
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
	reqCtx := ctx
	if timeout > 0 {
		var cancel context.CancelFunc
		reqCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(reqCtx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", err), Err: err}
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
	ID           string           `json:"id"`
	ClientTaskID string           `json:"client_task_id"`
	Status       string           `json:"status"`
	Terminal     bool             `json:"terminal"`
	Progress     string           `json:"progress"`
	Error        string           `json:"error"`
	ErrorCode    string           `json:"error_code"`
	Data         []map[string]any `json:"data"`
	Results      []map[string]any `json:"results"`
}

func (t *imageTask) UnmarshalJSON(buf []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(buf, &raw); err != nil {
		return err
	}
	readString := func(keys ...string) string {
		for _, key := range keys {
			val, ok := raw[key]
			if !ok {
				continue
			}
			var text string
			if json.Unmarshal(val, &text) == nil {
				text = strings.TrimSpace(text)
				if text != "" {
					return text
				}
			}
		}
		return ""
	}
	readBool := func(keys ...string) bool {
		for _, key := range keys {
			if value, ok := raw[key]; ok {
				var result bool
				if json.Unmarshal(value, &result) == nil {
					return result
				}
			}
		}
		return false
	}
	t.ID = readString("id")
	t.ClientTaskID = readString("client_task_id", "clientTaskId")
	t.Status = readString("status", "state")
	t.Terminal = readBool("terminal", "done")
	t.Progress = readString("progress")
	t.ErrorCode = readString("error_code", "errorCode")
	t.Error = readString("error", "message", "public_error", "publicError", "error_message", "errorMessage")
	if t.Error == "" {
		t.Error = imageTaskFailureMessage(raw)
	}
	t.Data = decodeImageObjectArray(raw["data"])
	t.Results = decodeImageObjectArray(raw["results"])
	if len(t.Data) == 0 && len(t.Results) == 0 {
		t.Data = decodeImageObjectArray(raw["images"])
	}
	if len(t.Data) == 0 && len(t.Results) == 0 {
		t.Data = imagesFromNestedPayload(raw["result"])
	}
	if len(t.Data) == 0 && len(t.Results) == 0 {
		t.Data = imagesFromNestedPayload(raw["output"])
	}
	if url := readString("image_url", "imageUrl"); url != "" && len(t.Data) == 0 && len(t.Results) == 0 {
		t.Data = []map[string]any{{"url": url}}
	}
	return nil
}

// imageTaskFailureMessage reads only known text-bearing fields. Some C2A
// deployments return a final review/refusal explanation under result/output/data
// while keeping status=text_review and leaving error empty.
func imageTaskFailureMessage(raw map[string]json.RawMessage) string {
	for _, key := range []string{
		"error", "message", "detail", "reason", "error_description", "errorDescription",
		"public_error", "publicError", "error_message", "errorMessage",
		"output_text", "outputText", "text", "response",
	} {
		if message := imageTaskTextValue(raw[key], 0); message != "" {
			return message
		}
	}
	for _, key := range []string{"result", "output", "data", "results"} {
		if message := imageTaskTextValue(raw[key], 0); message != "" {
			return message
		}
	}
	return ""
}

func imageTaskTextValue(raw json.RawMessage, depth int) string {
	if len(raw) == 0 || depth >= 5 {
		return ""
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return truncate(strings.TrimSpace(text), 2000)
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) == nil {
		for _, key := range []string{
			"error", "message", "detail", "reason", "error_description", "errorDescription",
			"public_error", "publicError", "error_message", "errorMessage",
			"output_text", "outputText", "text", "response", "content",
		} {
			if message := imageTaskTextValue(object[key], depth+1); message != "" {
				return message
			}
		}
		for _, key := range []string{"result", "output", "data", "results"} {
			if message := imageTaskTextValue(object[key], depth+1); message != "" {
				return message
			}
		}
		return ""
	}
	var array []json.RawMessage
	if json.Unmarshal(raw, &array) == nil {
		if len(array) > 20 {
			array = array[:20]
		}
		for _, item := range array {
			if message := imageTaskTextValue(item, depth+1); message != "" {
				return message
			}
		}
	}
	return ""
}

func decodeImageObjectArray(raw json.RawMessage) []map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var items []map[string]any
	if json.Unmarshal(raw, &items) == nil && len(items) > 0 {
		return items
	}
	return nil
}

func imagesFromNestedPayload(raw json.RawMessage) []map[string]any {
	if len(raw) == 0 {
		return nil
	}
	if items := decodeImageObjectArray(raw); len(items) > 0 {
		return items
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return nil
	}
	for _, key := range []string{"data", "images", "results"} {
		nested, _ := json.Marshal(payload[key])
		if items := decodeImageObjectArray(nested); len(items) > 0 {
			return items
		}
	}
	if url, ok := payload["url"].(string); ok && strings.TrimSpace(url) != "" {
		return []map[string]any{{"url": strings.TrimSpace(url)}}
	}
	if url, ok := payload["image_url"].(string); ok && strings.TrimSpace(url) != "" {
		return []map[string]any{{"url": strings.TrimSpace(url)}}
	}
	return nil
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
	Status          string
	ErrorMessage    string
	Err             error
	// CompletedAt 是轮询首次看到上游 succeeded 的时刻（下载开始前）。
	// 时间线用它计算真实上游耗时，避免把本地串行下载/入库算进“上游生成”。
	CompletedAt time.Time
	// ImagePayload 是上游返回的 url / b64 列表。状态轮询可以只带回这个字段，
	// 由 worker 按配置的并发去下载，避免询问进度被拉图堵住。
	ImagePayload []map[string]any
	// DownloadMs / DownloadBytes 记录本次结果图从上游下载回来的耗时与体积，
	// 供任务时间线区分“上游生成慢”与“回传网络慢”。
	DownloadMs    int64
	DownloadBytes int64
}

// downloadStats 累计一次轮询中结果图的下载耗时与字节数。
type downloadStats struct {
	Ms    int64
	Bytes int64
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
		if imageTaskMatchesID(task, taskID) {
			return task, nil
		}
	}
	return imageTask{}, &NetworkError{Message: "上游图片任务暂时不可查询"}
}

func imageTaskMatchesID(task imageTask, taskID string) bool {
	if task.ID == taskID {
		return true
	}
	return strings.TrimSpace(task.ClientTaskID) == taskID
}

func imageTaskRequestedID(task imageTask, requested map[string]struct{}) (string, bool) {
	if _, ok := requested[task.ID]; ok {
		return task.ID, true
	}
	clientID := strings.TrimSpace(task.ClientTaskID)
	if clientID != "" {
		if _, ok := requested[clientID]; ok {
			return clientID, true
		}
	}
	return "", false
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
	dlCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req = req.WithContext(dlCtx)
	downloadStartedAt := time.Now()
	resp, err := c.HTTPClient.Do(req)
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
	log.Printf("c2a image download host=%s bytes=%d duration_ms=%d",
		target.Host, len(data), time.Since(downloadStartedAt).Milliseconds())
	return base64.StdEncoding.EncodeToString(data), nil
}

func nonEmptyImageCount(images []string) int {
	count := 0
	for _, image := range images {
		if image != "" {
			count++
		}
	}
	return count
}

func (c *Client) taskImagesB64(ctx context.Context, data []map[string]any) ([]string, downloadStats, error) {
	if len(data) > 4 {
		return nil, downloadStats{}, &UpstreamError{Message: "上游返回图片数量超过限制"}
	}
	images := make([]string, len(data))
	type downloadResult struct {
		ms    int64
		bytes int64
		err   error
	}
	results := make([]downloadResult, len(data))
	var wg sync.WaitGroup
	for index, item := range data {
		if b64, ok := item["b64_json"].(string); ok && b64 != "" {
			if len(b64) > 32<<20 {
				return nil, downloadStats{}, &UpstreamError{Message: "上游返回的单张图片超过限制"}
			}
			images[index] = b64
			continue
		}
		rawURL, _ := item["url"].(string)
		if strings.TrimSpace(rawURL) == "" {
			continue
		}
		wg.Add(1)
		go func(index int, rawURL string) {
			defer wg.Done()
			startedAt := time.Now()
			b64, err := c.downloadImageB64(ctx, rawURL)
			results[index].ms = time.Since(startedAt).Milliseconds()
			if err != nil {
				results[index].err = err
				return
			}
			results[index].bytes = int64(base64.StdEncoding.DecodedLen(len(b64)))
			images[index] = b64
		}(index, rawURL)
	}
	wg.Wait()
	var stats downloadStats
	var firstErr error
	for _, result := range results {
		if result.ms > stats.Ms {
			stats.Ms = result.ms
		}
		stats.Bytes += result.bytes
		if result.err != nil && firstErr == nil {
			firstErr = result.err
		}
	}
	return images, stats, firstErr
}

func imageTaskError(task imageTask) error {
	message := strings.TrimSpace(task.Error)
	if message == "" {
		switch normalizedImageTaskStatus(task) {
		case "text_review", "text", "text_result", "text_response", "文本":
			message = "上游返回文本，未生成图片"
		default:
			message = "上游图片任务失败"
		}
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

func imagePayloadNeedsHTTP(results []map[string]any) bool {
	for _, item := range results {
		if b64, ok := item["b64_json"].(string); ok && strings.TrimSpace(b64) != "" {
			continue
		}
		if rawURL, ok := item["url"].(string); ok && strings.TrimSpace(rawURL) != "" {
			return true
		}
	}
	return false
}

// DownloadTaskImages 把上游返回的 url / b64 列表转成本地 base64。
func (c *Client) DownloadTaskImages(ctx context.Context, data []map[string]any) ([]string, int64, int64, error) {
	images, stats, err := c.taskImagesB64(ctx, data)
	return images, stats.Ms, stats.Bytes, err
}

func normalizedImageTaskStatus(task imageTask) string {
	return strings.ToLower(strings.TrimSpace(task.Status))
}

func imageTaskStatusPending(status string) bool {
	// 只有明确成功/失败才是终态。moderating 等审核中间态和上游新增的
	// 未知状态继续轮询；text_review 表示图片请求返回了文本，直接失败。
	return !imageTaskStatusSucceeded(status) && !imageTaskStatusFailed(status)
}

func imageTaskStatusSucceeded(status string) bool {
	switch status {
	case "success", "succeeded", "successful", "completed", "complete", "done", "ok", "finished", "finished_successfully":
		return true
	default:
		return false
	}
}

func imageTaskStatusFailed(status string) bool {
	switch status {
	case "error", "failed", "canceled", "cancelled", "expired", "text_review", "text", "text_result", "text_response", "文本":
		return true
	default:
		return false
	}
}

func ImagePollHoldsForReview(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "moderating", "reviewing":
		return true
	default:
		return false
	}
}

func imageTaskIsTextFailure(task imageTask) bool {
	status := normalizedImageTaskStatus(task)
	if imageTaskStatusFailed(status) {
		switch status {
		case "text_review", "text", "text_result", "text_response", "文本":
			return true
		}
	}
	message := strings.TrimSpace(task.Error)
	return strings.Contains(message, "上游返回文本") || strings.Contains(strings.ToLower(message), "returned text")
}

func (c *Client) completedTaskImages(ctx context.Context, task imageTask, expected int) ([]string, downloadStats, bool, error) {
	if imageTaskIsTextFailure(task) {
		return nil, downloadStats{}, true, imageTaskError(task)
	}
	status := normalizedImageTaskStatus(task)
	results := imageTaskResults(task)
	var stats downloadStats
	if len(results) > 0 && (imageTaskStatusSucceeded(status) || imageTaskStatusFailed(status) || len(results) >= expected) {
		images, dlStats, err := c.taskImagesB64(ctx, results)
		stats = dlStats
		if err != nil {
			if isRetryablePollError(err) {
				return images, stats, false, err
			}
			return images, stats, true, err
		}
		if nonEmptyImageCount(images) > 0 {
			return images, stats, true, nil
		}
	}
	if imageTaskStatusPending(status) {
		return nil, stats, false, nil
	}
	if imageTaskStatusSucceeded(status) {
		return nil, stats, true, &UpstreamError{Message: "上游图片任务成功但未返回图片", StatusCode: http.StatusBadGateway}
	}
	if task.Terminal {
		return nil, stats, true, imageTaskError(task)
	}
	if imageTaskStatusFailed(status) {
		return nil, stats, true, imageTaskError(task)
	}
	return nil, stats, false, nil
}

func (c *Client) submitAndPollImageTask(ctx context.Context, endpoint, taskID string, payload map[string]any, expected int) ([]string, error) {
	payload["client_task_id"] = taskID
	if c.Timeout <= 0 {
		return nil, &NetworkError{Message: "上游图片任务超时配置无效"}
	}
	taskCtx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	body, err := c.doRequest(taskCtx, http.MethodPost, endpoint, payload, asyncSubmitTimeout)
	if err != nil && !isRetryablePollError(err) {
		return nil, err
	}
	var task imageTask
	if err == nil {
		task, err = parseImageTask(body)
		if err != nil {
			return nil, err
		}
	}
	// A submit timeout/5xx is ambiguous: the upstream may have accepted the
	// deterministic client_task_id and continued after our connection closed.
	// Poll that id instead of resubmitting or declaring a false failure.
	bestData := imageTaskResults(task)
	if task.ID != "" {
		if images, _, done, taskErr := c.completedTaskImages(taskCtx, task, expected); done {
			return images, taskErr
		}
	}
	recoverBest := func(fallback error) ([]string, error) {
		if len(bestData) == 0 {
			return nil, fallback
		}
		images, _, imageErr := c.taskImagesB64(ctx, bestData)
		if imageErr != nil {
			return nil, imageErr
		}
		if nonEmptyImageCount(images) == 0 {
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
			if images, _, done, err := c.completedTaskImages(taskCtx, task, expected); done {
				if err != nil {
					return recoverBest(err)
				}
				return images, nil
			}
		}
	}
}

// SubmitImageTask submits once and reports whether the upstream task still
// needs polling. Queue workers wait only for the upstream acknowledgement;
// generation itself continues through the lightweight poll queue.
func (c *Client) submitImageTaskTracked(ctx context.Context, endpoint, taskID string, payload map[string]any, expected int) ([]string, bool, string, error) {
	payload["client_task_id"] = taskID
	body, err := c.doRequest(ctx, http.MethodPost, endpoint, payload, asyncSubmitTimeout)
	if err != nil {
		return nil, false, "", err
	}
	task, err := parseImageTask(body)
	if err != nil {
		return nil, false, "", err
	}
	images, _, done, err := c.completedTaskImages(ctx, task, expected)
	if !done {
		return images, true, strings.TrimSpace(task.ID), nil
	}
	return images, false, strings.TrimSpace(task.ID), err
}

func (c *Client) SubmitImageTask(ctx context.Context, endpoint, taskID string, payload map[string]any, expected int) ([]string, bool, error) {
	images, pending, _, err := c.submitImageTaskTracked(ctx, endpoint, taskID, payload, expected)
	return images, pending, err
}

// PollImageTask performs exactly one status request.
func (c *Client) PollImageTask(ctx context.Context, taskID string, expected int) ([]string, bool, error) {
	results := c.PollImageTasks(ctx, []string{taskID}, map[string]int{taskID: expected})
	result := results[taskID]
	return result.Images, result.Pending, result.Err
}

// PollImageTasksEach reads one batch status response, then downloads any
// completed images with bounded concurrency. emit may be invoked concurrently.
func (c *Client) PollImageTasksEach(ctx context.Context, taskIDs []string, expected map[string]int, emit func(string, ImageTaskPollResult)) {
	c.pollImageTasksEach(ctx, taskIDs, expected, nil, emit, true)
}

// PollImageTasksEachGuarded invokes beforeImages immediately before a terminal
// task's image payload is downloaded or decoded. Returning false skips that
// task, allowing workers to acquire a database completion claim only when the
// task can actually produce a result. emit may be invoked concurrently.
func (c *Client) PollImageTasksEachGuarded(ctx context.Context, taskIDs []string, expected map[string]int, beforeImages func(string) bool, emit func(string, ImageTaskPollResult)) {
	c.pollImageTasksEach(ctx, taskIDs, expected, beforeImages, emit, true)
}

// PollImageTaskStatusesGuarded only decodes task status. URL payloads are
// returned on ImagePayload so callers can download them outside the poll loop.
func (c *Client) PollImageTaskStatusesGuarded(ctx context.Context, taskIDs []string, expected map[string]int, beforeImages func(string) bool, emit func(string, ImageTaskPollResult)) {
	c.pollImageTasksEach(ctx, taskIDs, expected, beforeImages, emit, false)
}

func (c *Client) pollImageTasksEach(ctx context.Context, taskIDs []string, expected map[string]int, beforeImages func(string) bool, emit func(string, ImageTaskPollResult), fetchImages bool) {
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
	// Status JSON is fully decoded before any image download so the upstream
	// connection is not held idle while we persist results.
	streamCtx, cancel := context.WithTimeout(ctx, imagePollStatusTimeout)
	defer cancel()
	req = req.WithContext(streamCtx)
	resp, err := c.HTTPClient.Do(req)
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
	failDecode := func(decodeErr error) error {
		if limited.N <= 0 {
			return &UpstreamError{Message: "上游响应超过 64 MiB 限制", StatusCode: http.StatusBadGateway}
		}
		return &UpstreamError{Message: "上游未返回有效的图片任务状态：" + truncate(decodeErr.Error(), 500)}
	}
	var items []imageTask
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		if err == nil {
			err = errors.New("invalid response object")
		}
		emitRemaining(ImageTaskPollResult{Err: failDecode(err)})
		return
	}
	for decoder.More() {
		keyToken, keyErr := decoder.Token()
		if keyErr != nil {
			emitRemaining(ImageTaskPollResult{Err: failDecode(keyErr)})
			return
		}
		key, _ := keyToken.(string)
		if key != "items" {
			var discard json.RawMessage
			if err := decoder.Decode(&discard); err != nil {
				emitRemaining(ImageTaskPollResult{Err: failDecode(err)})
				return
			}
			continue
		}
		arrayToken, arrayErr := decoder.Token()
		if arrayErr != nil || arrayToken != json.Delim('[') {
			if arrayErr == nil {
				arrayErr = errors.New("invalid items array")
			}
			emitRemaining(ImageTaskPollResult{Err: failDecode(arrayErr)})
			return
		}
		for decoder.More() {
			var task imageTask
			if err := decoder.Decode(&task); err != nil {
				emitRemaining(ImageTaskPollResult{Err: failDecode(err)})
				return
			}
			requestedID, wanted := imageTaskRequestedID(task, requested)
			if !wanted {
				continue
			}
			task.ID = requestedID
			items = append(items, task)
		}
		if _, err := decoder.Token(); err != nil {
			emitRemaining(ImageTaskPollResult{Err: failDecode(err)})
			return
		}
	}
	if _, err := decoder.Token(); err != nil {
		emitRemaining(ImageTaskPollResult{Err: failDecode(err)})
		return
	}
	_ = resp.Body.Close()

	type downloadJob struct {
		task        imageTask
		completedAt time.Time
	}
	var jobs []downloadJob
	emitPollResult := func(task imageTask, images []string, payload []map[string]any, stats downloadStats, done bool, taskErr error, completedAt time.Time) {
		emit(task.ID, ImageTaskPollResult{
			Images: images, ImagePayload: payload, Pending: !done,
			ExplicitFailure: imageTaskStatusFailed(normalizedImageTaskStatus(task)) || imageTaskIsTextFailure(task),
			Status:          normalizedImageTaskStatus(task),
			ErrorMessage:    strings.TrimSpace(task.Error),
			Err:             taskErr,
			CompletedAt:     completedAt,
			DownloadMs:      stats.Ms,
			DownloadBytes:   stats.Bytes,
		})
	}
	for _, task := range items {
		seen[task.ID] = struct{}{}
		if imageTaskNeedsCompletionClaim(task, expected[task.ID]) {
			if beforeImages != nil && !beforeImages(task.ID) {
				continue
			}
			completedAt := time.Time{}
			if imageTaskStatusSucceeded(normalizedImageTaskStatus(task)) {
				completedAt = time.Now()
			}
			payload := imageTaskResults(task)
			if !fetchImages && imagePayloadNeedsHTTP(payload) {
				emitPollResult(task, nil, payload, downloadStats{}, true, nil, completedAt)
				continue
			}
			jobs = append(jobs, downloadJob{task: task, completedAt: completedAt})
			continue
		}
		images, dlStats, done, taskErr := c.completedTaskImages(ctx, task, expected[task.ID])
		emitPollResult(task, images, nil, dlStats, done, taskErr, time.Time{})
	}

	downloadSem := semaphore.NewWeighted(imageResultDownloadConcurrency)
	var wg sync.WaitGroup
	for _, job := range jobs {
		job := job
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := downloadSem.Acquire(ctx, 1); err != nil {
				emitPollResult(job.task, nil, nil, downloadStats{}, false, err, job.completedAt)
				return
			}
			defer downloadSem.Release(1)
			images, dlStats, done, taskErr := c.completedTaskImages(ctx, job.task, expected[job.task.ID])
			emitPollResult(job.task, images, nil, dlStats, done, taskErr, job.completedAt)
		}()
	}
	wg.Wait()

	// A requested task omitted from items is not evidence of success or
	// failure. Expose it as an explicit unknown/missing outcome so callers can
	// apply a short consistency grace and then fail over without hanging.
	emitRemaining(ImageTaskPollResult{Pending: true, Missing: true})
}

func imageTaskNeedsCompletionClaim(task imageTask, expected int) bool {
	if task.Terminal || imageTaskIsTextFailure(task) {
		return true
	}
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
	var mu sync.Mutex
	c.PollImageTasksEach(ctx, taskIDs, expected, func(taskID string, result ImageTaskPollResult) {
		mu.Lock()
		results[taskID] = result
		mu.Unlock()
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
	images, pending, _, err := c.SubmitGenerateImagesTracked(ctx, taskID, prompt, model, n, size, options)
	return images, pending, err
}

// SubmitGenerateImagesTracked also returns the canonical upstream task ID so
// queue workers never have to assume that it equals client_task_id.
func (c *Client) SubmitGenerateImagesTracked(ctx context.Context, taskID, prompt, model string, n int, size string, options ImageOptions) ([]string, bool, string, error) {
	payload := imageGenerationPayload(prompt, model, n, size, options)
	images, pending, upstreamTaskID, err := c.submitImageTaskTracked(ctx, "/api/image-tasks/generations", taskID, payload, n)
	if err == nil || !shouldFallbackToSync(err) {
		return images, pending, upstreamTaskID, err
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/generations", payload, c.Timeout)
	if err != nil {
		return nil, false, "", err
	}
	images, err = extractB64List(body)
	return images, false, "", err
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
	images, pending, _, err := c.SubmitEditImagesTracked(ctx, taskID, prompt, model, n, inputImagesB64, size, options)
	return images, pending, err
}

// SubmitEditImagesTracked is the edit equivalent of
// SubmitGenerateImagesTracked.
func (c *Client) SubmitEditImagesTracked(ctx context.Context, taskID, prompt, model string, n int, inputImagesB64 []string, size string, options ImageOptions) ([]string, bool, string, error) {
	payload := imageEditPayload(prompt, model, n, inputImagesB64, size, options)
	images, pending, upstreamTaskID, err := c.submitImageTaskTracked(ctx, "/api/image-tasks/edits", taskID, payload, n)
	if err == nil || !shouldFallbackToSync(err) {
		return images, pending, upstreamTaskID, err
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/edits", payload, c.Timeout)
	if err != nil {
		return nil, false, "", err
	}
	images, err = extractB64List(body)
	return images, false, "", err
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
