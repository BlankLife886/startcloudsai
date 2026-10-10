package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/executionconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/imageslots"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// A direct assistant image run bills its resolution × quality cell and runs on
// the resolution slot's members in order; a slot with every member down turns
// the run away before anything is charged.
func TestAssistantImageRunUsesTierPriceAndResolutionSlot(t *testing.T) {
	env, _, token, cfg := newExecutionAdmissionEnv(t)
	ctx := context.Background()
	image := &cfg.Models[0]
	image.Resolutions = []string{"1K", "4K"}
	image.Qualities = []string{"low", "high"}
	image.ImagePricing = map[string]map[string]modelconfig.ImageTierPrice{
		"1K": {"low": {PriceCents: 3}, "high": {PriceCents: 6}},
		"4K": {"low": {PriceCents: 9}, "high": {PriceCents: 12}},
	}
	image.ResolutionSlots = map[string]modelconfig.ResolutionSlot{
		"4K": {PrimaryModelID: "image", BackupModelIDs: []string{"spare"}, AutoFailover: true},
	}
	cfg.Models = append(cfg.Models, modelconfig.Model{
		ID: "spare", Name: "Spare", ProviderID: "provider", Kind: modelconfig.ModelKindImage, UpstreamModel: "image-b",
		PriceCents: 1, MaxImages: 4, Enabled: true, Resolutions: []string{"4K"}, Qualities: []string{"low", "high"},
	})
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	conversation, _ := decode(t, env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "Tiers"}, token))
	create := func(key, resolution, quality string) (*store.AssistantRun, int, string) {
		t.Helper()
		created := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
			"conversationId": conversation["id"], "prompt": "一只猫", "mode": "image", "model": "image", "count": 2,
			"queue": true, "idempotencyKey": key, "resolution": resolution, "quality": quality,
		}, token)
		if created.Code != http.StatusCreated {
			return nil, created.Code, created.Body.String()
		}
		data, _ := decode(t, created)
		run, err := store.GetAssistantRun(ctx, env.st.Pool, uuid.MustParse(data["run"].(map[string]any)["id"].(string)))
		if err != nil {
			t.Fatal(err)
		}
		return run, created.Code, ""
	}

	run, code, body := create("tier-4k-low", "4K", "low")
	if run == nil {
		t.Fatalf("4K low: %d %s", code, body)
	}
	if fmt.Sprint(run.Params["_imageCostCents"]) != "18" || run.Params["_billingResolution"] != "4K" || run.Params["_billingQuality"] != "low" {
		t.Fatalf("4K low pricing params = %#v", run.Params)
	}
	if run.Params["_imageSlotResolution"] != "4K" || fmt.Sprint(run.Params["_imageSlotModelIds"]) != "[image spare]" {
		t.Fatalf("4K slot params = %#v", run.Params)
	}
	snapshot, err := executionconfig.Ensure(ctx, env.st.Pool, executionconfig.Assistant, run.ID, run.Params)
	if err != nil {
		t.Fatal(err)
	}
	order := []string{}
	for _, candidate := range snapshot.CandidatesFor("image") {
		order = append(order, candidate.Model.ID)
	}
	if fmt.Sprint(order) != "[image spare]" {
		t.Fatalf("image candidates = %v", order)
	}

	if run, code, body = create("tier-1k-high", "1K", "high"); run == nil || fmt.Sprint(run.Params["_imageCostCents"]) != "12" {
		t.Fatalf("1K high: %d %s %#v", code, body, run)
	}
	if _, slotted := run.Params["_imageSlotModelIds"]; slotted {
		t.Fatal("1K has no slot")
	}

	for _, member := range []string{"image", "spare"} {
		for range 3 {
			if err := env.st.Tx(ctx, func(tx pgx.Tx) error {
				return imageslots.RecordOutcome(ctx, tx, func() (modelconfig.Config, error) { return cfg, nil }, member, "4K", false, "down", time.Now().UTC())
			}); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, code, body = create("tier-4k-down", "4K", "high"); code != http.StatusServiceUnavailable {
		t.Fatalf("all-down 4K = %d %s", code, body)
	}
}
