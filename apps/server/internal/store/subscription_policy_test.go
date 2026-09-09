package store

import "testing"

func TestSubscriptionPolicyDefaultsDoNotBroadenExplicitScope(t *testing.T) {
	p := SubscriptionPolicy{Series: "api-only", Tier: 3, Channels: []string{"api"}, FeatureKeys: []string{"text_to_image"}, ModelIDs: []string{"model-one"}}
	if err := p.Normalize(); err != nil {
		t.Fatal(err)
	}
	if p.Series != "api-only" || p.Tier != 3 || p.Allows("text_to_image", "web", "model-one") || p.Allows("ui_design", "api", "model-one") || !p.Allows("text_to_image", "api", "model-one") {
		t.Fatalf("explicit scope changed: %+v", p)
	}
	empty := SubscriptionPolicy{Channels: []string{}}
	if err := empty.Normalize(); err == nil {
		t.Fatal("explicitly empty channels were silently broadened")
	}
}
