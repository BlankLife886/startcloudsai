// Package providerclient builds upstream clients for an admin-configured
// model provider route, applying its API path, auth style and request
// compatibility rules in one place so every call site talks to a vendor the
// same way.
package providerclient

import (
	"errors"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/gemini"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/upstreamcompat"
	"github.com/BlankLife886/startcloudsai/server/internal/vendorimage"
)

// Image returns an OpenAI-compatible image client for the route. Providers
// marked ImageAPIStandard only use the public Images endpoints.
func Image(provider modelconfig.Provider, compat *modelconfig.RequestCompat, allowPrivate bool) *c2a.Client {
	switch provider.Adapter {
	case modelconfig.AdapterGemini:
		return geminiImage(provider, compat, allowPrivate)
	case modelconfig.AdapterDashScope, modelconfig.AdapterMiniMax:
		return vendorImage(provider, compat, allowPrivate)
	}
	client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, provider.TimeoutSecs, allowPrivate).
		WithAPIPrefix(provider.APIPath).
		WithTransportWrapper(upstreamcompat.Wrapper(compat))
	if style := modelconfig.AuthStyleFor(provider); style != modelconfig.AuthBearer {
		client = client.WithAuthHeaders(modelconfig.AuthHeaders(style, provider.APIKey))
	}
	if StandardImages(provider) {
		client = client.WithStandardImages()
		if compat != nil && compat.ImageEdit != "" {
			client = client.WithImageEditFormat(compat.ImageEdit)
		}
	}
	return client
}

// TaskImage is Image for generation work: chatgpt2api-style providers use the
// recoverable async task protocol, standard providers the public endpoints.
func TaskImage(provider modelconfig.Provider, compat *modelconfig.RequestCompat, allowPrivate bool) *c2a.Client {
	client := Image(provider, compat, allowPrivate)
	if StandardImages(provider) {
		return client
	}
	return client.WithAsyncImageEdits()
}

// StandardImages reports whether the provider only speaks the public OpenAI
// Images API (no chatgpt2api task protocol to probe).
func StandardImages(provider modelconfig.Provider) bool {
	return provider.ImageAPI == modelconfig.ImageAPIStandard || NativeImages(provider)
}

// NativeImages reports whether images go through a vendor-native backend
// (Gemini, DashScope, MiniMax) behind the c2a client.
func NativeImages(provider modelconfig.Provider) bool {
	switch provider.Adapter {
	case modelconfig.AdapterGemini, modelconfig.AdapterDashScope, modelconfig.AdapterMiniMax:
		return true
	}
	return false
}

// vendorImage wires a DashScope or MiniMax native image API behind the c2a
// client, like geminiImage.
func vendorImage(provider modelconfig.Provider, compat *modelconfig.RequestCompat, allowPrivate bool) *c2a.Client {
	httpClient := netguard.NewHTTPClient(0, allowPrivate, false)
	if wrap := upstreamcompat.Wrapper(compat); wrap != nil {
		wrapped := *httpClient
		wrapped.Transport = wrap(httpClient.Transport)
		httpClient = &wrapped
	}
	client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, provider.TimeoutSecs, allowPrivate)
	headers := modelconfig.AuthHeaders(modelconfig.AuthStyleFor(provider), provider.APIKey)
	var backend c2a.ImageBackend
	if provider.Adapter == modelconfig.AdapterDashScope {
		backend = vendorimage.NewDashScope(provider.BaseURL, provider.APIPath, headers, provider.TimeoutSecs, httpClient, client.DownloadImageB64)
	} else {
		backend = vendorimage.NewMiniMax(provider.BaseURL, provider.APIPath, headers, provider.TimeoutSecs, httpClient)
	}
	return client.WithStandardImages().WithImageBackend(backend)
}

// geminiImage wires Gemini's native image API behind the c2a client so every
// image call site (tasks, assistant, canvas) works unchanged.
func geminiImage(provider modelconfig.Provider, compat *modelconfig.RequestCompat, allowPrivate bool) *c2a.Client {
	httpClient := netguard.NewHTTPClient(0, allowPrivate, false)
	if wrap := upstreamcompat.Wrapper(compat); wrap != nil {
		wrapped := *httpClient
		wrapped.Transport = wrap(httpClient.Transport)
		httpClient = &wrapped
	}
	client := c2a.NewWithPolicy(provider.BaseURL, provider.APIKey, provider.TimeoutSecs, allowPrivate)
	backend := gemini.New(provider.BaseURL, provider.APIPath,
		modelconfig.AuthHeaders(modelconfig.AuthStyleFor(provider), provider.APIKey), provider.TimeoutSecs, httpClient).
		WithImageResponse(imageResponse(compat), client.DownloadImageB64)
	return client.WithStandardImages().WithImageBackend(backend)
}

func imageResponse(compat *modelconfig.RequestCompat) string {
	if compat == nil {
		return modelconfig.ImageResponseInlineData
	}
	return compat.ImageResponse
}

// GeminiChatPath is the OpenAI-compatible root under a Gemini API path.
func GeminiChatPath(apiPath string) string {
	if strings.TrimSpace(apiPath) == "" {
		apiPath = gemini.DefaultAPIPath
	}
	return "/" + strings.Trim(apiPath, "/") + "/openai"
}

// Chat returns an OpenAI-compatible chat client for the route.
func Chat(provider modelconfig.Provider, compat *modelconfig.RequestCompat, chatModel, imageModel string) (*sub2api.Client, error) {
	if strings.TrimSpace(provider.APIKey) == "" {
		return nil, errors.New("模型服务商没有可用的 API Key")
	}
	baseURL := provider.BaseURL
	if provider.Adapter == modelconfig.AdapterCRUN && provider.APIPath == "" {
		baseURL = modelconfig.CRUNOpenAICompatibleBaseURL(baseURL)
	}
	client, err := sub2api.New(baseURL, provider.APIKey, chatModel, imageModel, provider.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if provider.Adapter == modelconfig.AdapterDashScope {
		// Model Studio serves OpenAI-compatible chat under compatible mode.
		return client.WithAPIPrefix(vendorimage.DashScopeChatPath).
			WithTransportWrapper(upstreamcompat.Wrapper(compat)), nil
	}
	if provider.Adapter == modelconfig.AdapterGemini {
		// Both chat endpoints take the key as a Bearer token.
		prefix := GeminiChatPath(provider.APIPath)
		if compat != nil && compat.ChatAPI == modelconfig.ChatAPIOpenAIV1 {
			prefix = "/v1"
		}
		return client.WithAPIPrefix(prefix).
			WithTransportWrapper(upstreamcompat.Wrapper(compat)), nil
	}
	client = client.WithAPIPrefix(provider.APIPath).
		WithTransportWrapper(upstreamcompat.Wrapper(compat))
	if style := modelconfig.AuthStyleFor(provider); style != modelconfig.AuthBearer {
		client = client.WithAuthHeaders(modelconfig.AuthHeaders(style, provider.APIKey))
	}
	return client, nil
}

// ChatForSelection is Chat for a resolved model selection.
func ChatForSelection(selection *modelconfig.Selection, imageModel string) (*sub2api.Client, error) {
	if selection == nil {
		return nil, errors.New("未选择模型")
	}
	return Chat(selection.Provider, modelconfig.SelectionCompat(selection), selection.Model.UpstreamModel, imageModel)
}

// TaskImageForSelection is TaskImage for a resolved model selection.
func TaskImageForSelection(selection *modelconfig.Selection, allowPrivate bool) *c2a.Client {
	return TaskImage(selection.Provider, modelconfig.SelectionCompat(selection), allowPrivate)
}
