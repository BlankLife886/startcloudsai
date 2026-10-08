package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	_ "golang.org/x/image/webp"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

// runRawImageProbe sends each JSON body as-is to the provider's standard
// /images/generations endpoint (no compat rules) and reports what came back:
// status, billed cost when the vendor returns it, MIME type and the real pixel
// size. It is for checking which vendor parameters actually take effect. The
// API key is read from the stored configuration and never printed.
func runRawImageProbe(provider modelconfig.Provider, rawBodies string, allowPrivate bool) error {
	var bodies []map[string]any
	if err := json.Unmarshal([]byte(rawBodies), &bodies); err != nil {
		return fmt.Errorf("-raw-image 需要 JSON 数组：%w", err)
	}
	apiPath := provider.APIPath
	if apiPath == "" {
		apiPath = "/v1"
	}
	endpoint := strings.TrimRight(provider.BaseURL, "/") + apiPath + "/images/generations"
	headers := modelconfig.AuthHeaders(modelconfig.AuthStyleFor(provider), provider.APIKey)
	client := netguard.NewHTTPClient(5*time.Minute, allowPrivate, false)
	lines := make([]string, len(bodies))
	var wg sync.WaitGroup
	for index, body := range bodies {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lines[index] = rawImageCall(client, endpoint, headers, body)
		}()
	}
	wg.Wait()
	fmt.Printf("服务商：%s（%s）· %s\n\n", provider.Name, provider.ID, endpoint)
	for _, line := range lines {
		fmt.Println(line)
	}
	return nil
}

func rawImageCall(client *http.Client, endpoint string, headers map[string]string, body map[string]any) string {
	sent, _ := json.Marshal(body)
	label := string(sent)
	if prompt, ok := body["prompt"].(string); ok {
		short, _ := json.Marshal(withoutKey(body, "prompt"))
		label = string(short) + fmt.Sprintf(" (prompt %d 字)", len([]rune(prompt)))
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(sent))
	if err != nil {
		return label + "\n  ✕ " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	started := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return label + "\n  ✕ 请求失败：" + err.Error()
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	elapsed := time.Since(started).Seconds()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Sprintf("%s\n  ✕ HTTP %d %.1fs：%s", label, resp.StatusCode, elapsed, strings.TrimSpace(string(raw)))
	}
	var payload struct {
		Data []struct {
			B64JSON  string `json:"b64_json"`
			URL      string `json:"url"`
			MimeType string `json:"mime_type"`
		} `json:"data"`
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fmt.Sprintf("%s\n  ✕ 响应不是 JSON：%.200s", label, raw)
	}
	parts := []string{fmt.Sprintf("  ✓ %.1fs · %d 张", elapsed, len(payload.Data))}
	if ticks, ok := payload.Usage["cost_in_usd_ticks"].(float64); ok {
		parts = append(parts, fmt.Sprintf("扣费 $%.4f", ticks/1e10))
	}
	for _, item := range payload.Data {
		data, err := imageBytes(client, item.B64JSON, item.URL)
		if err != nil {
			parts = append(parts, "图片读取失败："+err.Error())
			continue
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			parts = append(parts, fmt.Sprintf("%s %d KB（无法解析尺寸）", item.MimeType, len(data)/1024))
			continue
		}
		parts = append(parts, fmt.Sprintf("%dx%d %s（mime=%s）%d KB", config.Width, config.Height, format, item.MimeType, len(data)/1024))
	}
	return label + "\n" + strings.Join(parts, " · ")
}

func imageBytes(client *http.Client, b64, rawURL string) ([]byte, error) {
	if b64 != "" {
		return base64.StdEncoding.DecodeString(b64)
	}
	if rawURL == "" {
		return nil, fmt.Errorf("没有图片数据")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, 64<<20))
}

func withoutKey(body map[string]any, key string) map[string]any {
	out := make(map[string]any, len(body))
	for k, v := range body {
		if k != key {
			out[k] = v
		}
	}
	return out
}
