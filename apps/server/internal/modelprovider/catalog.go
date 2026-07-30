package modelprovider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

const (
	crunPublicCatalogURL = "https://crun.ai/models"
	maxCatalogBodyBytes  = 8 << 20
)

var (
	crunScriptPattern        = regexp.MustCompile(`/static/[A-Za-z0-9_-]+\.js`)
	crunRegistryEntryPattern = regexp.MustCompile(`(?:^|[,{])([A-Za-z0-9_]+):("(?:\\.|[^"\\])*")`)
	crunModelIDPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$`)
)

type CatalogResult struct {
	Models          []string
	CompatibleCount int
	TaskModelCount  int
	Source          string
	Warning         string
}

func ListModels(ctx context.Context, provider modelconfig.Provider, allowPrivate bool) ([]string, error) {
	result, err := DiscoverModels(ctx, provider, allowPrivate)
	return result.Models, err
}

func DiscoverModels(ctx context.Context, provider modelconfig.Provider, allowPrivate bool) (CatalogResult, error) {
	if strings.TrimSpace(provider.APIKey) == "" {
		return CatalogResult{}, errors.New("API Key 未配置")
	}
	endpoint, err := providerModelsEndpoint(provider)
	if err != nil {
		return CatalogResult{}, err
	}
	timeout := 20 * time.Second
	if provider.TimeoutSecs > 0 && provider.TimeoutSecs < 20 {
		timeout = time.Duration(provider.TimeoutSecs) * time.Second
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return CatalogResult{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+provider.APIKey)
	if provider.Adapter == modelconfig.AdapterCRUN {
		req.Header.Set("x-api-key", provider.APIKey)
	}
	client := netguard.NewHTTPClient(timeout, allowPrivate, false)
	resp, err := client.Do(req)
	if err != nil {
		return CatalogResult{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return CatalogResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if runes := []rune(message); len(runes) > 500 {
			message = string(runes[:500])
		}
		if message == "" {
			message = http.StatusText(resp.StatusCode)
		}
		return CatalogResult{}, fmt.Errorf("读取模型失败（HTTP %d）：%s", resp.StatusCode, message)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			ID string `json:"id"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return CatalogResult{}, fmt.Errorf("模型列表响应不是有效 JSON：%w", err)
	}
	seen := map[string]bool{}
	models := make([]string, 0, len(payload.Data)+len(payload.Models))
	for _, list := range [][]struct {
		ID string `json:"id"`
	}{payload.Data, payload.Models} {
		for _, item := range list {
			id := strings.TrimSpace(item.ID)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			models = append(models, id)
		}
	}
	compatibleCount := len(models)
	result := CatalogResult{Models: models, CompatibleCount: compatibleCount, Source: "compatible"}
	if provider.Adapter == modelconfig.AdapterCRUN {
		taskModels, catalogErr := listCRUNTaskModels(ctx, client)
		if catalogErr != nil {
			result.Warning = "CRUN 全量任务模型目录读取失败，当前仅显示兼容模型：" + catalogErr.Error()
		} else {
			result.TaskModelCount = len(taskModels)
			result.Source = "crun_full"
			for _, modelID := range taskModels {
				if seen[modelID] {
					continue
				}
				seen[modelID] = true
				result.Models = append(result.Models, modelID)
			}
		}
	}
	sort.Strings(result.Models)
	return result, nil
}

func listCRUNTaskModels(ctx context.Context, client *http.Client) ([]string, error) {
	page, err := fetchCatalogBody(ctx, client, crunPublicCatalogURL)
	if err != nil {
		return nil, fmt.Errorf("读取 CRUN 模型页：%w", err)
	}
	scriptPaths := crunScriptPattern.FindAllString(string(page), -1)
	seenScripts := map[string]bool{}
	var parseErr error
	for _, scriptPath := range scriptPaths {
		if seenScripts[scriptPath] {
			continue
		}
		seenScripts[scriptPath] = true
		scriptURL, err := url.Parse(scriptPath)
		if err != nil {
			continue
		}
		base, _ := url.Parse(crunPublicCatalogURL)
		script, err := fetchCatalogBody(ctx, client, base.ResolveReference(scriptURL).String())
		if err != nil {
			parseErr = err
			continue
		}
		models, err := parseCRUNTaskModelRegistry(string(script))
		if err == nil {
			return models, nil
		}
		parseErr = err
	}
	if parseErr != nil {
		return nil, parseErr
	}
	return nil, errors.New("CRUN 模型页未包含任务模型注册表")
}

func fetchCatalogBody(ctx context.Context, client *http.Client, endpoint string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/html,application/javascript")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogBodyBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxCatalogBodyBytes {
		return nil, errors.New("响应体过大")
	}
	return body, nil
}

func parseCRUNTaskModelRegistry(source string) ([]string, error) {
	anchor := -1
	for _, marker := range []string{
		`nano_banana:"google/nano-banana"`,
		`gpt_image_2:"openai/gpt-image-2"`,
	} {
		if anchor = strings.Index(source, marker); anchor >= 0 {
			break
		}
	}
	if anchor < 0 {
		return nil, errors.New("未找到 CRUN 任务模型注册表标记")
	}
	start := strings.LastIndex(source[:anchor], "={")
	if start < 0 {
		return nil, errors.New("CRUN 任务模型注册表格式无效")
	}
	start++
	end := matchingObjectEnd(source, start)
	if end <= start {
		return nil, errors.New("CRUN 任务模型注册表未闭合")
	}
	seen := map[string]bool{}
	models := make([]string, 0, 200)
	for _, match := range crunRegistryEntryPattern.FindAllStringSubmatch(source[start:end], -1) {
		modelID, err := strconv.Unquote(match[2])
		if err != nil || !crunModelIDPattern.MatchString(modelID) || seen[modelID] {
			continue
		}
		seen[modelID] = true
		models = append(models, modelID)
	}
	if len(models) < 50 {
		return nil, fmt.Errorf("CRUN 任务模型注册表数量异常：%d", len(models))
	}
	sort.Strings(models)
	return models, nil
}

func matchingObjectEnd(source string, start int) int {
	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(source); index++ {
		char := source[index]
		if inString {
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			continue
		}
		switch char {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return index + 1
			}
		}
	}
	return -1
}

func providerModelsEndpoint(provider modelconfig.Provider) (string, error) {
	if provider.Adapter == modelconfig.AdapterCRUN {
		return crunModelsEndpoint(provider.BaseURL)
	}
	return modelsEndpoint(provider.BaseURL)
}

func crunModelsEndpoint(baseURL string) (string, error) {
	base, err := parseBaseURL(baseURL)
	if err != nil {
		return "", err
	}
	path := strings.TrimRight(base.Path, "/")
	switch {
	case strings.HasSuffix(path, "/api/v1/models"):
		base.Path = path
	case strings.HasSuffix(path, "/api/v1"):
		base.Path = path + "/models"
	default:
		base.Path = path + "/api/v1/models"
	}
	return cleanURL(base), nil
}

func modelsEndpoint(baseURL string) (string, error) {
	base, err := parseBaseURL(baseURL)
	if err != nil {
		return "", err
	}
	path := strings.TrimRight(base.Path, "/")
	if strings.HasSuffix(path, "/v1") {
		base.Path = path + "/models"
	} else {
		base.Path = path + "/v1/models"
	}
	return cleanURL(base), nil
}

func parseBaseURL(baseURL string) (*url.URL, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" || base.User != nil {
		return nil, errors.New("Base URL 无效")
	}
	return base, nil
}

func cleanURL(base *url.URL) string {
	base.RawQuery = ""
	base.Fragment = ""
	return base.String()
}
