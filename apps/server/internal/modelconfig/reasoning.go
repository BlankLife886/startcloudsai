package modelconfig

import (
	"fmt"
	"sort"
	"strings"
)

const (
	ReasoningPriceScopeAssistant   = "assistant"
	ReasoningPriceScopeCanvasAgent = "canvas_agent"

	LegacyCanvasAgentStandardMultiplier = int64(3)
	LegacyCanvasAgentDeepMultiplier     = int64(5)
)

type ReasoningEffortPricing struct {
	Enabled                       *bool  `json:"enabled,omitempty"`
	AssistantPriceCents           int64  `json:"assistantPriceCents"`
	AssistantDiscountPriceCents   *int64 `json:"assistantDiscountPriceCents"`
	CanvasAgentPriceCents         int64  `json:"canvasAgentPriceCents"`
	CanvasAgentDiscountPriceCents *int64 `json:"canvasAgentDiscountPriceCents"`
}

type ReasoningPricing struct {
	DefaultEffort string                            `json:"defaultEffort"`
	Efforts       map[string]ReasoningEffortPricing `json:"efforts"`
}

type ResolvedReasoningPrice struct {
	StandardCents  int64
	EffectiveCents int64
	Scope          string
	Effort         string
}

var (
	gpt5ReasoningEfforts       = []string{"minimal", "low", "medium", "high"}
	gpt51ReasoningEfforts      = []string{"none", "low", "medium", "high"}
	gpt52To54ReasoningEfforts  = []string{"low", "medium", "high", "xhigh"}
	gpt53CodexReasoningEfforts = []string{"low", "medium", "high", "xhigh"}
	gptProReasoningEfforts     = []string{"medium", "high", "xhigh"}
)

// ReasoningEffortsForModel returns the explicit effort values accepted by the
// configured upstream model. Unknown models return nil so callers can omit the
// parameter and let the provider choose its own default.
func ReasoningEffortsForModel(raw string) []string {
	model := canonicalReasoningModel(raw)
	var efforts []string
	switch {
	case model == "" || strings.Contains(model, "-chat"):
		return nil
	case reasoningModelIs(model, "gpt-5.4-pro"),
		reasoningModelIs(model, "gpt-5.2-pro"):
		efforts = gptProReasoningEfforts
	case reasoningModelIs(model, "gpt-5.4"),
		reasoningModelIs(model, "gpt-5.2"):
		efforts = gpt52To54ReasoningEfforts
	case reasoningModelIs(model, "gpt-5.3-codex"), model == "codex-auto-review":
		efforts = gpt53CodexReasoningEfforts
	case reasoningModelIs(model, "gpt-5.1"):
		efforts = gpt51ReasoningEfforts
	case model == "gpt-5", model == "gpt-5-mini", model == "gpt-5-nano":
		efforts = gpt5ReasoningEfforts
	default:
		return nil
	}
	return append([]string(nil), efforts...)
}

func reasoningModelIs(model, base string) bool {
	return model == base || strings.HasPrefix(model, base+"-")
}

func canonicalReasoningModel(raw string) string {
	model := strings.ToLower(strings.TrimSpace(raw))
	if index := strings.LastIndex(model, "/"); index >= 0 {
		model = strings.TrimSpace(model[index+1:])
	}
	return model
}

// ReasoningEffortLabel is the Chinese label shown in public clients.
// Unknown effort ids are returned unchanged so admin-configured values stay visible.
func ReasoningEffortLabel(effort string) string {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "none":
		return "关闭"
	case "minimal":
		return "极低"
	case "low":
		return "低"
	case "medium":
		return "中"
	case "high":
		return "高"
	case "xhigh":
		return "超高"
	case "max":
		return "最大"
	default:
		return strings.TrimSpace(effort)
	}
}

func defaultReasoningEffort(efforts []string) string {
	for _, effort := range efforts {
		if effort == "medium" {
			return effort
		}
	}
	if len(efforts) > 0 {
		return efforts[0]
	}
	return ""
}

func reasoningEffortMultiplier(effort string) int64 {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "high", "xhigh", "max":
		return LegacyCanvasAgentDeepMultiplier
	default:
		return LegacyCanvasAgentStandardMultiplier
	}
}

func multipliedDiscount(value *int64, multiplier int64) *int64 {
	if value == nil {
		return nil
	}
	result := *value * multiplier
	return &result
}

func fallbackReasoningEffortPricing(model Model, effort string) ReasoningEffortPricing {
	multiplier := reasoningEffortMultiplier(effort)
	enabled := true
	return ReasoningEffortPricing{
		Enabled:                       &enabled,
		AssistantPriceCents:           model.PriceCents,
		AssistantDiscountPriceCents:   multipliedDiscount(model.DiscountPriceCents, 1),
		CanvasAgentPriceCents:         model.PriceCents * multiplier,
		CanvasAgentDiscountPriceCents: multipliedDiscount(model.DiscountPriceCents, multiplier),
	}
}

func reasoningEffortEnabled(price ReasoningEffortPricing) bool {
	return price.Enabled == nil || *price.Enabled
}

func enabledBool(value bool) *bool {
	return &value
}

func normalizeReasoningEffortID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func configuredReasoningEfforts(model Model) []string {
	seen := make(map[string]bool)
	result := make([]string, 0)
	add := func(raw string) {
		effort := normalizeReasoningEffortID(raw)
		if effort == "" || seen[effort] {
			return
		}
		seen[effort] = true
		result = append(result, effort)
	}
	if model.supportedReasoningEffortsSet || len(model.SupportedReasoningEfforts) > 0 {
		for _, effort := range model.SupportedReasoningEfforts {
			add(effort)
		}
	}
	if model.ReasoningPricing != nil && len(model.ReasoningPricing.Efforts) > 0 {
		keys := make([]string, 0, len(model.ReasoningPricing.Efforts))
		for effort := range model.ReasoningPricing.Efforts {
			keys = append(keys, effort)
		}
		sort.Strings(keys)
		for _, effort := range keys {
			add(effort)
		}
	}
	if model.supportedReasoningEffortsSet || len(model.SupportedReasoningEfforts) > 0 || len(result) > 0 {
		return result
	}
	return ReasoningEffortsForModel(model.UpstreamModel)
}

func normalizeModelReasoningPricing(model *Model) {
	if model == nil || model.Kind != ModelKindChat {
		if model != nil {
			model.SupportedReasoningEfforts = nil
			model.ReasoningPricing = nil
		}
		return
	}
	available := configuredReasoningEfforts(*model)
	if len(available) == 0 {
		model.SupportedReasoningEfforts = nil
		model.ReasoningPricing = nil
		return
	}
	incoming := make([]string, 0, len(model.SupportedReasoningEfforts))
	for _, effort := range model.SupportedReasoningEfforts {
		if normalized := normalizeReasoningEffortID(effort); normalized != "" && !containsStringValue(incoming, normalized) {
			incoming = append(incoming, normalized)
		}
	}
	incomingSet := model.supportedReasoningEffortsSet || len(incoming) > 0
	pricing := model.ReasoningPricing
	if pricing == nil {
		pricing = &ReasoningPricing{}
	}
	if pricing.Efforts == nil {
		pricing.Efforts = map[string]ReasoningEffortPricing{}
	}
	incomingPricing := make(map[string]ReasoningEffortPricing, len(pricing.Efforts))
	for effort, price := range pricing.Efforts {
		if normalizedEffort := normalizeReasoningEffortID(effort); normalizedEffort != "" {
			incomingPricing[normalizedEffort] = price
		}
	}
	normalized := make(map[string]ReasoningEffortPricing, len(available))
	enabled := make([]string, 0, len(available))
	for _, effort := range available {
		price, ok := incomingPricing[effort]
		if !ok {
			price = fallbackReasoningEffortPricing(*model, effort)
		}
		on := reasoningEffortEnabled(price)
		if incomingSet && !containsStringValue(incoming, effort) {
			on = false
		}
		price.Enabled = enabledBool(on)
		normalized[effort] = price
		if on {
			enabled = append(enabled, effort)
		}
	}
	pricing.Efforts = normalized
	pricing.DefaultEffort = strings.ToLower(strings.TrimSpace(pricing.DefaultEffort))
	if len(enabled) == 0 {
		pricing.DefaultEffort = ""
	} else if !containsStringValue(enabled, pricing.DefaultEffort) {
		pricing.DefaultEffort = defaultReasoningEffort(enabled)
	}
	model.SupportedReasoningEfforts = enabled
	model.ReasoningPricing = pricing
}

func containsStringValue(values []string, requested string) bool {
	for _, value := range values {
		if value == requested {
			return true
		}
	}
	return false
}

func validateDiscountPrice(modelName, label string, standard int64, discount *int64) error {
	if standard < 0 || (discount != nil && *discount < 0) {
		return fmt.Errorf("模型 %s 的%s不能为负", modelName, label)
	}
	if discount != nil && *discount > standard {
		return fmt.Errorf("模型 %s 的%s折扣价不能高于标准价", modelName, label)
	}
	return nil
}

func validateModelReasoningPricing(model Model) error {
	normalizeModelReasoningPricing(&model)
	if model.ReasoningPricing == nil {
		return nil
	}
	if len(model.SupportedReasoningEfforts) > 0 && !containsStringValue(model.SupportedReasoningEfforts, model.ReasoningPricing.DefaultEffort) {
		return fmt.Errorf("对话模型 %s 的默认推理强度无效", model.Name)
	}
	available := make([]string, 0, len(model.ReasoningPricing.Efforts))
	for effort := range model.ReasoningPricing.Efforts {
		available = append(available, effort)
	}
	sort.Strings(available)
	for _, effort := range available {
		price, ok := model.ReasoningPricing.Efforts[effort]
		if !ok {
			return fmt.Errorf("对话模型 %s 缺少 %s 推理定价", model.Name, effort)
		}
		if err := validateDiscountPrice(model.Name, effort+" AI 助手积分", price.AssistantPriceCents, price.AssistantDiscountPriceCents); err != nil {
			return err
		}
		if err := validateDiscountPrice(model.Name, effort+"画布 Agent 积分", price.CanvasAgentPriceCents, price.CanvasAgentDiscountPriceCents); err != nil {
			return err
		}
	}
	return nil
}

func ResolveReasoningPrice(model Model, effort, scope string) ResolvedReasoningPrice {
	normalizeModelReasoningPricing(&model)
	normalizedEffort := strings.ToLower(strings.TrimSpace(effort))
	if model.ReasoningPricing == nil || !containsStringValue(model.SupportedReasoningEfforts, normalizedEffort) {
		return ResolvedReasoningPrice{StandardCents: model.PriceCents, EffectiveCents: EffectivePrice(model), Scope: scope, Effort: normalizedEffort}
	}
	configured := model.ReasoningPricing.Efforts[normalizedEffort]
	standard, discount := configured.AssistantPriceCents, configured.AssistantDiscountPriceCents
	if scope == ReasoningPriceScopeCanvasAgent {
		standard, discount = configured.CanvasAgentPriceCents, configured.CanvasAgentDiscountPriceCents
	}
	effective := standard
	if discount != nil {
		effective = *discount
	}
	return ResolvedReasoningPrice{StandardCents: standard, EffectiveCents: effective, Scope: scope, Effort: normalizedEffort}
}
