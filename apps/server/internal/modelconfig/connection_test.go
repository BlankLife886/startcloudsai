package modelconfig

import (
	"encoding/json"
	"testing"
)

func connectionTestConfig(provider Provider) Config {
	provider.ID, provider.Name, provider.Enabled = "p", "厂商", true
	if provider.Adapter == "" {
		provider.Adapter = AdapterOpenAI
	}
	provider.Routes = []ProviderRoute{{ID: "r", Name: "默认", BaseURL: "https://api.example.com", APIKey: "k", MaxConcurrency: 10, Enabled: true}}
	return Config{Providers: []Provider{provider}, Models: []Model{}, Workspaces: map[string]WorkspaceBinding{}}
}

func TestProviderConnectionFieldsRoundTripAndNormalize(t *testing.T) {
	raw := []byte(`{"id":"p","name":"n","adapter":"openai","vendor":" gemini ","apiPath":"v1beta/openai/","authStyle":"x-goog-api-key","imageApi":"standard","compat":{"dropParams":[" quality ","quality"],"renameParams":{"a":"a"}},"routes":[]}`)
	var provider Provider
	if err := json.Unmarshal(raw, &provider); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Providers: []Provider{provider}, Models: []Model{
		{ID: "m1", ProviderID: "p", Kind: ModelKindImage, Compat: &RequestCompat{ImageResponse: ImageResponseTextURL}},
		{ID: "m2", ProviderID: "p", Kind: ModelKindChat},
	}}
	normalize(&cfg)
	got := cfg.Providers[0]
	if got.Vendor != "gemini" || got.APIPath != "/v1beta/openai" || got.AuthStyle != AuthGoogAPIKey || got.ImageAPI != ImageAPIStandard {
		t.Fatalf("normalized provider = %+v", got)
	}
	// Legacy provider rules move onto every model of the provider.
	if got.Compat != nil {
		t.Fatalf("provider compat kept: %+v", got.Compat)
	}
	m1, m2 := cfg.Models[0].Compat, cfg.Models[1].Compat
	if m1 == nil || len(m1.DropParams) != 1 || m1.ImageResponse != ImageResponseTextURL || len(m1.RenameParams) != 0 {
		t.Fatalf("m1 compat = %+v", m1)
	}
	if m2 == nil || len(m2.DropParams) != 1 || m2.DropParams[0] != "quality" {
		t.Fatalf("m2 compat = %+v", m2)
	}
	if SelectionCompat(&Selection{Provider: got, Model: cfg.Models[1]}) == nil {
		t.Fatal("selection compat should come from the model")
	}
}

func TestValidateRejectsUnsafeConnectionSettings(t *testing.T) {
	cases := map[string]Provider{
		"path":      {APIPath: "https://evil.example/v1"},
		"traversal": {APIPath: "/v1/../admin"},
		"auth":      {AuthStyle: "cookie"},
		"image api": {ImageAPI: "magic"},
	}
	for name, provider := range cases {
		if err := Validate(connectionTestConfig(provider)); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
	// Request rules live on models.
	compatCases := map[string]*RequestCompat{
		"protected":      {DropParams: []string{"model"}},
		"name":           {ExtraBody: map[string]any{"bad key": 1}},
		"size mode":      {ImageSizeParam: "pixels"},
		"image response": {ImageResponse: "guess"},
	}
	for name, compat := range compatCases {
		if err := ValidateCompat("模型 m", compat); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
	if err := Validate(connectionTestConfig(Provider{APIPath: "/api/paas/v4", AuthStyle: AuthXAPIKey})); err != nil {
		t.Fatalf("valid provider rejected: %v", err)
	}
}

func TestDefaultPresetsAreValid(t *testing.T) {
	presets := DefaultPresets()
	if err := ValidatePresets(presets); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"gemini", "xai", "deepseek", "qwen", "doubao", "zhipu", "moonshot", "minimax", "openrouter", "custom"} {
		if _, ok := FindPreset(presets, id); !ok {
			t.Errorf("missing preset %s", id)
		}
	}
}
