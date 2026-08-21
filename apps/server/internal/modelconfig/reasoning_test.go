package modelconfig

import (
	"encoding/json"
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

func TestReasoningEffortLabel(t *testing.T) {
	tests := map[string]string{
		"low": "低", "medium": "中", "high": "高", "xhigh": "超高", "max": "最大",
		"none": "关闭", "minimal": "极低", "custom": "custom", " HIGH ": "高",
	}
	for effort, want := range tests {
		if got := ReasoningEffortLabel(effort); got != want {
			t.Fatalf("label(%q) = %q, want %q", effort, got, want)
		}
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
	if !reflect.DeepEqual(model.SupportedReasoningEfforts, []string{"low", "medium", "high", "xhigh", "max"}) {
		t.Fatalf("supported = %#v", model.SupportedReasoningEfforts)
	}
	medium := model.ReasoningPricing.Efforts["medium"]
	if medium.Enabled == nil || !*medium.Enabled || medium.AssistantPriceCents != 6 || medium.AssistantDiscountPriceCents == nil || *medium.AssistantDiscountPriceCents != 4 ||
		medium.CanvasAgentPriceCents != 18 || medium.CanvasAgentDiscountPriceCents == nil || *medium.CanvasAgentDiscountPriceCents != 12 {
		t.Fatalf("medium pricing = %#v", medium)
	}
	high := model.ReasoningPricing.Efforts["high"]
	if high.CanvasAgentPriceCents != 30 || high.CanvasAgentDiscountPriceCents == nil || *high.CanvasAgentDiscountPriceCents != 20 {
		t.Fatalf("high pricing = %#v", high)
	}
}

func TestNormalizeModelReasoningPricingHonorsDisabledEfforts(t *testing.T) {
	disabled := false
	model := Model{
		Kind: ModelKindChat, UpstreamModel: "gpt-5.6-luna", PriceCents: 10,
		ReasoningPricing: &ReasoningPricing{
			DefaultEffort: "high",
			Efforts: map[string]ReasoningEffortPricing{
				"low":  {Enabled: &disabled, AssistantPriceCents: 1, CanvasAgentPriceCents: 10},
				"high": {AssistantPriceCents: 3, CanvasAgentPriceCents: 30},
			},
		},
	}
	normalizeModelReasoningPricing(&model)
	if !reflect.DeepEqual(model.SupportedReasoningEfforts, []string{"medium", "high", "xhigh", "max"}) {
		t.Fatalf("supported = %#v", model.SupportedReasoningEfforts)
	}
	if model.ReasoningPricing.DefaultEffort != "high" {
		t.Fatalf("default = %q", model.ReasoningPricing.DefaultEffort)
	}
	if reasoningEffortEnabled(model.ReasoningPricing.Efforts["low"]) {
		t.Fatalf("low should stay disabled: %#v", model.ReasoningPricing.Efforts["low"])
	}

	for _, effort := range []string{"low", "medium", "high", "xhigh", "max"} {
		on := false
		price := model.ReasoningPricing.Efforts[effort]
		price.Enabled = &on
		model.ReasoningPricing.Efforts[effort] = price
	}
	normalizeModelReasoningPricing(&model)
	if len(model.SupportedReasoningEfforts) != 0 || model.ReasoningPricing.DefaultEffort != "" {
		t.Fatalf("all-disabled supported=%#v default=%q", model.SupportedReasoningEfforts, model.ReasoningPricing.DefaultEffort)
	}
	got := ResolveReasoningPrice(model, "high", ReasoningPriceScopeAssistant)
	if got.StandardCents != 10 || got.EffectiveCents != 10 {
		t.Fatalf("disabled effort should fall back to base price: %#v", got)
	}
}

func TestNormalizeModelReasoningPricingUsesIncomingSupportedList(t *testing.T) {
	model := Model{
		Kind: ModelKindChat, UpstreamModel: "gpt-5.6-luna", PriceCents: 10,
		SupportedReasoningEfforts:    []string{"medium", "high"},
		supportedReasoningEffortsSet: true,
		ReasoningPricing: &ReasoningPricing{
			DefaultEffort: "high",
			Efforts: map[string]ReasoningEffortPricing{
				"low":  {AssistantPriceCents: 1, CanvasAgentPriceCents: 10},
				"high": {AssistantPriceCents: 3, CanvasAgentPriceCents: 30},
			},
		},
	}
	normalizeModelReasoningPricing(&model)
	if !reflect.DeepEqual(model.SupportedReasoningEfforts, []string{"medium", "high"}) {
		t.Fatalf("supported = %#v", model.SupportedReasoningEfforts)
	}
	if reasoningEffortEnabled(model.ReasoningPricing.Efforts["low"]) || reasoningEffortEnabled(model.ReasoningPricing.Efforts["xhigh"]) {
		t.Fatalf("efforts missing from supported list should be disabled: %#v", model.ReasoningPricing.Efforts)
	}

	model.SupportedReasoningEfforts = nil
	model.supportedReasoningEffortsSet = true
	normalizeModelReasoningPricing(&model)
	if len(model.SupportedReasoningEfforts) != 0 || model.ReasoningPricing.DefaultEffort != "" {
		t.Fatalf("empty supported list should disable all: supported=%#v default=%q", model.SupportedReasoningEfforts, model.ReasoningPricing.DefaultEffort)
	}
}

func TestModelUnmarshalKeepsEmptySupportedReasoningEfforts(t *testing.T) {
	raw := []byte(`{
		"id":"chat","name":"Chat","providerId":"provider","upstreamModel":"gpt-5.6-luna",
		"kind":"chat","priceCents":10,"public":true,"enabled":true,
		"supportedReasoningEfforts":[],
		"reasoningPricing":{"defaultEffort":"medium","efforts":{"medium":{"assistantPriceCents":2,"canvasAgentPriceCents":6}}}
	}`)
	var model Model
	if err := json.Unmarshal(raw, &model); err != nil {
		t.Fatal(err)
	}
	if !model.supportedReasoningEffortsSet {
		t.Fatal("empty supportedReasoningEfforts should still be treated as provided")
	}
	normalizeModelReasoningPricing(&model)
	if len(model.SupportedReasoningEfforts) != 0 {
		t.Fatalf("all-off supported = %#v", model.SupportedReasoningEfforts)
	}

	omitted := []byte(`{
		"id":"chat","name":"Chat","providerId":"provider","upstreamModel":"gpt-5.6-luna",
		"kind":"chat","priceCents":10,"public":true,"enabled":true
	}`)
	var legacy Model
	if err := json.Unmarshal(omitted, &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.supportedReasoningEffortsSet {
		t.Fatal("omitted supportedReasoningEfforts should not be treated as all-off")
	}
}

func TestReasoningEnablementSurvivesJSONRoundTrip(t *testing.T) {
	cfg := Config{
		Version: Version,
		Models: []Model{{
			ID: "chat", Name: "Chat", ProviderID: "provider", UpstreamModel: "gpt-5.6-luna",
			Kind: ModelKindChat, PriceCents: 10, Public: true, Enabled: true,
			SupportedReasoningEfforts: []string{"medium", "high"},
			ReasoningPricing: &ReasoningPricing{
				DefaultEffort: "high",
				Efforts: map[string]ReasoningEffortPricing{
					"low":    {AssistantPriceCents: 1, CanvasAgentPriceCents: 10},
					"medium": {AssistantPriceCents: 2, CanvasAgentPriceCents: 20},
					"high":   {AssistantPriceCents: 3, CanvasAgentPriceCents: 30},
				},
			},
		}},
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var loaded Config
	if err := json.Unmarshal(raw, &loaded); err != nil {
		t.Fatal(err)
	}
	if !loaded.Models[0].supportedReasoningEffortsSet {
		t.Fatalf("round-trip dropped supportedReasoningEfforts: %s", raw)
	}
	normalize(&loaded)
	if !reflect.DeepEqual(loaded.Models[0].SupportedReasoningEfforts, []string{"medium", "high"}) {
		t.Fatalf("round-trip supported = %#v body = %s", loaded.Models[0].SupportedReasoningEfforts, raw)
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
