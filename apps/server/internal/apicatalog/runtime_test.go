package apicatalog

import (
	"errors"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func runtimeFixture() ([]*store.DeveloperAPIModel, modelconfig.Config) {
	cfg := catalogFixture()
	fixed := int64(7)
	entries := []*store.DeveloperAPIModel{
		{ID: "apim_img", APIName: "gpt-image-2", Aliases: []string{"image-legacy"}, Kind: "image", TargetModelID: "img", Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFollow},
		{ID: "apim_fixed", APIName: "gpt-image-2-vip", Kind: "image", TargetModelID: "img", Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFixed, PriceCents: &fixed},
		{ID: "apim_chat", APIName: "gpt-5-5", Kind: "chat", TargetModelID: "chat-new", Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFollow},
		{ID: "apim_draft", APIName: "gpt-5.6-sol", Kind: "chat", TargetModelID: "chat-unbound", Status: store.DeveloperAPIModelDraft, PriceMode: store.DeveloperAPIPriceFollow},
		{ID: "apim_down", APIName: "old-luna", Kind: "chat", TargetModelID: "chat-old", Status: store.DeveloperAPIModelLive, PriceMode: store.DeveloperAPIPriceFollow},
	}
	return entries, cfg
}

// A caller gets the model it named, or nothing: no internal-ID match, no
// default model, no family substitution, and no cross-kind match.
func TestMatchHasNoFallback(t *testing.T) {
	entries, cfg := runtimeFixture()
	now := time.Now()
	for requested, want := range map[string]string{"gpt-5.5": "apim_chat", "GPT-5-5": "apim_chat"} {
		if got, err := Match(entries, cfg, nil, "chat", requested, now); err != nil || got.Entry.ID != want {
			t.Fatalf("chat %q = %+v, %v", requested, got, err)
		}
	}
	if got, err := Match(entries, cfg, nil, "image", " image-legacy ", now); err != nil || got.Entry.ID != "apim_img" {
		t.Fatalf("alias match = %+v, %v", got, err)
	}
	for _, requested := range []string{"", "apim_chat", "chat-new", "gpt-5-6", "gpt-image-2"} {
		if got, err := Match(entries, cfg, nil, "chat", requested, now); !errors.Is(err, ErrNotFound) {
			t.Fatalf("chat %q matched %+v", requested, got)
		}
	}
	if _, err := Match(entries, cfg, nil, "chat", "gpt-5.6-sol", now); !errors.Is(err, ErrNotFound) {
		t.Fatal("a draft is not callable")
	}
	if _, err := Match(entries, cfg, []string{"apim_img"}, "chat", "gpt-5-5", now); !errors.Is(err, ErrNotFound) {
		t.Fatal("a Key allowlist hides other models")
	}
	if got, err := Match(entries, cfg, nil, "chat", "old-luna", now); !errors.Is(err, ErrUnavailable) || got.Entry.ID != "apim_down" {
		t.Fatalf("a live entry whose site model is disabled is unavailable, not missing: %+v %v", got, err)
	}
}

func TestOfferedAndPricing(t *testing.T) {
	entries, cfg := runtimeFixture()
	now := time.Now()
	offered := Offered(entries, cfg, nil, now)
	ids := []string{}
	for _, resolved := range offered {
		ids = append(ids, resolved.Entry.ID)
	}
	if len(ids) != 3 || ids[0] != "apim_img" || ids[1] != "apim_fixed" || ids[2] != "apim_chat" {
		t.Fatalf("offered = %v", ids)
	}
	if limited := Offered(entries, cfg, []string{"apim_chat"}, now); len(limited) != 1 || limited[0].Entry.ID != "apim_chat" {
		t.Fatalf("allowlist = %+v", limited)
	}
	// Two API models can point at one site model with different prices.
	if got := UnitPrice(cfg, offered[0], now); got != 12 {
		t.Fatalf("following entry takes the site price: %d", got)
	}
	if got := UnitPrice(cfg, offered[1], now); got != 7 {
		t.Fatalf("fixed entry uses its own price: %d", got)
	}
	discount := int64(9)
	cfg.Models[0].DiscountPriceCents = &discount
	if got := UnitPrice(cfg, Offered(entries, cfg, nil, now)[0], now); got != 9 {
		t.Fatalf("following entry takes the site discount: %d", got)
	}
}

func TestLifecycleStatuses(t *testing.T) {
	entries, cfg := runtimeFixture()
	now := time.Now()
	sunset, past := now.Add(72*time.Hour), now.Add(-time.Minute)
	replacement := "apim_chat"
	entries[0].Status, entries[0].SunsetAt, entries[0].ReplacementID = store.DeveloperAPIModelDeprecated, &sunset, nil
	entries[1].Status = store.DeveloperAPIModelMaintenance
	entries[2].Status = store.DeveloperAPIModelLive
	retired := &store.DeveloperAPIModel{ID: "apim_old", APIName: "gpt-5-4", Aliases: []string{"gpt-5-5"}, Kind: "chat", TargetModelID: "chat-new",
		Status: store.DeveloperAPIModelDeprecated, SunsetAt: &past, ReplacementID: &replacement, PriceMode: store.DeveloperAPIPriceFollow}
	entries = append(entries, retired)

	if got, err := Match(entries, cfg, nil, "image", "gpt-image-2", now); err != nil || got.Entry.ID != "apim_img" {
		t.Fatalf("a deprecated model stays callable before its sunset: %+v %v", got, err)
	}
	if _, err := Match(entries, cfg, nil, "image", "gpt-image-2-vip", now); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("maintenance is 503: %v", err)
	}
	if got, err := Match(entries, cfg, nil, "chat", "gpt-5-4", now); !errors.Is(err, ErrRetired) || got.Entry.ID != "apim_old" {
		t.Fatalf("a deprecated model past its sunset is retired even before the sweep: %+v %v", got, err)
	}
	if got, err := Match(entries, cfg, nil, "chat", "gpt-5-5", now); err != nil || got.Entry.ID != "apim_chat" {
		t.Fatalf("a live name wins over a retired alias: %+v %v", got, err)
	}
	if _, err := Match(entries, cfg, []string{"apim_img"}, "chat", "gpt-5-4", now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a retired model outside the Key allowlist is not found: %v", err)
	}

	statuses := map[string]string{}
	for _, listing := range Listed(entries, cfg, nil, now) {
		statuses[listing.Entry.ID] = listing.PublicStatus
	}
	want := map[string]string{"apim_img": PublicDeprecated, "apim_fixed": PublicMaintenance, "apim_chat": PublicLive, "apim_down": PublicMaintenance}
	if len(statuses) != len(want) {
		t.Fatalf("listed = %v", statuses)
	}
	for id, status := range want {
		if statuses[id] != status {
			t.Fatalf("listed = %v", statuses)
		}
	}
	if offered := Offered(entries, cfg, nil, now); len(offered) != 2 {
		t.Fatalf("offered only callable and runnable models: %d", len(offered))
	}
	long := now.Add(-RetiredHiddenAfter - time.Hour)
	retired.RetiredAt = &long
	for _, listing := range Visible(entries, cfg, now) {
		if listing.Entry.ID == "apim_old" || listing.Entry.ID == "apim_draft" {
			t.Fatalf("console hides drafts and models retired over 90 days ago: %s", listing.Entry.ID)
		}
	}
	recent := now.Add(-time.Hour)
	retired.RetiredAt = &recent
	found := false
	for _, listing := range Visible(entries, cfg, now) {
		found = found || (listing.Entry.ID == "apim_old" && listing.PublicStatus == PublicRetired)
	}
	if !found {
		t.Fatal("a recently retired model stays on the console")
	}
}

func TestScheduledPricing(t *testing.T) {
	now := time.Now()
	price := func(v int64) *int64 { return &v }
	follow := &store.DeveloperAPIModel{PriceMode: store.DeveloperAPIPriceFollow, CommittedPriceCents: price(10)}

	// Site price up: the committed price holds until the notice ends.
	if got := EffectivePrice(follow, 15, now); got != 10 {
		t.Fatalf("increase held back: %d", got)
	}
	if !SettlePrice(follow, 10, 15, true, now) || *follow.PendingPriceCents != 15 || !follow.PendingPriceAt.Equal(now.Add(PriceIncreaseNotice)) {
		t.Fatalf("increase announced: %+v", follow)
	}
	if got := EffectivePrice(follow, 15, now.Add(PriceIncreaseNotice)); got != 15 {
		t.Fatalf("increase applies after the notice: %d", got)
	}
	// A smaller rise than announced keeps the date and does not re-announce.
	at := *follow.PendingPriceAt
	if SettlePrice(follow, 10, 13, true, now.Add(time.Hour)) || *follow.PendingPriceCents != 13 || !follow.PendingPriceAt.Equal(at) {
		t.Fatalf("smaller increase: %+v", follow)
	}
	// A larger rise restarts the notice.
	if !SettlePrice(follow, 10, 20, true, now.Add(time.Hour)) || !follow.PendingPriceAt.Equal(now.Add(time.Hour+PriceIncreaseNotice)) {
		t.Fatalf("larger increase: %+v", follow)
	}
	// Site price down (a discount): applies at once and cancels the pending rise.
	if got := EffectivePrice(follow, 8, now); got != 8 {
		t.Fatalf("decrease applies at once: %d", got)
	}
	if SettlePrice(follow, 8, 8, true, now) || follow.PendingPriceCents != nil || *follow.CommittedPriceCents != 8 {
		t.Fatalf("decrease settled: %+v", follow)
	}
	// The discount ending is an increase like any other.
	if !SettlePrice(follow, 8, 10, true, now) || EffectivePrice(follow, 10, now) != 8 {
		t.Fatalf("discount end announced: %+v", follow)
	}

	fixed := &store.DeveloperAPIModel{PriceMode: store.DeveloperAPIPriceFixed, PriceCents: price(6)}
	if !SettlePrice(fixed, 6, 9, true, now) || *fixed.PriceCents != 6 || EffectivePrice(fixed, 0, now) != 6 || EffectivePrice(fixed, 0, now.Add(PriceIncreaseNotice)) != 9 {
		t.Fatalf("fixed increase is scheduled: %+v", fixed)
	}
	if SettlePrice(fixed, 6, 4, true, now) || *fixed.PriceCents != 4 || fixed.PendingPriceCents != nil {
		t.Fatalf("fixed decrease applies at once and cancels the increase: %+v", fixed)
	}
	draft := &store.DeveloperAPIModel{PriceMode: store.DeveloperAPIPriceFixed, PriceCents: price(6)}
	if SettlePrice(draft, 6, 9, false, now) || *draft.PriceCents != 9 {
		t.Fatalf("a model not in service changes price at once: %+v", draft)
	}
}

// Vendor-native adapters run synchronously behind the OpenAI shapes and can
// back /v1; CRUN is an asynchronous task protocol and cannot.
func TestRunnableAdapters(t *testing.T) {
	for adapter, want := range map[string]bool{
		modelconfig.AdapterOpenAI: true, modelconfig.AdapterGemini: true,
		modelconfig.AdapterDashScope: true, modelconfig.AdapterMiniMax: true,
		modelconfig.AdapterCRUN: false,
	} {
		cfg := catalogFixture()
		cfg.Providers[0].Adapter = adapter
		if _, got := Runnable(cfg, "img"); got != want {
			t.Errorf("adapter %q runnable = %v, want %v", adapter, got, want)
		}
	}
}
