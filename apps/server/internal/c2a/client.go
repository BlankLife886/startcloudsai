// Package c2a 是 chatgpt2api 客户端（OpenAI Images 兼容，b64_json）。
package c2a

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
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
	BaseURL string
	APIKey  string
	Timeout time.Duration
}

func New(baseURL, apiKey string, timeoutSecs int) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		Timeout: time.Duration(timeoutSecs) * time.Second,
	}
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
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
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", err)}
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &NetworkError{Message: fmt.Sprintf("上游连接失败：%v", err)}
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
			images = append(images, b64)
		}
	}
	if len(images) == 0 {
		return nil, &UpstreamError{Message: "上游未返回图片数据"}
	}
	return images, nil
}

// GenerateImages 文生图 /v1/images/generations → base64 列表。
func (c *Client) GenerateImages(ctx context.Context, prompt, model string, n int, size string) ([]string, error) {
	payload := map[string]any{"model": model, "prompt": prompt, "n": n, "response_format": "b64_json"}
	if size != "" {
		payload["size"] = size
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/images/generations", payload, c.Timeout)
	if err != nil {
		return nil, err
	}
	return extractB64List(body)
}

// EditImages 图生图 /v1/images/edits（JSON base64 引用）→ base64 列表。
func (c *Client) EditImages(ctx context.Context, prompt, model string, n int, inputImagesB64 []string, size string) ([]string, error) {
	images := make([]map[string]string, 0, len(inputImagesB64))
	for _, b64 := range inputImagesB64 {
		images = append(images, map[string]string{"b64_json": b64})
	}
	payload := map[string]any{
		"model": model, "prompt": prompt, "n": n, "response_format": "b64_json", "images": images,
	}
	if size != "" {
		payload["size"] = size
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
