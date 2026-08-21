package modelconfig

import (
	"reflect"
	"testing"
)

func TestReasoningEffortsForModel(t *testing.T) {
	tests := []struct {
		model string
		want  []string
	}{
		{model: "gpt-5.4", want: []string{"low", "medium", "high", "xhigh"}},
		{model: "openai/gpt-5.4-2026-03-05", want: []string{"low", "medium", "high", "xhigh"}},
		{model: "gpt-5.4-pro", want: []string{"medium", "high", "xhigh"}},
		{model: "gpt-5.5-pro", want: []string{"medium", "high", "xhigh"}},
		{model: "gpt-5.2-pro", want: []string{"medium", "high", "xhigh"}},
		{model: "gpt-5.3-codex", want: []string{"low", "medium", "high", "xhigh"}},
		{model: "gpt-5.3-codex-spark", want: []string{"low", "medium", "high", "xhigh"}},
		{model: "codex-auto-review", want: []string{"low", "medium", "high", "xhigh"}},
		{model: "gpt-5.1", want: []string{"none", "low", "medium", "high"}},
		{model: "gpt-5", want: []string{"minimal", "low", "medium", "high"}},
		{model: "gpt-5-5"},
		{model: "provider/gpt-5-5"},
		{model: "gpt-5-6"},
		{model: "provider/gpt-5-6"},
		{model: "gpt-5.6", want: []string{"low", "medium", "high", "xhigh", "max"}},
		{model: "gpt-5.6-luna", want: []string{"low", "medium", "high", "xhigh", "max"}},
		{model: "gpt-5.6-terra", want: []string{"low", "medium", "high", "xhigh", "max"}},
		{model: "provider/gpt-5.6-sol", want: []string{"low", "medium", "high", "xhigh", "max"}},
		{model: "gpt-5.2-chat-latest"},
		{model: "gpt-5-5-pro"},
		{model: "gpt-5-5-codex"},
		{model: "gpt-5-6-pro"},
		{model: "gpt-5-6-codex"},
		{model: "gpt-5.60-sol"},
		{model: "claude-opus-4-6"},
	}
	for _, test := range tests {
		t.Run(test.model, func(t *testing.T) {
			if got := ReasoningEffortsForModel(test.model); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("efforts = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestReasoningEffortsForModelReturnsACopy(t *testing.T) {
	first := ReasoningEffortsForModel("gpt-5.6-terra")
	first[0] = "changed"
	if got := ReasoningEffortsForModel("gpt-5.6-terra")[0]; got != "low" {
		t.Fatalf("shared effort slice was mutated: %q", got)
	}
}

func TestNormalizeModelReasoningPricingBackfillsLegacyPrices(t *testing.T) {
	discount := int64(4)
	model := Model{
		Kind: ModelKindChat, UpstreamModel: "gpt-5.6-terra",
		PriceCents: 6, DiscountPriceCents: &discount,
	}
	normalizeModelReasoningPricing(&model)
	if model.ReasoningPricing == nil || model.ReasoningPricing.DefaultEffort != "medium" {
		t.Fatalf("pricing = %#v", model.ReasoningPricing)
	}
	medium := model.ReasoningPricing.Efforts["medium"]
	if medium.AssistantPriceCents != 6 || medium.AssistantDiscountPriceCents == nil || *medium.AssistantDiscountPriceCents != 4 ||
		medium.CanvasAgentPriceCents != 18 || medium.CanvasAgentDiscountPriceCents == nil || *medium.CanvasAgentDiscountPriceCents != 12 {
		t.Fatalf("medium pricing = %#v", medium)
	}
	high := model.ReasoningPricing.Efforts["high"]
	if high.CanvasAgentPriceCents != 30 || high.CanvasAgentDiscountPriceCents == nil || *high.CanvasAgentDiscountPriceCents != 20 {
		t.Fatalf("high pricing = %#v", high)
	}
}

func TestResolveReasoningPriceUsesConfiguredScopeAndDiscount(t *testing.T) {
	assistantDiscount, canvasDiscount := int64(7), int64(19)
	model := Model{
		Kind: ModelKindChat, UpstreamModel: "gpt-5.6-luna", PriceCents: 5,
		ReasoningPricing: &ReasoningPricing{
			DefaultEffort: "medium",
			Efforts: map[string]ReasoningEffortPricing{
				"high": {
					AssistantPriceCents: 9, AssistantDiscountPriceCents: &assistantDiscount,
					CanvasAgentPriceCents: 24, CanvasAgentDiscountPriceCents: &canvasDiscount,
				},
			},
		},
	}
	assistant := ResolveReasoningPrice(model, "high", ReasoningPriceScopeAssistant)
	if assistant.StandardCents != 9 || assistant.EffectiveCents != 7 {
		t.Fatalf("assistant price = %#v", assistant)
	}
	canvas := ResolveReasoningPrice(model, "high", ReasoningPriceScopeCanvasAgent)
	if canvas.StandardCents != 24 || canvas.EffectiveCents != 19 {
		t.Fatalf("canvas price = %#v", canvas)
	}
}

func TestNormalizeModelReasoningPricingDoesNotAdaptHyphenAliases(t *testing.T) {
	model := Model{Kind: ModelKindChat, UpstreamModel: "gpt-5-6", PriceCents: 5}
	normalizeModelReasoningPricing(&model)
	if model.ReasoningPricing != nil || len(model.SupportedReasoningEfforts) != 0 {
		t.Fatalf("unexpected alias pricing = %#v efforts=%#v", model.ReasoningPricing, model.SupportedReasoningEfforts)
	}
}
