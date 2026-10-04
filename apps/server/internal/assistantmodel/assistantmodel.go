// Package assistantmodel resolves which chat model the assistant's internal
// work uses (the e-commerce set reviewer, admin evaluations): a model the
// caller names when it is usable, otherwise the chat model the admin marked
// as the AI assistant page default.
package assistantmodel

import (
	"context"
	"errors"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// ErrNoModel means no usable chat model is configured.
var ErrNoModel = errors.New("no usable chat model is available")

// Reasons a chat model cannot be used, shown to the admin.
const (
	UnusableDisabled    = "disabled"
	UnusableMaintenance = "maintenance"
	UnusableProvider    = "provider"
)

// Usable resolves any chat model by id. Internal work is never shown to
// users, so the model need not be public or offered on the assistant page.
// The second value is empty when usable, otherwise one of the Unusable*
// reasons.
func Usable(cfg modelconfig.Config, modelID string) (*modelconfig.Selection, string) {
	for _, model := range cfg.Models {
		if model.ID != modelID || model.Kind != modelconfig.ModelKindChat {
			continue
		}
		switch {
		case !model.Enabled:
			return nil, UnusableDisabled
		case !model.Available():
			return nil, UnusableMaintenance
		}
		provider, ok := modelconfig.ActiveProvider(cfg, model.ProviderID)
		if !ok {
			return nil, UnusableProvider
		}
		return &modelconfig.Selection{Provider: provider, Model: model}, ""
	}
	return nil, UnusableDisabled
}

// Select picks modelID when it is usable, otherwise the assistant page's
// default chat model, without touching secrets.
func Select(cfg modelconfig.Config, modelID string) *modelconfig.Selection {
	if modelID = strings.TrimSpace(modelID); modelID != "" {
		if selected, reason := Usable(cfg, modelID); reason == "" {
			return selected
		}
	}
	if selected, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat, ""); ok {
		return selected
	}
	return nil
}

// PageDefault is the assistant page's default chat model, or nil.
func PageDefault(cfg modelconfig.Config) *modelconfig.Selection { return Select(cfg, "") }

// Resolve is Select with the provider key decrypted with masterKey.
func Resolve(ctx context.Context, q store.Q, masterKey, modelID string) (*modelconfig.Selection, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	selection := Select(cfg, modelID)
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

// Candidate is one chat model the admin can pick for an evaluation.
type Candidate struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	UpstreamModel string `json:"upstreamModel"`
	Available     bool   `json:"available"`
	// Unusable is empty when selectable, otherwise why it cannot be used.
	Unusable    string `json:"unusable,omitempty"`
	PageDefault bool   `json:"pageDefault"`
}

// Candidates lists every chat model, usable ones first and the page default
// first among them.
func Candidates(cfg modelconfig.Config) []Candidate {
	pageDefault := PageDefault(cfg)
	usable, unusable := []Candidate{}, []Candidate{}
	for _, model := range cfg.Models {
		if model.Kind != modelconfig.ModelKindChat {
			continue
		}
		_, reason := Usable(cfg, model.ID)
		item := Candidate{
			ID: model.ID, Name: model.Name, UpstreamModel: model.UpstreamModel,
			Available: reason == "", Unusable: reason,
			PageDefault: pageDefault != nil && pageDefault.Model.ID == model.ID,
		}
		switch {
		case !item.Available:
			unusable = append(unusable, item)
		case item.PageDefault:
			usable = append([]Candidate{item}, usable...)
		default:
			usable = append(usable, item)
		}
	}
	return append(usable, unusable...)
}
