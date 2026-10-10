package taskflow_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/pricerules"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestDynamicPricingFollowsSubmissionTime(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user := newUserWithBalance(t, st, 1000)
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "main", Name: "Main", Adapter: "openai", BaseURL: "https://main.example.com", APIKey: "secret", Enabled: true}}
	cfg.Models = []modelconfig.Model{{
		ID: "gpt", Name: "GPT Image", ProviderID: "main", UpstreamModel: "gpt-image", Kind: modelconfig.ModelKindImage,
		PriceCents: 20, UpstreamCostCents: 4, Public: true, Default: true, Enabled: true, Resolutions: []string{"1K"},
	}}
	cfg.Workspaces = map[string]modelconfig.WorkspaceBinding{modelconfig.WorkspaceT2I: {ModelIDs: []string{"gpt"}}}
	if err := modelconfig.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if err := pricerules.Save(ctx, st.Pool, pricerules.Schedule{Enabled: true, Rules: []pricerules.Rule{
		{ID: "day", Name: "工作日白天", Kind: pricerules.KindWeekday, Enabled: true, StartTime: "09:00", EndTime: "17:00",
			Models: map[string]pricerules.Adjustment{"gpt": {Mode: pricerules.ModePercent, Value: -25}}},
		{ID: "peak", Name: "活动日", Kind: pricerules.KindDate, Enabled: true, StartAt: "2026-10-13T00:00", EndAt: "2026-10-14T00:00",
			Models: map[string]pricerules.Adjustment{"gpt": {Mode: pricerules.ModePoints, Value: 10}}},
		{ID: "night", Name: "深夜", Kind: pricerules.KindWeekday, Enabled: true, StartTime: "00:00", EndTime: "06:00",
			Models: map[string]pricerules.Adjustment{"gpt": {Mode: pricerules.ModePercent, Value: -95}}},
	}}); err != nil {
		t.Fatal(err)
	}
	at := func(value string) context.Context {
		when, err := time.ParseInLocation("2006-01-02 15:04", value, pricerules.Beijing)
		if err != nil {
			t.Fatal(err)
		}
		return store.WithBillingTime(ctx, when)
	}
	create := func(when string, expected int64) (*store.Task, error) {
		task, _, err := taskflow.CreateTask(at(when), st, user.ID, taskflow.CreateInput{
			Type: "t2i", Prompt: "dynamic", Count: 1, ExpectedUnitPriceCents: &expected,
			Params: map[string]any{"publicModelKey": "gpt"},
		})
		return task, err
	}

	// The user saw 20 before 09:00 and submitted after: the lower price wins.
	task, err := create("2026-10-12 09:00", 20)
	if err != nil {
		t.Fatal(err)
	}
	if task.CostCents != 15 {
		t.Fatalf("weekday daytime cost = %d", task.CostCents)
	}
	if task, err = create("2026-10-12 17:00", 20); err != nil || task.CostCents != 20 {
		t.Fatalf("after hours cost = %v err=%v", task, err)
	}
	// The date rule outranks the weekday rule; a higher price needs a new confirmation.
	if _, err = create("2026-10-13 10:00", 15); err == nil || !strings.Contains(err.Error(), "价格") {
		t.Fatalf("raised price must be reconfirmed: %v", err)
	}
	if task, err = create("2026-10-13 10:00", 30); err != nil || task.CostCents != 30 {
		t.Fatalf("date rule cost = %v err=%v", task, err)
	}
	// -95% would go below the upstream cost; the model does not allow that.
	if task, err = create("2026-10-12 03:00", 20); err != nil || task.CostCents != 4 {
		t.Fatalf("cost floor = %v err=%v", task, err)
	}
}
