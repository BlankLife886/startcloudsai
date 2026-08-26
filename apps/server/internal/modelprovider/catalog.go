package modelprovider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

type CatalogResult struct {
	Models          []string
	Entries         []CatalogEntry
	CompatibleCount int
	TaskModelCount  int
	Source          string
	Warning         string
}

type CatalogEntry struct {
	ID                  string         `json:"id"`
	Kind                string         `json:"kind"`
	ModelType           string         `json:"modelType,omitempty"`
	Modality            string         `json:"modality,omitempty"`
	Operations          []string       `json:"operations,omitempty"`
	InputFields         []string       `json:"inputFields,omitempty"`
	RequiredInputFields []string       `json:"requiredInputFields,omitempty"`
	InputSchema         map[string]any `json:"inputSchema,omitempty"`
	SupportsReference   bool           `json:"supportsReference,omitempty"`
	Compatible          bool           `json:"compatible"`
	Incompatibility     string         `json:"incompatibility,omitempty"`
}

func ListModels(ctx context.Context, provider modelconfig.Provider, allowPrivate bool) ([]string, error) {
	result, err := DiscoverModels(ctx, provider, allowPrivate)
	return result.Models, err
}

func DiscoverModels(ctx context.Context, provider modelconfig.Provider, allowPrivate bool) (CatalogResult, error) {
	if strings.TrimSpace(provider.APIKey) == "" {
		return CatalogResult{}, errors.New("API Key 未配置")
	}
	if provider.Adapter == modelconfig.AdapterCRUN {
		return discoverCRUNModels(ctx, provider, allowPrivate)
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
	entries := make([]CatalogEntry, 0, len(models))
	for _, id := range models {
		entries = append(entries, CatalogEntry{ID: id, Compatible: true})
	}
	result := CatalogResult{Models: models, Entries: entries, CompatibleCount: compatibleCount, Source: "compatible"}
	sort.Strings(result.Models)
	return result, nil
}

type crunCatalogEntry struct {
	Model               string         `json:"model"`
	ModelType           string         `json:"model_type"`
	Modality            string         `json:"modality"`
	Operations          []string       `json:"operations"`
	InputFields         []string       `json:"input_fields"`
	RequiredInputFields []string       `json:"required_input_fields"`
	SupportsReference   bool           `json:"supports_reference"`
	InputSchema         map[string]any `json:"input_schema"`
}

func discoverCRUNModels(ctx context.Context, provider modelconfig.Provider, allowPrivate bool) (CatalogResult, error) {
	mediaEndpoint, err := crunTaskModelsEndpoint(provider.BaseURL)
	if err != nil {
		return CatalogResult{}, err
	}
	mediaBody, err := fetchCatalog(ctx, mediaEndpoint, provider.APIKey, true, provider.TimeoutSecs, allowPrivate)
	if err != nil {
		return CatalogResult{}, fmt.Errorf("读取 CRUN 媒体模型失败：%w", err)
	}
	var mediaPayload struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Models []crunCatalogEntry `json:"models"`
		} `json:"data"`
	}
	if err := json.Unmarshal(mediaBody, &mediaPayload); err != nil {
		return CatalogResult{}, fmt.Errorf("CRUN 媒体模型响应不是有效 JSON：%w", err)
	}
	if mediaPayload.Code != http.StatusOK {
		return CatalogResult{}, fmt.Errorf("CRUN 媒体模型响应失败（code=%d）：%s", mediaPayload.Code, mediaPayload.Message)
	}

	llmEndpoint, err := crunModelsEndpoint(provider.BaseURL)
	if err != nil {
		return CatalogResult{}, err
	}
	llmBody, err := fetchCatalog(ctx, llmEndpoint, provider.APIKey, false, provider.TimeoutSecs, allowPrivate)
	if err != nil {
		return CatalogResult{}, fmt.Errorf("读取 CRUN 对话模型失败：%w", err)
	}
	var llmPayload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(llmBody, &llmPayload); err != nil {
		return CatalogResult{}, fmt.Errorf("CRUN 对话模型响应不是有效 JSON：%w", err)
	}

	entriesByID := make(map[string]CatalogEntry, len(mediaPayload.Data.Models)+len(llmPayload.Data))
	for _, raw := range mediaPayload.Data.Models {
		entry := catalogEntryFromCRUN(raw)
		if entry.ID != "" {
			entriesByID[entry.ID] = entry
		}
	}
	for _, raw := range llmPayload.Data {
		id := strings.TrimSpace(raw.ID)
		if id == "" {
			continue
		}
		if _, exists := entriesByID[id]; exists {
			continue
		}
		entriesByID[id] = CatalogEntry{
			ID: id, Kind: modelconfig.ModelKindChat, ModelType: "llm", Modality: "text", Compatible: true,
		}
	}

	entries := make([]CatalogEntry, 0, len(entriesByID))
	models := make([]string, 0, len(entriesByID))
	for _, entry := range entriesByID {
		entries = append(entries, entry)
		if entry.Compatible {
			models = append(models, entry.ID)
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	sort.Strings(models)
	warning := ""
	if len(mediaPayload.Data.Models) > 0 && len(models) < len(entries) {
		warning = fmt.Sprintf(
			"CRUN 返回 %d 个媒体任务模型和 %d 个对话模型；当前业务可配置 %d 个。普通视频/音频生成模型仍保持隔离，媒体工具按实时 schema 接入。",
			len(mediaPayload.Data.Models), len(llmPayload.Data), len(models),
		)
	}
	return CatalogResult{
		Models: models, Entries: entries, CompatibleCount: len(models),
		TaskModelCount: len(mediaPayload.Data.Models), Source: "crun-live-catalog", Warning: warning,
	}, nil
}

func catalogEntryFromCRUN(raw crunCatalogEntry) CatalogEntry {
	entry := CatalogEntry{
		ID: strings.TrimSpace(raw.Model), ModelType: strings.TrimSpace(raw.ModelType),
		Modality: strings.TrimSpace(raw.Modality), Operations: cleanCatalogStrings(raw.Operations),
		InputFields: cleanCatalogStrings(raw.InputFields), RequiredInputFields: cleanCatalogStrings(raw.RequiredInputFields),
		InputSchema: raw.InputSchema, SupportsReference: raw.SupportsReference,
	}
	operations := make(map[string]bool, len(entry.Operations))
	for _, operation := range entry.Operations {
		operations[operation] = true
	}
	switch {
	case entry.ModelType == "tools" && len(entry.Operations) > 0 && len(entry.InputFields) > 0:
		entry.Kind, entry.Compatible = modelconfig.ModelKindImageTool, true
	case entry.Modality == "image" && entry.ModelType == "image" && (operations["text-to-image"] || operations["image-edit"]):
		entry.Kind, entry.Compatible = modelconfig.ModelKindImage, true
	default:
		entry.Incompatibility = "当前业务工作流尚未接入该模型能力"
	}
	return entry
}

func DescribeCRUNModel(ctx context.Context, provider modelconfig.Provider, model string, allowPrivate bool) (CatalogEntry, error) {
	if provider.Adapter != modelconfig.AdapterCRUN {
		return CatalogEntry{}, errors.New("模型参数读取仅适用于 CRUN 服务商")
	}
	if strings.TrimSpace(provider.APIKey) == "" {
		return CatalogEntry{}, errors.New("API Key 未配置")
	}
	endpoint, err := crunTaskModelEndpoint(provider.BaseURL, model)
	if err != nil {
		return CatalogEntry{}, err
	}
	body, err := fetchCatalog(ctx, endpoint, provider.APIKey, true, provider.TimeoutSecs, allowPrivate)
	if err != nil {
		return CatalogEntry{}, err
	}
	var payload struct {
		Code    int              `json:"code"`
		Message string           `json:"message"`
		Data    crunCatalogEntry `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return CatalogEntry{}, fmt.Errorf("CRUN 模型参数响应不是有效 JSON：%w", err)
	}
	if payload.Code != http.StatusOK {
		return CatalogEntry{}, fmt.Errorf("CRUN 模型参数响应失败（code=%d）：%s", payload.Code, payload.Message)
	}
	entry := catalogEntryFromCRUN(payload.Data)
	if entry.ID == "" {
		return CatalogEntry{}, errors.New("CRUN 模型参数响应缺少模型 ID")
	}
	return entry, nil
}

func fetchCatalog(ctx context.Context, endpoint, apiKey string, xAPIKey bool, timeoutSecs int, allowPrivate bool) ([]byte, error) {
	timeout := 20 * time.Second
	if timeoutSecs > 0 && timeoutSecs < 20 {
		timeout = time.Duration(timeoutSecs) * time.Second
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if xAPIKey {
		req.Header.Set("x-api-key", apiKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := netguard.NewHTTPClient(timeout, allowPrivate, false).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if runes := []rune(message); len(runes) > 500 {
			message = string(runes[:500])
		}
		if message == "" {
			message = http.StatusText(resp.StatusCode)
		}
		return nil, fmt.Errorf("HTTP %d：%s", resp.StatusCode, message)
	}
	return body, nil
}

func cleanCatalogStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
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

func crunTaskModelsEndpoint(baseURL string) (string, error) {
	base, err := parseBaseURL(baseURL)
	if err != nil {
		return "", err
	}
	path := strings.TrimRight(base.Path, "/")
	path = strings.TrimSuffix(path, "/api/v1/models")
	path = strings.TrimSuffix(path, "/api/v1")
	base.Path = strings.TrimRight(path, "/") + "/api/v1/client/job/Models"
	return cleanURL(base), nil
}

func crunTaskModelEndpoint(baseURL, model string) (string, error) {
	model = strings.Trim(strings.TrimSpace(model), "/")
	if model == "" {
		return "", errors.New("CRUN 模型 ID 不能为空")
	}
	endpoint, err := crunTaskModelsEndpoint(baseURL)
	if err != nil {
		return "", err
	}
	parts := strings.Split(model, "/")
	for index := range parts {
		parts[index] = url.PathEscape(parts[index])
	}
	return endpoint + "/" + strings.Join(parts, "/"), nil
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
