package decision

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// SettingKey stores the optional decision-model override:
// {"modelId": "<chat model id>"}. Empty means "use the assistant page's
// default chat model", which is the platform default.
const SettingKey = "assistant_decision_model"

// Override is the stored form of SettingKey.
type Override struct {
	ModelID string `json:"modelId"`
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

// ErrNoModel means neither the override nor the assistant page has a usable
// chat model; callers fall back to rules.
var ErrNoModel = errors.New("no decision model is available")

// ResolveModel picks the decision model: the override when it is a usable
// assistant chat model, otherwise the chat model the admin marked as the
// assistant page default (falling back to the page's first available one).
// The returned provider key is decrypted with masterKey.
func ResolveModel(ctx context.Context, q store.Q, masterKey string) (*modelconfig.Selection, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	override, err := LoadOverride(ctx, q)
	if err != nil {
		return nil, err
	}
	var selection *modelconfig.Selection
	if override.ModelID != "" {
		if selected, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat, override.ModelID); ok {
			selection = selected
		}
	}
	if selection == nil {
		selected, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat, "")
		if !ok {
			return nil, ErrNoModel
		}
		selection = selected
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
