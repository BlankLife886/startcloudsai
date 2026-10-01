package store

import "testing"

func TestSubscriptionPolicyDefaultsDoNotBroadenExplicitScope(t *testing.T) {
	p := SubscriptionPolicy{Series: "api-only", Tier: 3, Channels: []string{"api"}, FeatureKeys: []string{"developer_api_image"}, ModelIDs: []string{"model-one"}, APIModelIDs: []string{"apim_one"}}
	if err := p.Normalize(); err != nil {
		t.Fatal(err)
	}
	// On the api channel the model is a developer API model id.
	if p.Series != "api-only" || p.Tier != 3 || p.Allows("developer_api_image", "web", "model-one") || p.Allows("developer_api_chat", "api", "apim_one") ||
		!p.Allows("developer_api_image", "api", "apim_one") || p.Allows("developer_api_image", "api", "model-one") {
		t.Fatalf("explicit scope changed: %+v", p)
	}
	// A model-restricted plan with no mapped API models covers no API model;
	// an unrestricted plan covers them all.
	restricted := SubscriptionPolicy{Channels: []string{"web", "api"}, ModelIDs: []string{"model-one"}}
	if restricted.Allows("", "api", "apim_any") || !restricted.Allows("", "web", "model-one") {
		t.Fatalf("restricted plan scope: %+v", restricted)
	}
	if open := DefaultSubscriptionPolicy(); !open.Allows("developer_api_chat", "api", "apim_any") {
		t.Fatal("unrestricted plan must cover every API model")
	}
	empty := SubscriptionPolicy{Channels: []string{}}
	if err := empty.Normalize(); err == nil {
		t.Fatal("explicitly empty channels were silently broadened")
	}
}
