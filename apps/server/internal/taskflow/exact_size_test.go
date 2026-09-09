package taskflow_test

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestExactSizeTaskSubmissionPreservesPixelsAndLegacyCompatibility(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 100)
	cfg := modelconfig.Empty()
	limits := modelconfig.DefaultExactSizeLimits()
	limits.MaxWidth = 8192
	cfg.Providers = []modelconfig.Provider{{ID: "provider", Name: "Provider", Adapter: "openai", BaseURL: "https://api.example.com", APIKey: "secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{
		{ID: "exact", Name: "Exact", ProviderID: "provider", UpstreamModel: "exact-image", Kind: "image", PriceCents: 20, Public: true, Default: true, Enabled: true, SupportsExactSize: true, ExactSizeLimits: &limits},
		{ID: "legacy", Name: "Legacy", ProviderID: "provider", UpstreamModel: "legacy-image", Kind: "image", PriceCents: 20, Public: true, Enabled: true},
	}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	input := taskflow.CreateInput{Type: "t2i", Prompt: "精确海报", Count: 1, Params: map[string]any{
		"publicModelKey": "exact", "sizeMode": "exact", "exactWidth": 6001, "exactHeight": 777,
		"resolutionScale": "4K", "aspectRatio": "auto", "size": "1024x1024",
	}}
	if _, err := taskflow.QuoteTaskPrice(ctx, st.Pool, input); err != nil {
		t.Fatal(err)
	}
	task, _, err := taskflow.CreateTask(ctx, st, user.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if task.Params["size"] != "6001x777" || task.Params["outputSize"] != "6001x777" || task.Params["sizeMode"] != "exact" {
		t.Fatalf("exact params = %#v", task.Params)
	}
	if _, exists := task.Params["resolutionScale"]; exists {
		t.Fatal("resolution could override exact task dimensions")
	}
	input.Params["publicModelKey"] = "legacy"
	if _, err := taskflow.QuoteTaskPrice(ctx, st.Pool, input); err == nil {
		t.Fatal("unsupported exact quote succeeded")
	}
	if _, _, err := taskflow.CreateTask(ctx, st, user.ID, input); err == nil {
		t.Fatal("unsupported exact submission succeeded")
	}
	legacy, _, err := taskflow.CreateTask(ctx, st, user.ID, taskflow.CreateInput{Type: "t2i", Prompt: "旧画布请求", Count: 1, Params: map[string]any{"publicModelKey": "legacy", "size": "1024x1792", "outputSize": "1024x1792"}})
	if err != nil || legacy.Params["size"] != "1024x1792" {
		t.Fatalf("legacy request changed: task=%#v err=%v", legacy, err)
	}
}
