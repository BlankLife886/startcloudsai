package upstreamcompat

import (
	"encoding/json"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func profileRules(t *testing.T, id string) modelconfig.ImageParamRules {
	t.Helper()
	profile, ok := modelconfig.FindImageParamProfile(modelconfig.DefaultImageParamProfiles(), id)
	if !ok {
		t.Fatalf("missing profile %s", id)
	}
	return profile.Rules
}

func rewriteWith(t *testing.T, rules modelconfig.ImageParamRules, body string) map[string]any {
	t.Helper()
	compat := &modelconfig.RequestCompat{ImageParams: "x", ImageParamRules: &rules}
	var out map[string]any
	if err := json.Unmarshal(Rewrite([]byte(body), "/v1/images/generations", compat), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestGrokProfile(t *testing.T) {
	rules := profileRules(t, "grok")
	cases := []struct{ size, aspect, tier string }{
		{"1024x1024", "1:1", "1k"},
		{"1536x1024", "3:2", "1k"},
		{"2048x1152", "16:9", "2k"},
		{"3840x2160", "16:9", "2k"}, // no 4K: falls back to 2k
		{"1152x2048", "9:16", "2k"},
	}
	for _, tc := range cases {
		out := rewriteWith(t, rules, `{"model":"grok","prompt":"p","size":"`+tc.size+`","quality":"high","background":"opaque","output_format":"png","n":2}`)
		if out["aspect_ratio"] != tc.aspect || out["resolution"] != tc.tier {
			t.Errorf("%s → %v", tc.size, out)
		}
		for _, field := range []string{"size", "quality", "background", "output_format"} {
			if _, ok := out[field]; ok {
				t.Errorf("%s: %s should be removed: %v", tc.size, field, out)
			}
		}
		if out["n"] != float64(2) || out["prompt"] != "p" {
			t.Errorf("%s: kept fields changed: %v", tc.size, out)
		}
	}
}

func TestGeminiProfileUsesImageSize(t *testing.T) {
	out := rewriteWith(t, profileRules(t, "gemini"), `{"model":"g","prompt":"p","size":"3840x2160","quality":"auto"}`)
	if out["aspect_ratio"] != "16:9" || out["image_size"] != "4K" || out["quality"] != nil || out["size"] != nil {
		t.Fatalf("out = %v", out)
	}
}

func TestOpenAIProfileLeavesBodyAlone(t *testing.T) {
	out := rewriteWith(t, profileRules(t, "openai"), `{"model":"gpt-image-2","prompt":"p","size":"1536x1024","quality":"high","background":"opaque"}`)
	if out["size"] != "1536x1024" || out["quality"] != "high" || out["background"] != "opaque" {
		t.Fatalf("out = %v", out)
	}
}

func TestQualityMapAndExactRatio(t *testing.T) {
	rules := modelconfig.ImageParamRules{
		SizeMode: modelconfig.ImageSizeModeAspect, AspectField: "ratio",
		QualityMode: modelconfig.ImageQualityMap, QualityMap: map[string]string{"high": "hd", "medium": "standard"},
	}
	out := rewriteWith(t, rules, `{"prompt":"p","size":"1200x900","quality":"high"}`)
	if out["ratio"] != "4:3" || out["quality"] != "hd" {
		t.Fatalf("out = %v", out)
	}
	out = rewriteWith(t, rules, `{"prompt":"p","size":"1200x900","quality":"low"}`)
	if _, ok := out["quality"]; ok {
		t.Fatalf("unmapped quality should be dropped: %v", out)
	}
}
