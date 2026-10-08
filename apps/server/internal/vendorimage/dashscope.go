package vendorimage

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

const (
	// DashScopeAPIPath is the native API root under the Base URL.
	DashScopeAPIPath = "/api/v1"
	// DashScopeChatPath is the OpenAI-compatible chat root under the Base URL.
	DashScopeChatPath   = "/compatible-mode/v1"
	dashScopeGeneration = "/services/aigc/multimodal-generation/generation"
)

// DashScope calls Alibaba Model Studio's synchronous multimodal generation
// API (qwen-image, qwen-image-edit). Reference images ride in the same
// message as the prompt; results are URLs that are downloaded.
type DashScope struct {
	conn
	endpoint string
	download Downloader
}

// NewDashScope builds a client; apiPath defaults to /api/v1.
func NewDashScope(baseURL, apiPath string, headers map[string]string, timeoutSecs int, httpClient *http.Client, download Downloader) *DashScope {
	return &DashScope{
		conn:     newConn("百炼", headers, timeoutSecs, httpClient),
		endpoint: endpoint(baseURL, apiPath, DashScopeAPIPath, dashScopeGeneration),
		download: download,
	}
}

// GenerateImages implements c2a.ImageBackend. Each image is a separate call
// with n=1, since several qwen-image models only accept n=1.
func (d *DashScope) GenerateImages(ctx context.Context, prompt, model string, n int, size string, inputs []string) ([]string, error) {
	content := make([]map[string]string, 0, len(inputs)+1)
	for _, input := range inputs {
		uri, err := dataURI(input)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]string{"image": uri})
	}
	content = append(content, map[string]string{"text": prompt})
	parameters := map[string]any{"n": 1, "watermark": false}
	if width, height, ok := parseSize(size); ok {
		parameters["size"] = strconv.Itoa(width) + "*" + strconv.Itoa(height)
	}
	body := map[string]any{
		"model":      strings.TrimSpace(model),
		"input":      map[string]any{"messages": []any{map[string]any{"role": "user", "content": content}}},
		"parameters": parameters,
	}
	return parallel(n, func() ([]string, error) { return d.once(ctx, body) })
}

func (d *DashScope) once(ctx context.Context, body map[string]any) ([]string, error) {
	raw, err := d.post(ctx, d.endpoint, body, dashScopeErrorMessage)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Code   string `json:"code"`
		Output struct {
			Choices []struct {
				Message struct {
					Content []struct {
						Image string `json:"image"`
						Text  string `json:"text"`
					} `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"output"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &c2a.UpstreamError{Message: "百炼返回了无法解析的响应", StatusCode: http.StatusBadGateway}
	}
	if payload.Code != "" {
		return nil, &c2a.UpstreamError{Message: "百炼生成失败：" + payload.Code + " " + payload.Message, StatusCode: http.StatusBadGateway}
	}
	images := []string{}
	var text []string
	for _, choice := range payload.Output.Choices {
		for _, item := range choice.Message.Content {
			switch {
			case item.Image != "":
				if d.download == nil {
					return nil, &c2a.UpstreamError{Message: "百炼返回的图片无法下载", StatusCode: http.StatusBadGateway}
				}
				encoded, err := d.download(ctx, item.Image)
				if err != nil {
					return nil, err
				}
				images = append(images, encoded)
			case strings.TrimSpace(item.Text) != "":
				text = append(text, strings.TrimSpace(item.Text))
			}
		}
	}
	if len(images) == 0 {
		message := "百炼没有返回图片"
		if len(text) > 0 {
			message += "：" + truncate(strings.Join(text, " "), 200)
		}
		return nil, &c2a.UpstreamError{Message: message, StatusCode: http.StatusBadGateway}
	}
	return images, nil
}

func dashScopeErrorMessage(_ int, body []byte) string {
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &payload) == nil && (payload.Code != "" || payload.Message != "") {
		return strings.TrimSpace(payload.Code + " " + payload.Message)
	}
	return ""
}
