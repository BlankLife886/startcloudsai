package modelconfig

import "testing"

func TestDefaultImageParamProfilesAreValid(t *testing.T) {
	profiles := DefaultImageParamProfiles()
	if err := ValidateImageParamProfiles(profiles); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"openai", "grok", "gemini"} {
		if _, ok := FindImageParamProfile(profiles, id); !ok {
			t.Errorf("missing profile %s", id)
		}
	}
}

func TestEmbedImageParamRulesCopiesAndRefreshes(t *testing.T) {
	profiles := DefaultImageParamProfiles()
	cfg := Config{Models: []Model{
		{ID: "a", Name: "a", Compat: &RequestCompat{ImageParams: "grok"}},
		{ID: "b", Name: "b", Compat: &RequestCompat{ImageParamRules: &ImageParamRules{SizeMode: ImageSizeModeNone}}},
	}}
	changed, err := embedImageParamRules(&cfg, profiles)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if rules := cfg.Models[0].Compat.ImageParamRules; rules == nil || rules.TierField != "resolution" {
		t.Fatalf("rules = %+v", rules)
	}
	if cfg.Models[1].Compat.ImageParamRules != nil {
		t.Fatal("rules without a profile ID must be cleared")
	}
	// An edited profile reaches the model on the next sync.
	for index := range profiles {
		if profiles[index].ID == "grok" {
			profiles[index].Rules.TierField = "res"
		}
	}
	if changed, _ := embedImageParamRules(&cfg, profiles); !changed || cfg.Models[0].Compat.ImageParamRules.TierField != "res" {
		t.Fatal("profile edit not propagated")
	}
	// A removed profile still in use is an error.
	if _, err := embedImageParamRules(&cfg, profiles[:1]); err == nil {
		t.Fatal("missing profile should fail")
	}
}

func TestValidateImageParamRules(t *testing.T) {
	bad := map[string]ImageParamRules{
		"mode":      {SizeMode: "pixels", QualityMode: ImageQualitySend},
		"tier":      {SizeMode: ImageSizeModeAspectTier, AspectField: "aspect_ratio", QualityMode: ImageQualitySend},
		"tier name": {SizeMode: ImageSizeModeAspectTier, AspectField: "aspect_ratio", TierField: "r", TierValues: map[string]string{"8K": "8k"}, QualityMode: ImageQualitySend},
		"protected": {SizeMode: ImageSizeModeAspect, AspectField: "prompt", QualityMode: ImageQualitySend},
		"map":       {SizeMode: ImageSizeModeSize, QualityMode: ImageQualityMap},
		"drop":      {SizeMode: ImageSizeModeSize, QualityMode: ImageQualitySend, Drop: []string{"model"}},
	}
	for name, rules := range bad {
		if err := validateImageParamRules("档案", rules); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}
