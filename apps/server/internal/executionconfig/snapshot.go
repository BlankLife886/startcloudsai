// Package executionconfig freezes the execution contract separately from public
// task/message data. Only availability and admission capacity remain live.
package executionconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	Task      = "task"
	Assistant = "assistant_run"
	modelSlot = "models"
)

type Candidate struct {
	Slot       string `json:"slot"`
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId,omitempty"`
	RouteID    string `json:"routeId"`
}

type Snapshot struct {
	Version       int                `json:"version"`
	ConfigVersion string             `json:"configVersion"`
	Config        modelconfig.Config `json:"config"`
	Candidates    []Candidate        `json:"candidates"`
	Params        map[string]any     `json:"params"`
}

// AuthorizedCandidates is shared by creation and public batch limits. A
// same-name/price model in another provider must also be authorized in the
// requesting workspace before it can join the immutable candidate set.
func AuthorizedCandidates(cfg modelconfig.Config, workspace, providerID, modelID, routeID string, across bool, expectedPrice int64) []modelconfig.Selection {
	candidates := modelconfig.ExecutionCandidatesRoute(cfg, providerID, modelID, routeID)
	if across {
		candidates = modelconfig.ExecutionCandidatesRouteAcrossProviders(cfg, providerID, modelID, routeID, expectedPrice)
	}
	selected, found := modelconfig.FindExecutionRoute(cfg, providerID, modelID, "")
	if !found {
		return nil
	}
	allowed := map[string]bool{}
	if workspace != "" {
		for _, candidate := range modelconfig.PublicModelsForWorkspace(cfg, workspace, selected.Model.Kind) {
			allowed[candidate.Model.ID] = true
		}
	}
	selectedPrice := modelconfig.EffectiveWorkspacePrice(cfg, workspace, selected.Model)
	out := make([]modelconfig.Selection, 0, len(candidates))
	for _, candidate := range candidates {
		if !candidate.Model.Available() {
			continue
		}
		bound := candidate.Provider.ID == providerID && candidate.Model.ID == modelID
		if !bound && (workspace != "" && !allowed[candidate.Model.ID] || modelconfig.EffectiveWorkspacePrice(cfg, workspace, candidate.Model) != selectedPrice) {
			continue
		}
		out = append(out, candidate)
	}
	return out
}

func text(params map[string]any, key string) string {
	value, _ := params[key].(string)
	return strings.TrimSpace(value)
}

func price(params map[string]any, keys ...string) (int64, bool) {
	for _, key := range keys {
		switch value := params[key].(type) {
		case int:
			return int64(value), true
		case int64:
			return value, true
		case float64:
			return int64(value), true
		}
	}
	return 0, false
}

func capture(ctx context.Context, q store.Q, source string, id uuid.UUID, cfg modelconfig.Config, params map[string]any, accept func(string, modelconfig.Selection) bool) (*Snapshot, error) {
	across, err := settings.GetBool(ctx, q, "cross_provider_same_model_balancing_enabled")
	if err != nil {
		return nil, err
	}
	snapshot := &Snapshot{Version: 1, Config: cfg, Params: params}
	configJSON, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	configDigest := sha256.Sum256(configJSON)
	snapshot.ConfigVersion = hex.EncodeToString(configDigest[:])
	workspace := text(params, "workspace")
	if source == Task {
		workspace = text(params, "_pricingWorkspace")
	}
	add := func(slot, prefix string, priceKeys ...string) {
		providerID, modelID := text(params, prefix+"ProviderConfigId"), text(params, prefix+"ModelConfigId")
		generic := prefix == "_" || (slot == "image" && (providerID == "" || modelID == ""))
		if generic {
			providerID, modelID = text(params, "_providerConfigId"), text(params, "_modelConfigId")
		}
		if providerID == "" || modelID == "" {
			return
		}
		routeID := text(params, prefix+"ProviderRouteId")
		if generic {
			routeID = text(params, "_providerRouteId")
		}
		unit, hasPrice := price(params, priceKeys...)
		candidates := AuthorizedCandidates(cfg, workspace, providerID, modelID, routeID, across && hasPrice, unit)
		for _, candidate := range candidates {
			if candidate.Model.Available() && (accept == nil || accept(slot, candidate)) {
				snapshot.Candidates = append(snapshot.Candidates, Candidate{Slot: slot, ProviderID: candidate.Provider.ID, ModelID: candidate.Model.ID, RouteID: candidate.Provider.RouteID})
			}
		}
	}
	if source == Task {
		add("task", "_", "_modelEffectivePriceCents", "_unitPriceCents")
	} else {
		add("chat", "_chat", "_chatModelEffectivePriceCents", "_agentChatUnitPriceCents", "_chatCostCents")
		add("image", "_image", "_modelEffectivePriceCents", "_imageModelEffectivePriceCents", "_billingUnitPriceCents", "_imageCostCents")
		if provider, ok := modelconfig.EditableFileProvider(cfg); ok {
			snapshot.Candidates = append(snapshot.Candidates, Candidate{Slot: "editable", ProviderID: provider.ID, RouteID: provider.RouteID})
		}
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	raw, err = store.BindExecutionSnapshot(ctx, q, source, id, modelSlot, raw)
	if err != nil {
		return nil, err
	}
	return decode(raw)
}

func decode(raw json.RawMessage) (*Snapshot, error) {
	var snapshot Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	if snapshot.Version != 1 {
		return nil, errors.New("unsupported execution snapshot version")
	}
	return &snapshot, nil
}

func CaptureTask(ctx context.Context, q store.Q, task *store.Task, cfg modelconfig.Config, accept func(string, modelconfig.Selection) bool) (*Snapshot, error) {
	return capture(ctx, q, Task, task.ID, cfg, task.Params, accept)
}

func CaptureAssistant(ctx context.Context, q store.Q, run *store.AssistantRun, cfg modelconfig.Config, accept func(string, modelconfig.Selection) bool) (*Snapshot, error) {
	return capture(ctx, q, Assistant, run.ID, cfg, run.Params, accept)
}

// Ensure binds old records at their first execution. New records have already
// captured the exact configuration used by their creation transaction.
func Ensure(ctx context.Context, q store.Q, source string, id uuid.UUID, params map[string]any) (*Snapshot, error) {
	raw, err := store.GetExecutionSnapshot(ctx, q, source, id, modelSlot)
	if err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		return decode(raw)
	}
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	return capture(ctx, q, source, id, cfg, params, nil)
}

func liveRoute(cfg modelconfig.Config, ref Candidate) (modelconfig.Provider, bool) {
	if ref.ModelID != "" {
		available := false
		for _, model := range cfg.Models {
			if model.ID == ref.ModelID && model.Enabled && model.Available() {
				available = true
				break
			}
		}
		if !available {
			return modelconfig.Provider{}, false
		}
	}
	for _, provider := range cfg.Providers {
		if provider.ID != ref.ProviderID || !provider.Enabled {
			continue
		}
		for _, route := range modelconfig.ExecutionRoutes(provider) {
			if route.RouteID == ref.RouteID {
				return route, true
			}
		}
	}
	return modelconfig.Provider{}, false
}

func (s *Snapshot) CandidatesFor(slot string) []modelconfig.Selection {
	var out []modelconfig.Selection
	for _, ref := range s.Candidates {
		if ref.Slot != slot || ref.ModelID == "" {
			continue
		}
		if selected, ok := modelconfig.FindExecutionRoute(s.Config, ref.ProviderID, ref.ModelID, ref.RouteID); ok {
			out = append(out, *selected)
		}
	}
	return out
}

func (s *Snapshot) MaxRouteUnits(slot string) int64 {
	var capacity int64
	for _, candidate := range s.CandidatesFor(slot) {
		capacity = max(capacity, int64(candidate.Provider.MaxConcurrency))
	}
	return capacity
}

// RuntimeCandidates only overlays live admission controls; it never copies a
// live endpoint, secret, timeout, model name, capability, or price.
func (s *Snapshot) RuntimeCandidates(ctx context.Context, q store.Q, slot, masterKey string) ([]modelconfig.Selection, error) {
	live, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	var out []modelconfig.Selection
	for _, frozen := range s.CandidatesFor(slot) {
		ref := Candidate{ProviderID: frozen.Provider.ID, ModelID: frozen.Model.ID, RouteID: frozen.Provider.RouteID}
		current, ok := liveRoute(live, ref)
		if !ok {
			continue
		}
		frozen.Provider.APIKey, err = settings.DecryptSecret(frozen.Provider.APIKey, masterKey)
		if err != nil {
			return nil, err
		}
		frozen.Provider.MaxConcurrency = current.MaxConcurrency
		out = append(out, frozen)
	}
	return out, nil
}

func (s *Snapshot) Selection(ctx context.Context, q store.Q, slot, providerID, modelID, routeID, masterKey string) (*modelconfig.Selection, bool, error) {
	candidates, err := s.RuntimeCandidates(ctx, q, slot, masterKey)
	if err != nil {
		return nil, false, err
	}
	for _, candidate := range candidates {
		if candidate.Provider.ID == providerID && candidate.Model.ID == modelID && (routeID == "" || candidate.Provider.RouteID == routeID) {
			return &candidate, true, nil
		}
	}
	return nil, false, nil
}

// BoundSelection resumes already accepted work on its original connection.
// It must only be used for a durable upstream job, never for new admission:
// maintenance, route removal, and lowered limits cannot move that remote job.
func (s *Snapshot) BoundSelection(slot, providerID, modelID, routeID, masterKey string) (*modelconfig.Selection, bool, error) {
	for _, candidate := range s.CandidatesFor(slot) {
		if candidate.Provider.ID != providerID || candidate.Model.ID != modelID ||
			(routeID != "" && candidate.Provider.RouteID != routeID) {
			continue
		}
		var err error
		candidate.Provider.APIKey, err = settings.DecryptSecret(candidate.Provider.APIKey, masterKey)
		if err != nil {
			return nil, false, err
		}
		return &candidate, true, nil
	}
	return nil, false, nil
}

func (s *Snapshot) EditableProvider(ctx context.Context, q store.Q, masterKey string) (modelconfig.Provider, bool, error) {
	live, err := modelconfig.Load(ctx, q)
	if err != nil {
		return modelconfig.Provider{}, false, err
	}
	if !live.EditableFiles.Enabled {
		return modelconfig.Provider{}, false, nil
	}
	provider, found := modelconfig.EditableFileProvider(s.Config)
	if !found {
		return provider, false, nil
	}
	current, allowed := liveRoute(live, Candidate{ProviderID: provider.ID, RouteID: provider.RouteID})
	if !allowed {
		return modelconfig.Provider{}, false, nil
	}
	provider.APIKey, err = settings.DecryptSecret(provider.APIKey, masterKey)
	provider.MaxConcurrency = current.MaxConcurrency
	return provider, err == nil, err
}
