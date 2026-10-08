// Package gemini speaks Google's native Generative Language API for image
// generation: Gemini image models via :generateContent and Imagen via
// :predict. Chat goes through Gemini's OpenAI-compatible endpoint instead.
package gemini

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
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/upstreamguard"
)

const (
	// DefaultAPIPath is the API version root under the Base URL.
	DefaultAPIPath   = "/v1beta"
	maxResponseBytes = 64 << 20
	// maxImagesPerCall bounds Imagen's sampleCount.
	maxImagesPerCall = 4
)

// Client calls one Gemini route. Headers carry the API key.
type Client struct {
	baseURL string
	apiPath string
	headers map[string]string
	http    *http.Client
	timeout time.Duration
	// imageResponse is where the upstream puts generated images; see
	// modelconfig.ImageResponse*. Empty means inlineData (official API).
	imageResponse string
	// download fetches an image URL as base64 (ImageResponseTextURL).
	download func(ctx context.Context, rawURL string) (string, error)
}

// New builds a client; apiPath defaults to /v1beta. httpClient may wrap a
// transport (e.g. request compat rules); nil uses a fresh client.
func New(baseURL, apiPath string, headers map[string]string, timeoutSecs int, httpClient *http.Client) *Client {
	if strings.TrimSpace(apiPath) == "" {
		apiPath = DefaultAPIPath
	}
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	timeout := time.Duration(timeoutSecs) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		apiPath: "/" + strings.Trim(strings.TrimSpace(apiPath), "/"),
		headers: headers, http: httpClient, timeout: timeout,
	}
}

// WithImageResponse sets where the upstream puts generated images, as chosen
// by the admin. download is required for modelconfig.ImageResponseTextURL.
func (c *Client) WithImageResponse(mode string, download func(ctx context.Context, rawURL string) (string, error)) *Client {
	clone := *c
	clone.imageResponse = mode
	clone.download = download
	return &clone
}

// IsImagen reports whether a model uses Imagen's :predict API.
func IsImagen(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimPrefix(model, "models/")), "imagen")
}

// GenerateImages produces n images and returns them base64-encoded. inputs
// are base64 reference images (Gemini image models only). size is WxH or an
// empty/"auto" value meaning "let the model choose".
func (c *Client) GenerateImages(ctx context.Context, prompt, model string, n int, size string, inputs []string) ([]string, error) {
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	if model == "" {
		return nil, &c2a.UpstreamError{Message: "未配置 Gemini 模型", StatusCode: http.StatusBadRequest}
	}
	n = max(n, 1)
	aspect, tier := sizeSpec(size)
	if IsImagen(model) {
		if len(inputs) > 0 {
			return nil, &c2a.UpstreamError{Message: "Imagen 模型不支持参考图，请改用 Gemini 图片模型", StatusCode: http.StatusBadRequest}
		}
		return c.imagen(ctx, prompt, model, n, aspect, tier)
	}
	// Gemini image models return one image per call; run calls in parallel.
	results := make([][]string, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for index := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[index], errs[index] = c.generateContent(ctx, prompt, model, aspect, tier, inputs)
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
		if len(images) > n {
			images = images[:n]
		}
		return images, nil
	}
	return nil, firstErr
}

func (c *Client) endpoint(model, method string) string {
	return c.baseURL + c.apiPath + "/models/" + url.PathEscape(model) + ":" + method
}

type inlineData struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

type part struct {
	Text       string      `json:"text,omitempty"`
	InlineData *inlineData `json:"inlineData,omitempty"`
	Thought    bool        `json:"thought,omitempty"`
}

func (c *Client) generateContent(ctx context.Context, prompt, model, aspect, tier string, inputs []string) ([]string, error) {
	parts := []part{{Text: prompt}}
	for _, encoded := range inputs {
		parts = append(parts, part{InlineData: &inlineData{MimeType: sniffMime(encoded), Data: encoded}})
	}
	generation := map[string]any{"responseModalities": []string{"TEXT", "IMAGE"}}
	imageConfig := map[string]any{}
	if aspect != "" {
		imageConfig["aspectRatio"] = aspect
	}
	if tier != "" && tier != "1K" {
		imageConfig["imageSize"] = tier
	}
	if len(imageConfig) > 0 {
		generation["imageConfig"] = imageConfig
	}
	body := map[string]any{
		"contents":         []any{map[string]any{"role": "user", "parts": parts}},
		"generationConfig": generation,
	}
	raw, err := c.post(ctx, c.endpoint(model, "generateContent"), body)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Candidates []struct {
			Content struct {
				Parts []part `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &c2a.UpstreamError{Message: "Gemini 返回了无法解析的响应", StatusCode: http.StatusBadGateway}
	}
	if reason := payload.PromptFeedback.BlockReason; reason != "" {
		return nil, &c2a.UpstreamError{Message: "Gemini 拒绝了该提示词（" + reason + "）", StatusCode: http.StatusBadRequest}
	}
	images := []string{}
	var text []string
	finish := ""
	for _, candidate := range payload.Candidates {
		finish = candidate.FinishReason
		for _, item := range candidate.Content.Parts {
			if item.Thought {
				continue
			}
			if c.imageResponse == modelconfig.ImageResponseInlineData && item.InlineData != nil &&
				strings.HasPrefix(item.InlineData.MimeType, "image/") && item.InlineData.Data != "" {
				images = append(images, item.InlineData.Data)
			} else if strings.TrimSpace(item.Text) != "" {
				text = append(text, strings.TrimSpace(item.Text))
			}
		}
	}
	switch c.imageResponse {
	case modelconfig.ImageResponseTextURL:
		for _, link := range imageLinks(text) {
			if c.download == nil {
				break
			}
			encoded, err := c.download(ctx, link)
			if err != nil {
				return nil, err
			}
			images = append(images, encoded)
		}
	case modelconfig.ImageResponseTextDataURI:
		images = append(images, dataURIImages(text)...)
	}
	if len(images) == 0 {
		message := "Gemini 没有返回图片（图片返回方式：" + imageResponseLabel(c.imageResponse) + "）"
		if finish != "" && finish != "STOP" {
			message += "（" + finish + "）"
		}
		if len(text) > 0 {
			message += "：" + truncate(strings.Join(text, " "), 200)
		}
		return nil, &c2a.UpstreamError{Message: message, StatusCode: http.StatusBadGateway}
	}
	return images, nil
}

func (c *Client) imagen(ctx context.Context, prompt, model string, n int, aspect, tier string) ([]string, error) {
	images := []string{}
	for remaining := n; remaining > 0; remaining -= maxImagesPerCall {
		count := min(remaining, maxImagesPerCall)
		parameters := map[string]any{"sampleCount": count}
		if aspect != "" {
			parameters["aspectRatio"] = imagenAspect(aspect)
		}
		if tier == "2K" {
			parameters["sampleImageSize"] = "2K"
		}
		raw, err := c.post(ctx, c.endpoint(model, "predict"), map[string]any{
			"instances":  []any{map[string]any{"prompt": prompt}},
			"parameters": parameters,
		})
		if err != nil {
			if len(images) > 0 {
				return images, nil
			}
			return nil, err
		}
		var payload struct {
			Predictions []struct {
				BytesBase64Encoded string `json:"bytesBase64Encoded"`
				RaiFilteredReason  string `json:"raiFilteredReason"`
			} `json:"predictions"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, &c2a.UpstreamError{Message: "Imagen 返回了无法解析的响应", StatusCode: http.StatusBadGateway}
		}
		filtered := ""
		for _, prediction := range payload.Predictions {
			if prediction.BytesBase64Encoded != "" {
				images = append(images, prediction.BytesBase64Encoded)
			} else if prediction.RaiFilteredReason != "" {
				filtered = prediction.RaiFilteredReason
			}
		}
		if len(images) == 0 {
			message := "Imagen 没有返回图片"
			if filtered != "" {
				message += "：" + truncate(filtered, 200)
			}
			return nil, &c2a.UpstreamError{Message: message, StatusCode: http.StatusBadGateway}
		}
	}
	return images, nil
}

func (c *Client) post(ctx context.Context, endpoint string, body any) ([]byte, error) {
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
		// The request may have reached Google; a blind retry could bill twice.
		return nil, &c2a.SynchronousImageError{Err: &c2a.NetworkError{Message: "连接 Gemini 失败：" + err.Error(), Err: err}}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, &c2a.SynchronousImageError{Err: &c2a.NetworkError{Message: "读取 Gemini 响应失败：" + err.Error(), Err: err}}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, decodeError(resp.StatusCode, data)
	}
	return data, nil
}

func decodeError(status int, body []byte) error {
	var payload struct {
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	message := strings.TrimSpace(string(body))
	if json.Unmarshal(body, &payload) == nil && payload.Error.Message != "" {
		message = payload.Error.Message
		if payload.Error.Status != "" {
			message = payload.Error.Status + ": " + message
		}
	}
	if message == "" {
		message = http.StatusText(status)
	}
	message = "Gemini 请求失败（HTTP " + strconv.Itoa(status) + "）：" + truncate(message, 400)
	if status == http.StatusTooManyRequests || status >= 500 {
		return &c2a.NetworkError{Message: message, Err: errors.New(message)}
	}
	return &c2a.UpstreamError{Message: message, StatusCode: status}
}

// geminiAspects are the ratios Gemini image models accept.
var geminiAspects = []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}

// sizeSpec maps a WxH request size to Gemini's aspect ratio and size tier.
func sizeSpec(size string) (string, string) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return "", ""
	}
	width, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return "", ""
	}
	target := float64(width) / float64(height)
	best, bestDistance := "", 1e9
	for _, ratio := range geminiAspects {
		var w, h float64
		_, _ = fmt.Sscanf(ratio, "%f:%f", &w, &h)
		distance := target/(w/h) + (w/h)/target
		if distance < bestDistance {
			best, bestDistance = ratio, distance
		}
	}
	tier := "1K"
	switch edge := max(width, height); {
	case edge > 3072:
		tier = "4K"
	case edge > 1536:
		tier = "2K"
	}
	return best, tier
}

// imagenAspect narrows a ratio to the set Imagen accepts.
func imagenAspect(aspect string) string {
	switch aspect {
	case "1:1", "3:4", "4:3", "9:16", "16:9":
		return aspect
	case "2:3", "4:5":
		return "3:4"
	case "3:2", "5:4":
		return "4:3"
	case "21:9":
		return "16:9"
	default:
		return "1:1"
	}
}

func sniffMime(encoded string) string {
	head := encoded
	if len(head) > 24 {
		head = head[:24]
	}
	data, _ := base64.StdEncoding.DecodeString(head[:len(head)/4*4])
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG")):
		return "image/png"
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("RIFF")):
		return "image/webp"
	case bytes.HasPrefix(data, []byte("GIF8")):
		return "image/gif"
	default:
		return "image/png"
	}
}

var dataURIPattern = regexp.MustCompile(`data:image/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)`)

// dataURIImages pulls base64 payloads out of data:image URIs in text parts.
func dataURIImages(text []string) []string {
	images := []string{}
	for _, item := range text {
		for _, match := range dataURIPattern.FindAllStringSubmatch(item, -1) {
			images = append(images, match[1])
		}
	}
	return images
}

func imageResponseLabel(mode string) string {
	switch mode {
	case modelconfig.ImageResponseTextURL:
		return "文本里的图片链接"
	case modelconfig.ImageResponseTextDataURI:
		return "文本里的 base64 图片"
	default:
		return "原生 inlineData"
	}
}

var imageLinkPattern = regexp.MustCompile(`https?://[^\s)\]"'<>]+`)

// imageLinks pulls http(s) links out of text parts, whether bare or wrapped
// in Markdown image syntax.
func imageLinks(text []string) []string {
	links := []string{}
	seen := map[string]bool{}
	for _, item := range text {
		for _, link := range imageLinkPattern.FindAllString(item, -1) {
			link = strings.TrimRight(link, ".,;")
			if !seen[link] {
				seen[link] = true
				links = append(links, link)
			}
		}
	}
	return links
}

func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
