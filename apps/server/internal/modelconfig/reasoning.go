package modelconfig

import (
	"fmt"
	"strings"
)

const (
	ReasoningPriceScopeAssistant   = "assistant"
	ReasoningPriceScopeCanvasAgent = "canvas_agent"

	LegacyCanvasAgentStandardMultiplier = int64(3)
	LegacyCanvasAgentDeepMultiplier     = int64(5)
)

type ReasoningEffortPricing struct {
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
	gpt52To55ReasoningEfforts  = []string{"low", "medium", "high", "xhigh"}
	gpt53CodexReasoningEfforts = []string{"low", "medium", "high", "xhigh"}
	gptProReasoningEfforts     = []string{"medium", "high", "xhigh"}
	gpt56ReasoningEfforts      = []string{"low", "medium", "high", "xhigh", "max"}
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
	case reasoningModelIs(model, "gpt-5.6"):
		efforts = gpt56ReasoningEfforts
	case reasoningModelIs(model, "gpt-5.5-pro"),
		reasoningModelIs(model, "gpt-5.4-pro"),
		reasoningModelIs(model, "gpt-5.2-pro"):
		efforts = gptProReasoningEfforts
	case reasoningModelIs(model, "gpt-5.5"),
		reasoningModelIs(model, "gpt-5.4"),
		reasoningModelIs(model, "gpt-5.2"):
		efforts = gpt52To55ReasoningEfforts
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
	return ReasoningEffortPricing{
		AssistantPriceCents:           model.PriceCents,
		AssistantDiscountPriceCents:   multipliedDiscount(model.DiscountPriceCents, 1),
		CanvasAgentPriceCents:         model.PriceCents * multiplier,
		CanvasAgentDiscountPriceCents: multipliedDiscount(model.DiscountPriceCents, multiplier),
	}
}

func normalizeModelReasoningPricing(model *Model) {
	if model == nil || model.Kind != ModelKindChat {
		if model != nil {
			model.SupportedReasoningEfforts = nil
			model.ReasoningPricing = nil
		}
		return
	}
	supported := ReasoningEffortsForModel(model.UpstreamModel)
	model.SupportedReasoningEfforts = append([]string(nil), supported...)
	if len(supported) == 0 {
		model.ReasoningPricing = nil
		return
	}
	pricing := model.ReasoningPricing
	if pricing == nil {
		pricing = &ReasoningPricing{}
	}
	if pricing.Efforts == nil {
		pricing.Efforts = map[string]ReasoningEffortPricing{}
	}
	normalized := make(map[string]ReasoningEffortPricing, len(supported))
	for _, effort := range supported {
		if configured, ok := pricing.Efforts[effort]; ok {
			normalized[effort] = configured
		} else {
			normalized[effort] = fallbackReasoningEffortPricing(*model, effort)
		}
	}
	pricing.Efforts = normalized
	pricing.DefaultEffort = strings.ToLower(strings.TrimSpace(pricing.DefaultEffort))
	if !containsStringValue(supported, pricing.DefaultEffort) {
		pricing.DefaultEffort = defaultReasoningEffort(supported)
	}
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
	if len(model.SupportedReasoningEfforts) == 0 {
		return nil
	}
	if model.ReasoningPricing == nil || !containsStringValue(model.SupportedReasoningEfforts, model.ReasoningPricing.DefaultEffort) {
		return fmt.Errorf("对话模型 %s 的默认推理强度无效", model.Name)
	}
	for _, effort := range model.SupportedReasoningEfforts {
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
