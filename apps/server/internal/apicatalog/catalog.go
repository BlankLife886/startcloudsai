// Package apicatalog is the developer API model catalog: stable public model
// names for /v1 that point at site models. See
// docs/DEVELOPER_API_MODEL_CATALOG.md.
package apicatalog

import (
	"crypto/rand"
	"encoding/base32"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// Feature keys charged by /v1. They are not trial features, so trial credits
// never pay for API calls and restricted trial campaigns do not gate the API;
// subscription plans that list feature keys opt in to them explicitly.
const (
	FeatureImage = "developer_api_image"
	FeatureChat  = "developer_api_chat"
)

// FeatureFor maps a catalog kind to the feature key it is charged under.
func FeatureFor(kind string) string {
	if kind == "chat" {
		return FeatureChat
	}
	return FeatureImage
}

// NormalizeName is how /v1 compares model names: case-insensitive, with "."
// and "-" treated alike, so "gpt-5.6" and "GPT-5-6" are the same name.
func NormalizeName(name string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(name)), ".", "-")
}

// NewID returns a catalog id such as apim_4k2x7q9m3p1d.
func NewID() string {
	var raw [8]byte
	_, _ = rand.Read(raw[:])
	return "apim_" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:]))[:12]
}

// KindOf maps a site model kind to a catalog kind; other kinds are not
// offered on /v1.
func KindOf(model modelconfig.Model) (string, bool) {
	switch model.Kind {
	case modelconfig.ModelKindImage:
		return "image", true
	case modelconfig.ModelKindChat:
		return "chat", true
	}
	return "", false
}

// Runnable reports whether /v1 can execute a request on the site model: it
// exists, is enabled and not in maintenance, and its provider is enabled with
// an execution route speaking the OpenAI wire protocol (CRUN is an
// asynchronous task protocol). The provider is resolved the way site model
// selection resolves it, including its first execution route.
func Runnable(cfg modelconfig.Config, modelID string) (modelconfig.Selection, bool) {
	for _, model := range cfg.Models {
		if model.ID != modelID {
			continue
		}
		if !model.Enabled || !model.Available() {
			return modelconfig.Selection{}, false
		}
		provider, ok := modelconfig.ActiveProvider(cfg, model.ProviderID)
		if !ok || provider.Adapter != modelconfig.AdapterOpenAI {
			return modelconfig.Selection{}, false
		}
		return modelconfig.Selection{Provider: provider, Model: model}, true
	}
	return modelconfig.Selection{}, false
}

// LegacyOffered lists what /v1 offered before the catalog existed, in the
// order /v1/models showed it: text-to-image image models, then AI assistant
// chat models, each gated by the model's developer API switch and an
// OpenAI-wire route, deduplicated by name with the first one winning.
func LegacyOffered(cfg modelconfig.Config) []modelconfig.Selection {
	seen := map[string]struct{}{}
	result := []modelconfig.Selection{}
	for _, group := range []struct{ workspace, kind string }{
		{modelconfig.WorkspaceT2I, modelconfig.ModelKindImage},
		{modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat},
	} {
		for _, selected := range modelconfig.PublicModelsForWorkspace(cfg, group.workspace, group.kind) {
			model := selected.Model
			if !model.DeveloperAPI || !model.Available() || selected.Provider.Adapter != modelconfig.AdapterOpenAI {
				continue
			}
			name := NormalizeName(model.Name)
			if name == "" {
				continue
			}
			if _, exists := seen[name]; exists {
				continue
			}
			seen[name] = struct{}{}
			result = append(result, selected)
		}
	}
	return result
}
