package apicatalog

import (
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// catalogFixture: an offered image model, an offered chat model, a disabled
// older copy of that chat model, a disabled chat model with its own name, an
// enabled chat model not bound to the assistant, and a background-removal tool.
func catalogFixture() modelconfig.Config {
	provider := modelconfig.Provider{ID: "p", Name: "p", Adapter: modelconfig.AdapterOpenAI, BaseURL: "http://upstream.invalid", APIKey: "k", Enabled: true}
	image := modelconfig.Model{ID: "img", Name: "gpt-image-2", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindImage, PriceCents: 12, Public: true, Enabled: true, DeveloperAPI: true, DeveloperAPIMaxConcurrency: 4}
	chat := modelconfig.Model{ID: "chat-new", Name: "gpt-5.6-luna", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindChat, PriceCents: 10, Public: true, Enabled: true, DeveloperAPI: true}
	oldChat := modelconfig.Model{ID: "chat-old", Name: "gpt-5.6-luna", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindChat, PriceCents: 10, Enabled: false, DeveloperAPI: true}
	retired := modelconfig.Model{ID: "chat-retired", Name: "gpt-5-5", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindChat, PriceCents: 10, Enabled: false, DeveloperAPI: true}
	unbound := modelconfig.Model{ID: "chat-unbound", Name: "gpt-5.6-sol", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindChat, PriceCents: 10, Public: true, Enabled: true, DeveloperAPI: true}
	tool := modelconfig.Model{ID: "tool", Name: "背景移除", ProviderID: "p", UpstreamModel: "u", Kind: modelconfig.ModelKindImageTool, PriceCents: 5, Public: true, Enabled: true, DeveloperAPI: true}
	return modelconfig.Config{Providers: []modelconfig.Provider{provider}, Models: []modelconfig.Model{image, chat, oldChat, retired, unbound, tool},
		Workspaces: map[string]modelconfig.WorkspaceBinding{
			modelconfig.WorkspaceT2I:       {ModelIDs: []string{"img"}},
			modelconfig.WorkspaceAssistant: {ModelIDs: []string{"chat-new"}},
		}}
}

func entryFor(plan Plan, target string) *store.DeveloperAPIModel {
	for _, entry := range plan.Entries {
		if entry.TargetModelID == target {
			return entry
		}
	}
	return nil
}

func TestBuildPlanKeepsTodaysNamesAndDraftsTheRest(t *testing.T) {
	cfg := catalogFixture()
	keys := []MigrationKey{
		{ID: "k-all", Label: "all"},
		{ID: "k-mixed", Label: "mixed", AllowedModelIDs: []string{"img", "chat-old", "chat-retired", "tool", "gone"}},
		{ID: "k-draft", Label: "draft-only", AllowedModelIDs: []string{"chat-unbound"}},
	}
	plan := BuildPlan(cfg, keys, nil, time.Now())

	image, chat, draft := entryFor(plan, "img"), entryFor(plan, "chat-new"), entryFor(plan, "chat-unbound")
	if image == nil || image.APIName != "gpt-image-2" || image.Status != store.DeveloperAPIModelLive || image.MaxConcurrency != 4 || image.PublishedAt == nil {
		t.Fatalf("image entry = %+v", image)
	}
	if chat == nil || chat.APIName != "gpt-5.6-luna" || chat.Status != store.DeveloperAPIModelLive {
		t.Fatalf("chat entry = %+v", chat)
	}
	if draft == nil || draft.APIName != "gpt-5.6-sol" || draft.Status != store.DeveloperAPIModelDraft || draft.PublishedAt != nil {
		t.Fatalf("an enabled model not offered today becomes a draft: %+v", draft)
	}
	for _, target := range []string{"chat-old", "chat-retired", "tool"} {
		if entryFor(plan, target) != nil {
			t.Fatalf("%s must not get its own entry", target)
		}
	}
	if len(plan.Entries) != 3 || len(plan.Keys) != 2 {
		t.Fatalf("entries=%d keys=%d", len(plan.Entries), len(plan.Keys))
	}
	mixed, draftOnly := plan.Keys[0], plan.Keys[1]
	// The disabled older copy folds into the live model of the same name; the
	// disabled distinct model, the tool and the unknown id are dropped.
	if len(mixed.Mapped) != 2 || mixed.Mapped[0] != image.ID || mixed.Mapped[1] != chat.ID ||
		len(mixed.Merged) != 1 || mixed.Merged[0] != "chat-old" || len(mixed.Dropped) != 3 || mixed.NoneLive {
		t.Fatalf("mixed key = %+v", mixed)
	}
	if !draftOnly.NoneLive || len(draftOnly.Drafts) != 1 {
		t.Fatalf("a key left with only drafts is flagged: %+v", draftOnly)
	}
	report := plan.Report(cfg)
	for _, want := range []string{"上线（2 个）", "草稿（1 个）", "gpt-5.6-sol", "归并到同名上线模型", "迁移后仍无可调用模型", "背景移除", "gpt-5-5"} {
		if !strings.Contains(report, want) {
			t.Fatalf("report misses %q:\n%s", want, report)
		}
	}
}

func TestBuildPlanMapsSubscriptionScopes(t *testing.T) {
	cfg := catalogFixture()
	policies := []MigrationPolicy{
		{Table: "plans", ID: "open", Policy: store.DefaultSubscriptionPolicy()},
		{Table: "plans", ID: "t2i-only", Policy: store.SubscriptionPolicy{Channels: []string{"web", "api"}, FeatureKeys: []string{"text_to_image"}}},
		{Table: "subscriptions", ID: "img-only", Policy: store.SubscriptionPolicy{Channels: []string{"web", "api"}, ModelIDs: []string{"img"}}},
		{Table: "subscription_credit_lots", ID: "tool-only", Policy: store.SubscriptionPolicy{Channels: []string{"web", "api"}, ModelIDs: []string{"tool"}}},
		{Table: "plans", ID: "web-only", Policy: store.SubscriptionPolicy{Channels: []string{"web"}, ModelIDs: []string{"img"}}},
	}
	plan := BuildPlan(cfg, nil, policies, time.Now())
	byID := map[string]PolicyChange{}
	for _, change := range plan.Policies {
		byID[change.Source.ID] = change
	}
	if _, changed := byID["open"]; changed {
		t.Fatal("an unrestricted plan needs no rewrite")
	}
	if _, changed := byID["web-only"]; changed {
		t.Fatal("a web-only plan never pays for the API")
	}
	if got := byID["t2i-only"].Updated.FeatureKeys; !store.Contains(got, FeatureImage) || store.Contains(got, FeatureChat) {
		t.Fatalf("text-to-image plans keep paying for API images only: %v", got)
	}
	image := entryFor(plan, "img")
	imgOnly := byID["img-only"].Updated
	if len(imgOnly.APIModelIDs) != 1 || imgOnly.APIModelIDs[0] != image.ID || !imgOnly.Allows(FeatureImage, "api", image.ID) {
		t.Fatalf("model-restricted plan maps to the image entry: %+v", imgOnly)
	}
	if tool := byID["tool-only"]; !tool.DroppedAPI || tool.Updated.Allows(FeatureImage, "api", image.ID) {
		t.Fatalf("a plan scoped to non-API models covers no API model: %+v", tool)
	}
}

func TestNormalizeNameMatchesWireComparison(t *testing.T) {
	if NormalizeName(" GPT-5.6 ") != NormalizeName("gpt-5-6") {
		t.Fatal("names differing only by case, spaces or ./- are the same /v1 name")
	}
	if id := NewID(); !strings.HasPrefix(id, "apim_") || len(id) != 17 {
		t.Fatalf("NewID() = %q", id)
	}
}
