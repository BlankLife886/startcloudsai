package aplus

import (
	"strings"
	"testing"
)

func TestDefaultPlanBasicHasFiveModules(t *testing.T) {
	plan := DefaultPlan("led-bulb", "US", "basic", "15W LED bulb")
	if plan.MarketplaceID != "US" || plan.LanguageCode != "en-US" {
		t.Fatalf("marketplace = %#v", plan)
	}
	if len(plan.Modules) != 5 {
		t.Fatalf("basic modules = %d, want 5", len(plan.Modules))
	}
	if plan.Modules[0].OutputSize != "970x600" {
		t.Fatalf("first size = %s", plan.Modules[0].OutputSize)
	}
}

func TestDefaultPlanPremiumDomestic(t *testing.T) {
	plan := DefaultPlan("led-bulb", "CN", "premium", "LED 灯泡")
	if plan.Language != "简体中文" || plan.MarketplaceID != "CN" {
		t.Fatalf("domestic plan = %#v", plan)
	}
	if len(plan.Modules) != 7 {
		t.Fatalf("premium modules = %d, want 7", len(plan.Modules))
	}
	if plan.Modules[0].OutputSize != "1464x600" {
		t.Fatalf("premium banner size = %s", plan.Modules[0].OutputSize)
	}
}

func TestDecodePlanStripsPriceAndHTML(t *testing.T) {
	raw := `{
	  "categoryId":"led-bulb","marketplaceId":"US","tier":"basic",
	  "modules":[
	    {"typeId":"std-header","headline":"<b>Best $9 lamp</b>","body":"90% 省电","imagePrompt":"970x600 RGB"},
	    {"typeId":"std-overlay-light","headline":"Bright enough","body":"Use facts only","imagePrompt":"970x300"},
	    {"typeId":"std-compare","headline":"Compare","body":"axis","imagePrompt":"970x600"},
	    {"typeId":"std-specs","headline":"Specs","body":"E26","imagePrompt":"970x600"},
	    {"typeId":"std-overlay-dark","headline":"Finish","body":"warranty","imagePrompt":"970x300"}
	  ]
	}`
	plan, err := DecodePlan(raw, Request{CategoryID: "led-bulb", MarketplaceID: "US", Tier: "basic"})
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if strings.Contains(plan.Modules[0].Headline, "<") || strings.Contains(plan.Modules[0].Headline, "$") {
		t.Fatalf("headline still dirty: %q", plan.Modules[0].Headline)
	}
}

func TestDecodePlanDropsPremiumModulesOnBasic(t *testing.T) {
	raw := `{"modules":[
	  {"typeId":"premium-banner","headline":"Hero","body":"x","imagePrompt":"p"},
	  {"typeId":"std-header","headline":"A","body":"b","imagePrompt":"c"},
	  {"typeId":"std-overlay-light","headline":"A","body":"b","imagePrompt":"c"},
	  {"typeId":"std-compare","headline":"A","body":"b","imagePrompt":"c"}
	]}`
	plan, err := DecodePlan(raw, Request{Tier: "basic", MarketplaceID: "US"})
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, module := range plan.Modules {
		if module.TypeID == "premium-banner" {
			t.Fatalf("premium module leaked into basic plan: %#v", module)
		}
	}
}
