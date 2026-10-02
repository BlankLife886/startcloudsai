package decision

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// SettingKey stores the optional decision-model override:
// {"modelId": "<chat model id>"}. Empty means "use the assistant page's
// default chat model", which is the platform default.
const SettingKey = "assistant_decision_model"

// Thresholds turn one model's confidence into actions. Confidence is not
// comparable across models (self-reported LLM confidence is uncalibrated), so
// each model gets its own pair.
type Thresholds struct {
	// Intent is the confidence below which the rules' intent is used instead.
	Intent float64 `json:"intent"`
	// Clarify is the "yes" probability needed before asking the user first.
	Clarify float64 `json:"clarify"`
	// TimeoutMs is how long a turn waits for this model before the rules
	// answer instead. Zero means DefaultTimeout. Slow models trade first-token
	// latency for accuracy, so the admin sets it per model from evaluation.
	TimeoutMs int `json:"timeoutMs,omitempty"`
}

// DefaultThresholds suit a general chat model's self-reported confidence.
var DefaultThresholds = Thresholds{Intent: 0.6, Clarify: 0.75}

// Wait limits for the decision model.
const (
	DefaultTimeout = 3 * time.Second
	MinTimeoutMs   = 1000
	MaxTimeoutMs   = 15000
)

// Timeout is the wait limit for the decision model.
func (t Thresholds) Timeout() time.Duration {
	if t.TimeoutMs <= 0 {
		return DefaultTimeout
	}
	return time.Duration(t.TimeoutMs) * time.Millisecond
}

// DefaultThresholdsKey holds the thresholds for models without their own.
const DefaultThresholdsKey = "default"

// Override is the stored form of SettingKey.
type Override struct {
	ModelID string `json:"modelId"`
	// Thresholds are keyed by model id, plus DefaultThresholdsKey.
	Thresholds map[string]Thresholds `json:"thresholds,omitempty"`
}

// ThresholdsFor returns the thresholds to apply to modelID.
func (o Override) ThresholdsFor(modelID string) Thresholds {
	if value, ok := o.Thresholds[strings.TrimSpace(modelID)]; ok && modelID != "" {
		return value
	}
	if value, ok := o.Thresholds[DefaultThresholdsKey]; ok {
		return value
	}
	return DefaultThresholds
}

// Validate keeps stored settings usable.
func (o Override) Validate() error {
	if len([]rune(o.ModelID)) > 120 {
		return errors.New("模型 ID 过长")
	}
	if len(o.Thresholds) > 50 {
		return errors.New("阈值配置过多")
	}
	for key, value := range o.Thresholds {
		if strings.TrimSpace(key) == "" || len([]rune(key)) > 120 {
			return errors.New("阈值的模型键无效")
		}
		if value.Intent < 0 || value.Intent > 1 || value.Clarify < 0 || value.Clarify > 1 {
			return errors.New("阈值必须在 0 到 1 之间")
		}
		if value.TimeoutMs != 0 && (value.TimeoutMs < MinTimeoutMs || value.TimeoutMs > MaxTimeoutMs) {
			return errors.New("判断等待上限必须在 1 到 15 秒之间")
		}
	}
	return nil
}

// LoadOverride reads the override; a missing setting is not an error.
func LoadOverride(ctx context.Context, q store.Q) (Override, error) {
	raw, err := store.GetAppSetting(ctx, q, SettingKey)
	if err != nil || len(raw) == 0 {
		return Override{}, err
	}
	var override Override
	if err := json.Unmarshal(raw, &override); err != nil {
		return Override{}, err
	}
	override.ModelID = strings.TrimSpace(override.ModelID)
	return override, nil
}

// SaveOverride stores the override after validation.
func SaveOverride(ctx context.Context, q store.Q, override Override, now time.Time) error {
	override.ModelID = strings.TrimSpace(override.ModelID)
	if err := override.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(override)
	if err != nil {
		return err
	}
	return store.SetAppSetting(ctx, q, SettingKey, raw, now)
}

// ErrNoModel means neither the override nor the assistant page has a usable
// chat model; callers fall back to rules.
var ErrNoModel = errors.New("no decision model is available")

// ResolveModel picks the decision model: the override when it is a usable
// assistant chat model, otherwise the chat model the admin marked as the
// assistant page default (falling back to the page's first available one).
// The returned provider key is decrypted with masterKey.
func ResolveModel(ctx context.Context, q store.Q, masterKey string) (*modelconfig.Selection, error) {
	override, err := LoadOverride(ctx, q)
	if err != nil {
		return nil, err
	}
	return ResolveModelWith(ctx, q, masterKey, override)
}

// ResolveModelWith is ResolveModel with the override supplied by the caller.
func ResolveModelWith(ctx context.Context, q store.Q, masterKey string, override Override) (*modelconfig.Selection, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	selection, _ := SelectModel(cfg, override)
	if selection == nil {
		return nil, ErrNoModel
	}
	key, err := settings.DecryptSecret(selection.Provider.APIKey, masterKey)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(key) == "" || strings.TrimSpace(selection.Provider.BaseURL) == "" {
		return nil, ErrNoModel
	}
	resolved := *selection
	resolved.Provider.APIKey = key
	return &resolved, nil
}

// Model sources reported to the admin page.
const (
	SourceOverride    = "override"
	SourcePageDefault = "page_default"
	SourceNone        = "none"
)

// SelectModel applies the override rule without touching secrets: the
// override when it is a usable assistant chat model, otherwise the assistant
// page's default chat model. The second value names where it came from.
func SelectModel(cfg modelconfig.Config, override Override) (*modelconfig.Selection, string) {
	if override.ModelID != "" {
		if selected, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat, override.ModelID); ok {
			return selected, SourceOverride
		}
	}
	if selected, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat, ""); ok {
		return selected, SourcePageDefault
	}
	return nil, SourceNone
}

// ClientCompleter adapts a chat client to Completer. The caller builds the
// client from the resolved selection (adapter quirks live with the caller).
type ClientCompleter struct {
	Client *sub2api.Client
}

// decisionOutputTokens is ample for a JSON object answering a few questions.
const decisionOutputTokens = 600

func (c ClientCompleter) Complete(ctx context.Context, system, user string) (string, error) {
	if c.Client == nil {
		return "", ErrNoModel
	}
	// A routing question needs no deliberation: reasoning only adds latency in
	// the gap between the user pressing enter and anything appearing.
	client := c.Client.WithoutReasoning().WithoutRetry().WithMaxOutputTokens(decisionOutputTokens)
	completion, err := client.CompleteChatTextWithImages(ctx, []sub2api.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}, nil, nil)
	if err != nil {
		return "", err
	}
	return completion.Text, nil
}

// NewChatClient builds an OpenAI-compatible chat client for a resolved
// selection (provider key already decrypted), handling the CRUN adapter.
func NewChatClient(selection *modelconfig.Selection) (*sub2api.Client, error) {
	if selection == nil || strings.TrimSpace(selection.Provider.APIKey) == "" {
		return nil, ErrNoModel
	}
	baseURL := selection.Provider.BaseURL
	if selection.Provider.Adapter == modelconfig.AdapterCRUN {
		baseURL = modelconfig.CRUNOpenAICompatibleBaseURL(baseURL)
	}
	client, err := sub2api.New(baseURL, selection.Provider.APIKey, selection.Model.UpstreamModel, "", selection.Provider.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if selection.Provider.Adapter == modelconfig.AdapterCRUN {
		client = client.WithAPIKeyHeader("x-api-key")
	}
	return client, nil
}
