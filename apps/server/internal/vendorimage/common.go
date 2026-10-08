// Package vendorimage speaks vendor-native image APIs that are not OpenAI
// compatible: Alibaba DashScope (qwen-image) and MiniMax (image-01). Each
// client implements c2a.ImageBackend, so every image call site (tasks,
// assistant, canvas, model tests) works through the usual c2a client.
package vendorimage

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/upstreamguard"
)

const maxResponseBytes = 64 << 20

// Downloader fetches an image URL as base64 (c2a.Client.DownloadImageB64).
type Downloader func(ctx context.Context, rawURL string) (string, error)

// conn is the shared HTTP side of a vendor client.
type conn struct {
	vendor  string
	headers map[string]string
	http    *http.Client
	timeout time.Duration
}

func newConn(vendor string, headers map[string]string, timeoutSecs int, httpClient *http.Client) conn {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	timeout := time.Duration(timeoutSecs) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	return conn{vendor: vendor, headers: headers, http: httpClient, timeout: timeout}
}

// post sends a JSON body and returns the raw response, or a classified error
// built by decode from a non-2xx body.
func (c conn) post(ctx context.Context, endpoint string, body any, decode func(status int, body []byte) string) ([]byte, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	if err := upstreamguard.Check(ctx); err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for key, value := range c.headers {
		req.Header.Set(key, value)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		// The request may have reached the vendor; a blind retry could bill twice.
		return nil, &c2a.SynchronousImageError{Err: &c2a.NetworkError{Message: "连接 " + c.vendor + " 失败：" + err.Error(), Err: err}}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, &c2a.SynchronousImageError{Err: &c2a.NetworkError{Message: "读取 " + c.vendor + " 响应失败：" + err.Error(), Err: err}}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := decode(resp.StatusCode, data)
		if message == "" {
			message = strings.TrimSpace(string(data))
		}
		if message == "" {
			message = http.StatusText(resp.StatusCode)
		}
		return nil, classify(c.vendor, resp.StatusCode, message)
	}
	return data, nil
}

func classify(vendor string, status int, message string) error {
	message = vendor + " 请求失败（HTTP " + strconv.Itoa(status) + "）：" + truncate(message, 400)
	if status == http.StatusTooManyRequests || status >= 500 {
		return &c2a.NetworkError{Message: message, Err: errors.New(message)}
	}
	return &c2a.UpstreamError{Message: message, StatusCode: status}
}

// parallel runs one single-image call per requested image, keeping whatever
// succeeded; it returns the first error only when nothing succeeded.
func parallel(n int, call func() ([]string, error)) ([]string, error) {
	n = max(n, 1)
	results := make([][]string, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for index := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[index], errs[index] = call()
		}()
	}
	wg.Wait()
	images := make([]string, 0, n)
	var firstErr error
	for index := range n {
		images = append(images, results[index]...)
		if errs[index] != nil && firstErr == nil {
			firstErr = errs[index]
		}
	}
	if len(images) > 0 {
		return images[:min(len(images), n)], nil
	}
	return nil, firstErr
}

// dataURI turns base64 (or an existing data URI) into a data URI.
func dataURI(input string) (string, error) {
	value := strings.TrimSpace(input)
	if strings.HasPrefix(strings.ToLower(value), "data:image/") {
		return value, nil
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", &c2a.UpstreamError{Message: "参考图 Base64 数据无效", StatusCode: http.StatusBadRequest}
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return "", &c2a.UpstreamError{Message: "参考图格式无效", StatusCode: http.StatusBadRequest}
	}
	return "data:" + contentType + ";base64," + value, nil
}

// parseSize reads a WxH size; ok is false for empty/auto/invalid values.
func parseSize(size string) (width, height int, ok bool) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

// nearestAspect picks the listed W:H ratio closest to width/height.
func nearestAspect(width, height int, ratios []string) string {
	target := float64(width) / float64(height)
	best, bestDistance := "", 1e9
	for _, ratio := range ratios {
		var w, h float64
		if _, err := fmt.Sscanf(ratio, "%f:%f", &w, &h); err != nil || h == 0 {
			continue
		}
		distance := target/(w/h) + (w/h)/target
		if distance < bestDistance {
			best, bestDistance = ratio, distance
		}
	}
	return best
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

func endpoint(baseURL, apiPath, defaultPath, operation string) string {
	if strings.TrimSpace(apiPath) == "" {
		apiPath = defaultPath
	}
	return strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/" + strings.Trim(strings.TrimSpace(apiPath), "/") + operation
}
