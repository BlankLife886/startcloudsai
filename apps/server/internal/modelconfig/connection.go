package modelconfig

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// How a provider authenticates. Empty means the adapter's historical default
// (Bearer for OpenAI-compatible routes, Bearer + x-api-key for CRUN).
const (
	AuthBearer        = "bearer"
	AuthXAPIKey       = "x-api-key"
	AuthGoogAPIKey    = "x-goog-api-key"
	AuthBearerXAPIKey = "bearer+x-api-key"
)

// Which image endpoints an OpenAI-compatible provider speaks. The default
// probes chatgpt2api's recoverable task protocol first and falls back to the
// public endpoints; official vendors only expose the public ones.
const (
	ImageAPIAuto     = ""
	ImageAPIStandard = "standard"
)

// How an image request expresses its output size upstream.
const (
	ImageSizeParamSize        = ""             // size=WxH (OpenAI)
	ImageSizeParamAspectRatio = "aspect_ratio" // aspect_ratio=W:H, size removed
	ImageSizeParamNone        = "none"         // size removed
)

// How a Gemini-native upstream hands back generated images. Relays differ,
// so the admin picks one per provider or model; nothing is auto-detected.
const (
	ImageResponseInlineData  = ""              // candidates[].content.parts[].inlineData (official API)
	ImageResponseTextURL     = "text_url"      // an http(s) image link inside a text part
	ImageResponseTextDataURI = "text_data_uri" // a data:image/...;base64 URI inside a text part
)

// Which chat endpoint a Gemini-native model is called through. The official
// API offers an OpenAI-compatible root under the API path; many relays only
// serve the standard /v1 root. The admin picks one per model.
const (
	ChatAPIGeminiOpenAI = ""   // {apiPath}/openai/chat/completions (official)
	ChatAPIOpenAIV1     = "v1" // /v1/chat/completions
)

var authStyles = []string{AuthBearer, AuthXAPIKey, AuthGoogAPIKey, AuthBearerXAPIKey}
var imageSizeParams = []string{ImageSizeParamSize, ImageSizeParamAspectRatio, ImageSizeParamNone}
var imageResponses = []string{ImageResponseInlineData, ImageResponseTextURL, ImageResponseTextDataURI}
var chatAPIs = []string{ChatAPIGeminiOpenAI, ChatAPIOpenAIV1}

// How reference images are sent to an OpenAI-compatible vendor; values match
// c2a.ImageEdit*. The admin picks one per model.
const (
	ImageEditMultipart       = ""                 // multipart POST /images/edits (OpenAI)
	ImageEditJSONImageURL    = "json_image_url"   // JSON /images/edits, image: {type: image_url, url} (xAI)
	ImageEditJSONGenerations = "json_generations" // JSON /images/generations, image: data URI(s) (Seedream)
)

var imageEdits = []string{ImageEditMultipart, ImageEditJSONImageURL, ImageEditJSONGenerations}

// RequestCompat smooths over per-vendor differences in otherwise
// OpenAI-compatible JSON request bodies. A provider sets the vendor-wide rules
// and a model may add to them; see MergeCompat.
type RequestCompat struct {
	// DropParams removes top-level body fields the upstream rejects.
	DropParams []string `json:"dropParams,omitempty"`
	// RenameParams moves a top-level field to the name the upstream expects.
	RenameParams map[string]string `json:"renameParams,omitempty"`
	// ExtraBody is merged into every request body, overriding sent values.
	ExtraBody map[string]any `json:"extraBody,omitempty"`
	// ImageSizeParam controls how image requests send their size.
	ImageSizeParam string `json:"imageSizeParam,omitempty"`
	// ImageResponse says where a Gemini-native upstream puts the image.
	ImageResponse string `json:"imageResponse,omitempty"`
	// ChatAPI picks the chat endpoint of a Gemini-native model.
	ChatAPI string `json:"chatApi,omitempty"`
	// ImageEdit picks how reference images are sent; see ImageEdit*.
	ImageEdit string `json:"imageEdit,omitempty"`
	// ImageParams is the image parameter profile ID; ImageParamRules is the
	// copy of its rules kept in sync on save (see EmbedImageParamRules), so
	// task snapshots and every process carry the full rules.
	ImageParams     string           `json:"imageParams,omitempty"`
	ImageParamRules *ImageParamRules `json:"imageParamRules,omitempty"`
}

func (c *RequestCompat) Empty() bool {
	return c == nil || (len(c.DropParams) == 0 && len(c.RenameParams) == 0 &&
		len(c.ExtraBody) == 0 && c.ImageSizeParam == "" && c.ImageResponse == "" && c.ChatAPI == "" && c.ImageEdit == "" &&
		c.ImageParams == "" && c.ImageParamRules == nil)
}

// RewritesBody reports whether any rule changes outgoing request bodies;
// ImageResponse, ChatAPI and ImageEdit only choose endpoints, request shape
// and response parsing.
func (c *RequestCompat) RewritesBody() bool {
	return c != nil && (len(c.DropParams) > 0 || len(c.RenameParams) > 0 ||
		len(c.ExtraBody) > 0 || c.ImageSizeParam != "" || c.ImageParamRules != nil)
}

var paramNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`)

// protectedParams are routing fields the platform itself must control.
var protectedParams = map[string]bool{"model": true, "messages": true, "prompt": true, "stream": true}

func normalizeCompat(compat *RequestCompat) *RequestCompat {
	if compat == nil {
		return nil
	}
	out := &RequestCompat{
		DropParams:     cleanStrings(compat.DropParams),
		ImageSizeParam: strings.TrimSpace(compat.ImageSizeParam),
		ImageResponse:  strings.TrimSpace(compat.ImageResponse),
		ChatAPI:        strings.TrimSpace(compat.ChatAPI),
		ImageEdit:      strings.TrimSpace(compat.ImageEdit),
		ImageParams:    strings.TrimSpace(compat.ImageParams),
	}
	if compat.ImageParamRules != nil && out.ImageParams != "" {
		rules := normalizeImageParamRules(*compat.ImageParamRules)
		out.ImageParamRules = &rules
	}
	sort.Strings(out.DropParams)
	if len(compat.RenameParams) > 0 {
		out.RenameParams = make(map[string]string, len(compat.RenameParams))
		for from, to := range compat.RenameParams {
			from, to = strings.TrimSpace(from), strings.TrimSpace(to)
			if from != "" && to != "" && from != to {
				out.RenameParams[from] = to
			}
		}
	}
	if len(compat.ExtraBody) > 0 {
		out.ExtraBody = make(map[string]any, len(compat.ExtraBody))
		for key, value := range compat.ExtraBody {
			if key = strings.TrimSpace(key); key != "" {
				out.ExtraBody[key] = value
			}
		}
	}
	if out.Empty() {
		return nil
	}
	return out
}

func validateCompat(owner string, compat *RequestCompat) error {
	if compat == nil {
		return nil
	}
	check := func(name string) error {
		if !paramNamePattern.MatchString(name) {
			return fmt.Errorf("%s 的参数名无效：%s", owner, name)
		}
		if protectedParams[name] {
			return fmt.Errorf("%s 不能改写平台控制的参数：%s", owner, name)
		}
		return nil
	}
	for _, name := range compat.DropParams {
		if err := check(name); err != nil {
			return err
		}
	}
	for from, to := range compat.RenameParams {
		if err := check(from); err != nil {
			return err
		}
		if err := check(to); err != nil {
			return err
		}
	}
	for key := range compat.ExtraBody {
		if err := check(key); err != nil {
			return err
		}
	}
	if !containsExact(imageSizeParams, compat.ImageSizeParam) {
		return fmt.Errorf("%s 的尺寸参数方式无效", owner)
	}
	if !containsExact(imageResponses, compat.ImageResponse) {
		return fmt.Errorf("%s 的图片返回方式无效", owner)
	}
	if !containsExact(chatAPIs, compat.ChatAPI) {
		return fmt.Errorf("%s 的对话接口无效", owner)
	}
	if !containsExact(imageEdits, compat.ImageEdit) {
		return fmt.Errorf("%s 的参考图发送方式无效", owner)
	}
	if compat.ImageParams != "" && !presetIDPattern.MatchString(compat.ImageParams) {
		return fmt.Errorf("%s 的生图参数档案无效", owner)
	}
	if compat.ImageParamRules != nil {
		if err := validateImageParamRules(owner, *compat.ImageParamRules); err != nil {
			return err
		}
	}
	return nil
}

// MergeCompat layers a model's rules over legacy provider rules (used once
// when migrating them onto models). Lists are unioned,
// maps are merged with the model winning, and a set image size mode wins.
func MergeCompat(provider, model *RequestCompat) *RequestCompat {
	if model.Empty() {
		return normalizeCompat(provider)
	}
	if provider.Empty() {
		return normalizeCompat(model)
	}
	merged := &RequestCompat{
		DropParams:     append(append([]string(nil), provider.DropParams...), model.DropParams...),
		RenameParams:   map[string]string{},
		ExtraBody:      map[string]any{},
		ImageSizeParam: provider.ImageSizeParam,
		ImageResponse:  provider.ImageResponse,
		ChatAPI:        provider.ChatAPI,
		ImageEdit:      provider.ImageEdit,
		ImageParams:    provider.ImageParams,
	}
	for key, value := range provider.RenameParams {
		merged.RenameParams[key] = value
	}
	for key, value := range model.RenameParams {
		merged.RenameParams[key] = value
	}
	for key, value := range provider.ExtraBody {
		merged.ExtraBody[key] = value
	}
	for key, value := range model.ExtraBody {
		merged.ExtraBody[key] = value
	}
	if model.ImageSizeParam != "" {
		merged.ImageSizeParam = model.ImageSizeParam
	}
	if model.ImageResponse != "" {
		merged.ImageResponse = model.ImageResponse
	}
	if model.ChatAPI != "" {
		merged.ChatAPI = model.ChatAPI
	}
	if model.ImageEdit != "" {
		merged.ImageEdit = model.ImageEdit
	}
	if model.ImageParams != "" {
		merged.ImageParams = model.ImageParams
	}
	return normalizeCompat(merged)
}

// ValidateCompat checks one model's request rules.
func ValidateCompat(owner string, compat *RequestCompat) error {
	return validateCompat(owner, compat)
}

// TestRoute returns provider pinned to its first route that has a key, even
// if the provider or route is still disabled, for admin test calls.
func TestRoute(provider Provider) (Provider, bool) {
	for _, route := range provider.Routes {
		if strings.TrimSpace(route.APIKey) == "" {
			continue
		}
		provider.RouteID, provider.RouteName = route.ID, route.Name
		provider.BaseURL, provider.APIKey, provider.TimeoutSecs = route.BaseURL, route.APIKey, route.TimeoutSecs
		return provider, true
	}
	return provider, false
}

// SelectionCompat is the effective request rewrite for one model selection.
// Rules are configured per model only.
func SelectionCompat(selection *Selection) *RequestCompat {
	if selection == nil {
		return nil
	}
	return normalizeCompat(selection.Model.Compat)
}

func NormalizeAPIPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = "/" + strings.Trim(value, "/")
	if value == "/" {
		return ""
	}
	return value
}

var apiPathPattern = regexp.MustCompile(`^(/[A-Za-z0-9._~-]+)+$`)

func validateAPIPath(owner, value string) error {
	if value == "" {
		return nil
	}
	if !apiPathPattern.MatchString(value) || strings.Contains(value, "..") {
		return fmt.Errorf("%s 的接口路径前缀无效（示例：/v1、/api/v3）", owner)
	}
	return nil
}

// AuthStyleFor returns the effective auth style, applying adapter defaults.
func AuthStyleFor(provider Provider) string {
	if provider.AuthStyle != "" {
		return provider.AuthStyle
	}
	switch provider.Adapter {
	case AdapterCRUN:
		return AuthBearerXAPIKey
	case AdapterGemini:
		return AuthGoogAPIKey
	}
	return AuthBearer
}

// AuthHeaders maps an auth style to the request headers carrying the key.
func AuthHeaders(style, apiKey string) map[string]string {
	switch style {
	case AuthXAPIKey:
		return map[string]string{"x-api-key": apiKey}
	case AuthGoogAPIKey:
		return map[string]string{"x-goog-api-key": apiKey}
	case AuthBearerXAPIKey:
		return map[string]string{"Authorization": "Bearer " + apiKey, "x-api-key": apiKey}
	default:
		return map[string]string{"Authorization": "Bearer " + apiKey}
	}
}

func containsExact(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
