package taskflow_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/executionconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/imageslots"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func saveTieredSlotConfig(t *testing.T, save func(modelconfig.Config) error) modelconfig.Config {
	t.Helper()
	matrix := map[string]map[string]modelconfig.ImageTierPrice{}
	for r, resolution := range []string{"1K", "2K", "4K"} {
		row := map[string]modelconfig.ImageTierPrice{}
		for q, quality := range []string{"low", "medium", "high"} {
			row[quality] = modelconfig.ImageTierPrice{PriceCents: int64(10 * (r + 1) * (q + 1)), UpstreamCostCents: 1}
		}
		matrix[resolution] = row
	}
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{
		{ID: "main", Name: "Main", Adapter: "openai", BaseURL: "https://main.example.com", APIKey: "secret", Enabled: true},
		{ID: "spare", Name: "Spare", Adapter: "openai", BaseURL: "https://spare.example.com", APIKey: "secret", Enabled: true},
	}
	cfg.Models = []modelconfig.Model{
		{
			ID: "gpt", Name: "GPT Image", ProviderID: "main", UpstreamModel: "gpt-image", Kind: modelconfig.ModelKindImage,
			PriceCents: 10, Public: true, Default: true, Enabled: true, Resolutions: []string{"1K", "2K", "4K"},
			ImagePricing: matrix,
			ResolutionSlots: map[string]modelconfig.ResolutionSlot{
				"4K": {PrimaryModelID: "gpt", BackupModelIDs: []string{"spare-4k"}, AutoFailover: true},
			},
		},
		{
			ID: "spare-4k", Name: "Spare 4K", ProviderID: "spare", UpstreamModel: "spare-image", Kind: modelconfig.ModelKindImage,
			PriceCents: 1, Enabled: true, Resolutions: []string{"4K"},
		},
	}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {ModelIDs: []string{"gpt"}}}
	if err := save(cfg); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestTieredPricingQuotesAndBillsTheChosenCell(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 1000)
	saveTieredSlotConfig(t, func(cfg modelconfig.Config) error { return modelconfig.Save(ctx, st.Pool, cfg) })

	quote := func(params map[string]any) int64 {
		t.Helper()
		params["publicModelKey"] = "gpt"
		q, err := taskflow.QuoteTaskPrice(ctx, st.Pool, taskflow.CreateInput{Type: "t2i", Count: 1, Params: params})
		if err != nil {
			t.Fatal(err)
		}
		return q.UnitPriceCents
	}
	if got := quote(map[string]any{"resolution": "4K", "quality": "high"}); got != 90 {
		t.Fatalf("4K high quote = %d", got)
	}
	if got := quote(map[string]any{"resolution": "2K"}); got != 40 {
		t.Fatalf("2K without quality bills the default medium cell: %d", got)
	}
	if got := quote(map[string]any{}); got != 20 {
		t.Fatalf("no resolution or quality bills 1K medium: %d", got)
	}

	task, _, err := taskflow.CreateTask(ctx, st, user.ID, taskflow.CreateInput{
		Type: "t2i", Prompt: "tiered", Count: 2,
		Params: map[string]any{"publicModelKey": "gpt", "resolution": "2K"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.CostCents != 80 || task.Params["quality"] != "medium" || task.Params["_billingResolution"] != "2K" || task.Params["_billingQuality"] != "medium" {
		t.Fatalf("2K task cost=%d params=%#v", task.CostCents, task.Params)
	}
	if _, ok := task.Params["_slotModelIds"]; ok {
		t.Fatal("2K has no slot and must keep the model's own routes")
	}
}

func TestResolutionSlotRoutesTaskAndRejectsWhenAllDown(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 1000)
	cfg := saveTieredSlotConfig(t, func(cfg modelconfig.Config) error { return modelconfig.Save(ctx, st.Pool, cfg) })

	create := func(resolution string) (map[string]any, error) {
		task, _, err := taskflow.CreateTask(ctx, st, user.ID, taskflow.CreateInput{
			Type: "t2i", Prompt: "slot", Count: 1,
			Params: map[string]any{"publicModelKey": "gpt", "resolution": resolution, "quality": "low"},
		})
		if err != nil {
			return nil, err
		}
		snapshot, err := executionconfig.Ensure(ctx, st.Pool, executionconfig.Task, task.ID, task.Params)
		if err != nil {
			t.Fatal(err)
		}
		order := []string{}
		for _, candidate := range snapshot.CandidatesFor("task") {
			order = append(order, candidate.Model.ID)
		}
		task.Params["_candidateOrder"] = strings.Join(order, ",")
		return task.Params, nil
	}
	params, err := create("4K")
	if err != nil {
		t.Fatal(err)
	}
	if params["_slotModelId"] != "gpt" || params["_slotResolution"] != "4K" || fmt.Sprint(params["_slotModelIds"]) != "[gpt spare-4k]" ||
		params["_candidateOrder"] != "gpt,spare-4k" {
		t.Fatalf("4K slot params = %#v", params)
	}

	record := func(member string) {
		for range 3 {
			if err := st.Tx(ctx, func(tx pgx.Tx) error {
				return imageslots.RecordOutcome(ctx, tx, func() (modelconfig.Config, error) { return cfg, nil }, member, "4K", false, "down", time.Now().UTC())
			}); err != nil {
				t.Fatal(err)
			}
		}
	}
	record("gpt")
	if params, err = create("4K"); err != nil || fmt.Sprint(params["_slotModelIds"]) != "[spare-4k]" || params["_candidateOrder"] != "spare-4k" {
		t.Fatalf("after primary down params=%#v err=%v", params, err)
	}
	record("spare-4k")
	_, err = create("4K")
	mustAppErr(t, err, "resolution_unavailable")
	if _, err := create("1K"); err != nil {
		t.Fatalf("other resolutions keep working: %v", err)
	}
}
