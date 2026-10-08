package vendorimage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
)

const (
	// MiniMaxAPIPath is the API root under the Base URL, shared with chat.
	MiniMaxAPIPath  = "/v1"
	miniMaxGenerate = "/image_generation"
	// miniMaxMaxImages is the documented n limit per request.
	miniMaxMaxImages = 9
)

// miniMaxAspects are the documented aspect_ratio presets.
var miniMaxAspects = []string{"1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"}

// MiniMax calls MiniMax's image_generation API (image-01). Reference images
// are sent as character subject references, the only kind it supports.
type MiniMax struct {
	conn
	endpoint string
}

// NewMiniMax builds a client; apiPath defaults to /v1.
func NewMiniMax(baseURL, apiPath string, headers map[string]string, timeoutSecs int, httpClient *http.Client) *MiniMax {
	return &MiniMax{
		conn:     newConn("MiniMax", headers, timeoutSecs, httpClient),
		endpoint: endpoint(baseURL, apiPath, MiniMaxAPIPath, miniMaxGenerate),
	}
}

// GenerateImages implements c2a.ImageBackend.
func (m *MiniMax) GenerateImages(ctx context.Context, prompt, model string, n int, size string, inputs []string) ([]string, error) {
	body := map[string]any{
		"model":           strings.TrimSpace(model),
		"prompt":          prompt,
		"n":               min(max(n, 1), miniMaxMaxImages),
		"response_format": "base64",
	}
	if width, height, ok := parseSize(size); ok {
		body["aspect_ratio"] = nearestAspect(width, height, miniMaxAspects)
	}
	if len(inputs) > 0 {
		references := make([]map[string]string, 0, len(inputs))
		for _, input := range inputs {
			uri, err := dataURI(input)
			if err != nil {
				return nil, err
			}
			references = append(references, map[string]string{"type": "character", "image_file": uri})
		}
		body["subject_reference"] = references
	}
	raw, err := m.post(ctx, m.endpoint, body, miniMaxErrorMessage)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data struct {
			ImageBase64 []string `json:"image_base64"`
		} `json:"data"`
		Metadata struct {
			FailedCount any `json:"failed_count"`
		} `json:"metadata"`
		BaseResp miniMaxBaseResp `json:"base_resp"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &c2a.UpstreamError{Message: "MiniMax 返回了无法解析的响应", StatusCode: http.StatusBadGateway}
	}
	if err := payload.BaseResp.err(); err != nil {
		return nil, err
	}
	images := make([]string, 0, len(payload.Data.ImageBase64))
	for _, image := range payload.Data.ImageBase64 {
		if strings.TrimSpace(image) != "" {
			images = append(images, image)
		}
	}
	if len(images) == 0 {
		message := "MiniMax 没有返回图片"
		if failed := fmt.Sprint(payload.Metadata.FailedCount); failed != "" && failed != "0" && failed != "<nil>" {
			message += "（" + failed + " 张被内容安全拦截）"
		}
		return nil, &c2a.UpstreamError{Message: message, StatusCode: http.StatusBadGateway}
	}
	return images, nil
}

type miniMaxBaseResp struct {
	StatusCode any    `json:"status_code"`
	StatusMsg  string `json:"status_msg"`
}

// err maps MiniMax's in-body status (HTTP is 200 even on failure).
func (r miniMaxBaseResp) err() error {
	code := fmt.Sprint(r.StatusCode)
	if code == "" || code == "0" || code == "<nil>" {
		return nil
	}
	message := "MiniMax 生成失败（" + code + "）：" + r.StatusMsg
	switch code {
	case "1002": // rate limited
		return &c2a.NetworkError{Message: message, Err: fmt.Errorf("%s", message)}
	case "1004", "2049": // auth
		return &c2a.UpstreamError{Message: message, StatusCode: http.StatusUnauthorized}
	default:
		return &c2a.UpstreamError{Message: message, StatusCode: http.StatusBadRequest}
	}
}

func miniMaxErrorMessage(_ int, body []byte) string {
	var payload struct {
		BaseResp miniMaxBaseResp `json:"base_resp"`
	}
	if json.Unmarshal(body, &payload) == nil && payload.BaseResp.StatusMsg != "" {
		return fmt.Sprint(payload.BaseResp.StatusCode) + " " + payload.BaseResp.StatusMsg
	}
	return ""
}
