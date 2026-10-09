package imageslots_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/imageslots"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func slotTestConfig(auto bool) modelconfig.Config {
	cfg := modelconfig.Empty()
	cfg.Providers = []modelconfig.Provider{{ID: "p", Name: "P", Adapter: modelconfig.AdapterOpenAI, BaseURL: "https://api.example.com", APIKey: "k", Enabled: true}}
	member := func(id string) modelconfig.Model {
		return modelconfig.Model{ID: id, Name: strings.ToUpper(id), ProviderID: "p", UpstreamModel: id, Kind: modelconfig.ModelKindImage, PriceCents: 10, Enabled: true, Resolutions: []string{"1K", "4K"}}
	}
	owner := member("gpt")
	owner.Public = true
	owner.ResolutionSlots = map[string]modelconfig.ResolutionSlot{
		"4K": {PrimaryModelID: "a", BackupModelIDs: []string{"b", "c"}, AutoFailover: auto},
	}
	cfg.Models = []modelconfig.Model{owner, member("a"), member("b"), member("c")}
	return cfg
}

type slotHarness struct {
	t   *testing.T
	st  *store.Store
	cfg modelconfig.Config
	now time.Time
}

func newHarness(t *testing.T, auto bool) *slotHarness {
	st := testdb.Setup(t)
	cfg := slotTestConfig(auto)
	if err := modelconfig.Validate(cfg); err != nil {
		t.Fatal(err)
	}
	if err := modelconfig.Save(context.Background(), st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	cfg, _ = modelconfig.Load(context.Background(), st.Pool)
	return &slotHarness{t: t, st: st, cfg: cfg, now: time.Now().UTC()}
}

func (h *slotHarness) tx(fn func(context.Context, pgx.Tx) error) {
	h.t.Helper()
	ctx := context.Background()
	if err := h.st.Tx(ctx, func(tx pgx.Tx) error { return fn(ctx, tx) }); err != nil {
		h.t.Fatal(err)
	}
}

func (h *slotHarness) outcome(member string, ok bool) {
	h.t.Helper()
	h.now = h.now.Add(time.Second)
	h.tx(func(ctx context.Context, tx pgx.Tx) error {
		return imageslots.RecordOutcome(ctx, tx, func() (modelconfig.Config, error) { return h.cfg, nil }, member, "4K", ok, "boom", h.now)
	})
}

func (h *slotHarness) plan() imageslots.Plan {
	h.t.Helper()
	plan, err := imageslots.PlanFor(context.Background(), h.st.Pool, h.cfg.Models[0], "4K")
	if err != nil {
		h.t.Fatal(err)
	}
	return plan
}

func (h *slotHarness) incident() *store.OperationalIncident {
	h.t.Helper()
	items, err := store.ListOpenOperationalIncidents(context.Background(), h.st.Pool, 100)
	if err != nil {
		h.t.Fatal(err)
	}
	for index := range items {
		if items[index].Key == "image_slot:gpt:4K" {
			return &items[index]
		}
	}
	return nil
}

func TestAutoFailoverSwitchesAfterThresholdAndBack(t *testing.T) {
	h := newHarness(t, true)
	if plan := h.plan(); !plan.Configured || plan.Active != "a" || strings.Join(plan.Candidates, ",") != "a,b,c" {
		t.Fatalf("initial plan = %#v", plan)
	}
	if plan, _ := imageslots.PlanFor(context.Background(), h.st.Pool, h.cfg.Models[0], "1K"); plan.Configured {
		t.Fatal("1K has no slot")
	}
	h.outcome("a", false)
	h.outcome("a", false)
	if plan := h.plan(); plan.Active != "a" {
		t.Fatalf("two failures must not switch yet: %#v", plan)
	}
	h.outcome("a", true) // a success resets the streak
	h.outcome("a", false)
	h.outcome("a", false)
	if plan := h.plan(); plan.Active != "a" {
		t.Fatalf("streak must restart after a success: %#v", plan)
	}
	h.outcome("a", false)
	plan := h.plan()
	if plan.Active != "b" || strings.Join(plan.Candidates, ",") != "b,c" {
		t.Fatalf("after 3 failures plan = %#v", plan)
	}
	if incident := h.incident(); incident == nil || incident.Severity != "warning" || !strings.Contains(incident.Title, "备用") {
		t.Fatalf("backup incident = %#v", incident)
	}

	// The backup fails as well: move on down the chain.
	for range 3 {
		h.outcome("b", false)
	}
	if plan := h.plan(); plan.Active != "c" {
		t.Fatalf("second failover plan = %#v", plan)
	}
	// Everything down: the slot stops taking work and alerts critically.
	for range 3 {
		h.outcome("c", false)
	}
	if plan := h.plan(); !plan.Unavailable || len(plan.Candidates) != 0 {
		t.Fatalf("all-down plan = %#v", plan)
	}
	if incident := h.incident(); incident == nil || incident.Severity != "critical" {
		t.Fatalf("all-down incident = %#v", incident)
	}
	unavailable, err := imageslots.UnavailableResolutions(context.Background(), h.st.Pool, h.cfg)
	if err != nil || strings.Join(unavailable["gpt"], ",") != "4K" {
		t.Fatalf("unavailable = %#v err=%v", unavailable, err)
	}

	// A probe brings the lower backup back first, then the primary: the slot
	// always uses the first healthy member.
	h.now = h.now.Add(2 * time.Hour)
	h.tx(func(ctx context.Context, tx pgx.Tx) error {
		return imageslots.RecordProbe(ctx, tx, h.cfg, imageslots.ProbeTarget{ModelID: "c", Resolution: "4K"}, true, "ok", h.now)
	})
	if plan := h.plan(); plan.Active != "c" || plan.Unavailable {
		t.Fatalf("after c recovers plan = %#v", plan)
	}
	h.tx(func(ctx context.Context, tx pgx.Tx) error {
		return imageslots.RecordProbe(ctx, tx, h.cfg, imageslots.ProbeTarget{ModelID: "a", Resolution: "4K"}, true, "ok", h.now)
	})
	if plan := h.plan(); plan.Active != "a" || strings.Join(plan.Candidates, ",") != "a,c" {
		t.Fatalf("after primary recovers plan = %#v", plan)
	}
	if incident := h.incident(); incident != nil {
		t.Fatalf("incident must resolve once back on primary: %#v", incident)
	}
	events, err := store.ListImageSlotEvents(context.Background(), h.st.Pool, 100)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, event := range events {
		kinds[event.Kind]++
	}
	if kinds[store.ImageSlotEventSwitch] < 3 || kinds[store.ImageSlotEventAllDown] != 1 || kinds[store.ImageSlotEventProbe] != 2 || kinds[store.ImageSlotEventMemberDown] != 3 {
		t.Fatalf("event kinds = %#v", kinds)
	}
}

func TestDueProbesRespectIntervalAndDailyBudget(t *testing.T) {
	h := newHarness(t, true)
	for _, member := range []string{"a", "b"} {
		for range 3 {
			h.outcome(member, false)
		}
	}
	ctx := context.Background()
	due, err := imageslots.DueProbes(ctx, h.st.Pool, h.cfg, h.now.Add(30*time.Minute))
	if err != nil || len(due) != 0 {
		t.Fatalf("nothing is due within the interval: %#v err=%v", due, err)
	}
	due, err = imageslots.DueProbes(ctx, h.st.Pool, h.cfg, h.now.Add(61*time.Minute))
	if err != nil || len(due) != 2 || due[0].ModelID != "a" {
		t.Fatalf("both down members are due: %#v err=%v", due, err)
	}
	// A failed probe pushes the next one a full interval out.
	h.tx(func(ctx context.Context, tx pgx.Tx) error {
		return imageslots.RecordProbe(ctx, tx, h.cfg, due[0], false, "still down", h.now.Add(61*time.Minute))
	})
	due, _ = imageslots.DueProbes(ctx, h.st.Pool, h.cfg, h.now.Add(62*time.Minute))
	if len(due) != 1 || due[0].ModelID != "b" {
		t.Fatalf("after a's probe only b is due: %#v", due)
	}
	// The 24-hour budget caps how many run.
	if err := settings.Set(ctx, h.st.Pool, "image_slot_probe_daily_limit", json.RawMessage(`1`)); err != nil {
		t.Fatal(err)
	}
	due, _ = imageslots.DueProbes(ctx, h.st.Pool, h.cfg, h.now.Add(62*time.Minute))
	if len(due) != 0 {
		t.Fatalf("budget of 1 is already spent: %#v", due)
	}
}

func TestManualSlotStaysPutAndSwitchesByHand(t *testing.T) {
	h := newHarness(t, false)
	if plan := h.plan(); plan.Active != "a" || strings.Join(plan.Candidates, ",") != "a" {
		t.Fatalf("manual plan = %#v", plan)
	}
	for range 3 {
		h.outcome("a", false)
	}
	plan := h.plan()
	if !plan.Unavailable || plan.Active != "a" {
		t.Fatalf("manual mode must not switch on its own: %#v", plan)
	}
	if incident := h.incident(); incident == nil || incident.Severity != "critical" || !strings.Contains(incident.Summary, "手动切换") {
		t.Fatalf("manual incident = %#v", incident)
	}
	h.tx(func(ctx context.Context, tx pgx.Tx) error {
		return imageslots.SwitchManual(ctx, tx, h.cfg, "gpt", "4K", "c", h.now)
	})
	if plan := h.plan(); plan.Active != "c" || plan.Unavailable || strings.Join(plan.Candidates, ",") != "c" {
		t.Fatalf("after manual switch plan = %#v", plan)
	}
	if incident := h.incident(); incident != nil {
		t.Fatalf("incident must resolve after manual switch: %#v", incident)
	}
	ctx := context.Background()
	if err := h.st.Tx(ctx, func(tx pgx.Tx) error { return imageslots.SwitchManual(ctx, tx, h.cfg, "gpt", "4K", "ghost", h.now) }); err == nil {
		t.Fatal("a model outside the slot must be rejected")
	}
}

func TestSwitchManualRejectsAutoSlotAndUnknownMember(t *testing.T) {
	h := newHarness(t, true)
	ctx := context.Background()
	err := h.st.Tx(ctx, func(tx pgx.Tx) error { return imageslots.SwitchManual(ctx, tx, h.cfg, "gpt", "4K", "b", h.now) })
	if err == nil || !strings.Contains(err.Error(), "自动切换") {
		t.Fatalf("auto slot manual switch err = %v", err)
	}
}

func TestFailedProbesCountTowardThreshold(t *testing.T) {
	h := newHarness(t, true)
	for range 2 {
		h.now = h.now.Add(time.Second)
		h.tx(func(ctx context.Context, tx pgx.Tx) error {
			return imageslots.RecordProbe(ctx, tx, h.cfg, imageslots.ProbeTarget{ModelID: "b", Resolution: "4K"}, false, "no accounts", h.now)
		})
	}
	if plan := h.plan(); strings.Join(plan.Candidates, ",") != "a,b,c" {
		t.Fatalf("two failed probes must not take b out: %#v", plan)
	}
	h.outcome("b", false)
	if plan := h.plan(); strings.Join(plan.Candidates, ",") != "a,c" {
		t.Fatalf("probe failures plus a task failure reach the threshold: %#v", plan)
	}
}
