package modelconfig

import (
	"encoding/json"
	"testing"
)

func TestReasoningSwitchPreservesFreePricingAcrossReload(t *testing.T) {
	var model Model
	if err := json.Unmarshal([]byte(`{"kind":"chat","upstreamModel":"custom-model","reasoningEnabled":true,"supportedReasoningEfforts":["high"],"allowZeroPrice":true,"reasoningPricing":{"defaultEffort":"high","efforts":{"high":{"enabled":true,"assistantPriceCents":0,"canvasAgentPriceCents":0},"low":{"enabled":false,"assistantPriceCents":5,"canvasAgentPriceCents":5}}}}`), &model); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		normalizeModelReasoningPricing(&model)
		if len(model.SupportedReasoningEfforts) != 1 || model.SupportedReasoningEfforts[0] != "high" {
			t.Fatalf("free tier lost: %#v", model.SupportedReasoningEfforts)
		}
		if got := ResolveReasoningPrice(model, "high", ReasoningPriceScopeAssistant); got.EffectiveCents != 0 {
			t.Fatalf("free price changed: %#v", got)
		}
		raw, err := json.Marshal(model)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(raw, &model); err != nil {
			t.Fatal(err)
		}
	}
	model.ReasoningEnabled = enabledBool(false)
	normalizeModelReasoningPricing(&model)
	if len(model.SupportedReasoningEfforts) != 0 || model.ReasoningPricing == nil {
		t.Fatal("off switch must hide tiers and retain editable prices")
	}
	model.ReasoningEnabled = enabledBool(true)
	normalizeModelReasoningPricing(&model)
	if len(model.SupportedReasoningEfforts) != 1 || model.SupportedReasoningEfforts[0] != "high" {
		t.Fatal("switching back on must restore only enabled tiers")
	}
}

func TestExplicitReasoningOffOverridesKnownModel(t *testing.T) {
	model := Model{Kind: ModelKindChat, UpstreamModel: "gpt-5.4", ReasoningEnabled: enabledBool(false)}
	normalizeModelReasoningPricing(&model)
	if len(model.SupportedReasoningEfforts) > 0 {
		t.Fatal("model name must not override the switch")
	}
}
