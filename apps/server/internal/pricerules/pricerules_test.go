package pricerules

import (
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func ptr(value int64) *int64 { return &value }

// beijing 构造北京时间的时刻；2026-10-12 是周一，2026-10-17 是周六。
func beijing(value string) time.Time {
	at, err := time.ParseInLocation("2006-01-02 15:04", value, Beijing)
	if err != nil {
		panic(err)
	}
	return at.UTC()
}

func testSchedule() Schedule {
	return Schedule{
		Enabled: true,
		Rules: []Rule{
			{ID: "wd", Name: "工作日白天", Kind: KindWeekday, Enabled: true, StartTime: "09:00", EndTime: "17:00",
				Models: map[string]Adjustment{"a": {Mode: ModePercent, Value: 20}, "b": {Mode: ModePercent, Value: 10}}},
			{ID: "we", Name: "周末", Kind: KindWeekend, Enabled: true, StartTime: "00:00", EndTime: "24:00",
				Models: map[string]Adjustment{"a": {Mode: ModePercent, Value: -30}}},
			{ID: "nd", Name: "国庆", Kind: KindDate, Enabled: true, StartAt: "2026-10-13T00:00", EndAt: "2026-10-14T00:00",
				Models: map[string]Adjustment{"a": {Mode: ModePoints, Value: 0}}},
		},
	}
}

func TestActiveForUsesBeijingTimeAndBoundaries(t *testing.T) {
	schedule := testSchedule()
	cases := []struct {
		at   string
		want map[string]string
	}{
		{"2026-10-12 08:59", map[string]string{}},
		{"2026-10-12 09:00", map[string]string{"a": "wd", "b": "wd"}},
		{"2026-10-12 16:59", map[string]string{"a": "wd", "b": "wd"}},
		{"2026-10-12 17:00", map[string]string{}},
		{"2026-10-17 03:00", map[string]string{"a": "we"}},
		// 指定日期优先于工作日，但只对它列出的模型；b 仍按工作日规则。
		{"2026-10-13 10:00", map[string]string{"a": "nd", "b": "wd"}},
	}
	for _, tc := range cases {
		got := ActiveFor(schedule, beijing(tc.at))
		if len(got) != len(tc.want) {
			t.Fatalf("%s: got %v, want %v", tc.at, got, tc.want)
		}
		for modelID, ruleID := range tc.want {
			if got[modelID].RuleID != ruleID {
				t.Fatalf("%s: model %s got rule %q, want %q", tc.at, modelID, got[modelID].RuleID, ruleID)
			}
		}
	}
	// 16:59 北京时间 = 08:59 UTC，结束时间要按北京时间给出。
	if end := ActiveFor(schedule, beijing("2026-10-12 10:00"))["a"].EndsAt; !end.Equal(beijing("2026-10-12 17:00")) {
		t.Fatalf("ends at %s", end)
	}
}

func TestActiveForSkipsDisabledRulesAndSchedule(t *testing.T) {
	schedule := testSchedule()
	schedule.Rules[0].Enabled = false
	if got := ActiveFor(schedule, beijing("2026-10-12 10:00")); len(got) != 0 {
		t.Fatalf("disabled rule applied: %v", got)
	}
	schedule = testSchedule()
	schedule.Enabled = false
	if got := ActiveFor(schedule, beijing("2026-10-12 10:00")); len(got) != 0 {
		t.Fatalf("disabled schedule applied: %v", got)
	}
}

func TestNextChange(t *testing.T) {
	schedule := testSchedule()
	if next := NextChange(schedule, beijing("2026-10-12 08:00")); !next.Equal(beijing("2026-10-12 09:00")) {
		t.Fatalf("next = %s", next.In(Beijing))
	}
	if next := NextChange(schedule, beijing("2026-10-16 18:00")); !next.Equal(beijing("2026-10-17 00:00")) {
		t.Fatalf("next = %s", next.In(Beijing))
	}
}

func TestApplyRoundsAndKeepsFloors(t *testing.T) {
	model := modelconfig.Model{}
	if got := Apply(15, Adjustment{Mode: ModePercent, Value: -10}, model, 0); got != 14 { // 13.5 → 14
		t.Fatalf("percent rounding = %d", got)
	}
	if got := Apply(10, Adjustment{Mode: ModePercent, Value: 25}, model, 0); got != 13 { // 12.5 → 13
		t.Fatalf("raise = %d", got)
	}
	if got := Apply(2, Adjustment{Mode: ModePoints, Value: -5}, model, 0); got != 1 {
		t.Fatalf("zero floor = %d", got)
	}
	if got := Apply(20, Adjustment{Mode: ModePercent, Value: -90}, model, 8); got != 8 {
		t.Fatalf("cost floor = %d", got)
	}
	free := modelconfig.Model{AllowZeroPrice: true, AllowLossLeader: true}
	if got := Apply(20, Adjustment{Mode: ModePoints, Value: -50}, free, 8); got != 0 {
		t.Fatalf("allowed zero = %d", got)
	}
	// 原价已低于成本（管理员允许过）时不会因为底线被抬高。
	if got := Apply(5, Adjustment{Mode: ModePercent, Value: -50}, model, 8); got != 5 {
		t.Fatalf("below-cost original = %d", got)
	}
}

func TestApplyToConfigAdjustsEveryPriceOfTheModel(t *testing.T) {
	cfg := modelconfig.Config{
		Models: []modelconfig.Model{
			{ID: "a", PriceCents: 20, DiscountPriceCents: ptr(16), UpstreamCostCents: 2,
				ImagePricing: map[string]map[string]modelconfig.ImageTierPrice{
					"1K": {"low": {PriceCents: 10, UpstreamCostCents: 1}, "high": {PriceCents: 30, DiscountPriceCents: ptr(25), UpstreamCostCents: 3}},
				}},
			{ID: "b", PriceCents: 10},
			{ID: "c", PriceCents: 40},
		},
		Workspaces: map[string]modelconfig.WorkspaceBinding{
			modelconfig.WorkspaceT2I: {ModelPricing: map[string]modelconfig.WorkspaceModelPricing{"a": {PriceCents: 50}, "c": {PriceCents: 45}}},
		},
	}
	original := cfg.Models[0].ImagePricing["1K"]["low"]
	schedule := Schedule{Enabled: true, Rules: []Rule{{
		ID: "r", Name: "r", Kind: KindWeekday, Enabled: true, StartTime: "00:00", EndTime: "24:00",
		Models: map[string]Adjustment{"a": {Mode: ModePercent, Value: -50}, "b": {Mode: ModePercent, Value: 50}, "gone": {Mode: ModePercent, Value: -10}},
	}}}
	active := ApplyToConfig(&cfg, schedule, beijing("2026-10-12 10:00"))
	if _, ok := active["gone"]; ok || len(active) != 2 {
		t.Fatalf("active = %v", active)
	}
	a := cfg.Models[0]
	if a.PriceCents != 20 || a.DiscountPriceCents == nil || *a.DiscountPriceCents != 8 {
		t.Fatalf("flat price = %d/%v", a.PriceCents, a.DiscountPriceCents)
	}
	if cell := a.ImagePricing["1K"]["low"]; cell.PriceCents != 10 || *cell.DiscountPriceCents != 5 {
		t.Fatalf("low cell = %+v", cell)
	}
	if cell := a.ImagePricing["1K"]["high"]; *cell.DiscountPriceCents != 13 { // 25 × 0.5 = 12.5 → 13
		t.Fatalf("high cell = %+v", cell)
	}
	if original.DiscountPriceCents != nil {
		t.Fatal("source matrix cell was mutated")
	}
	if price := modelconfig.ResolveWorkspacePrice(cfg, modelconfig.WorkspaceT2I, a); price.EffectiveCents != 25 {
		t.Fatalf("workspace price = %d", price.EffectiveCents)
	}
	if price := modelconfig.ResolveWorkspacePrice(cfg, modelconfig.WorkspaceT2I, cfg.Models[2]); price.EffectiveCents != 45 {
		t.Fatalf("untouched model workspace price = %d", price.EffectiveCents)
	}
	// 涨价：标准价变成新价，没有折扣。
	if b := cfg.Models[1]; b.PriceCents != 15 || b.DiscountPriceCents != nil {
		t.Fatalf("raised = %d/%v", b.PriceCents, b.DiscountPriceCents)
	}
	if c := cfg.Models[2]; c.PriceCents != 40 || c.DiscountPriceCents != nil {
		t.Fatalf("model outside rule changed: %+v", c)
	}
}

func TestSubscriberPrice(t *testing.T) {
	model := modelconfig.Model{ID: "a"}
	schedule := Schedule{Subscriber: SubscriberDiscount{Enabled: true, Models: map[string]Adjustment{"a": {Mode: ModePercent, Value: 10}}}}
	if got := SubscriberPrice(schedule, model, 20, 0); got != 18 {
		t.Fatalf("percent = %d", got)
	}
	schedule.Subscriber.Models["a"] = Adjustment{Mode: ModePoints, Value: 3}
	if got := SubscriberPrice(schedule, model, 20, 0); got != 17 {
		t.Fatalf("points = %d", got)
	}
	if got := SubscriberPrice(schedule, modelconfig.Model{ID: "b"}, 20, 0); got != 20 {
		t.Fatalf("unlisted model = %d", got)
	}
	schedule.Subscriber.Enabled = false
	if got := SubscriberPrice(schedule, model, 20, 0); got != 20 {
		t.Fatalf("disabled = %d", got)
	}
}

func TestValidate(t *testing.T) {
	cfg := modelconfig.Config{Models: []modelconfig.Model{{ID: "a", Name: "A"}}}
	valid := Schedule{Rules: []Rule{{ID: "r", Name: "白天", Kind: KindWeekday, StartTime: "09:00", EndTime: "17:00", Models: map[string]Adjustment{"a": {Mode: ModePercent, Value: -20}}}},
		Subscriber: SubscriberDiscount{Models: map[string]Adjustment{"a": {Mode: ModePoints, Value: 2}}}}
	if err := Validate(valid, cfg); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*Schedule){
		"结束时间须晚于开始时间": func(s *Schedule) { s.Rules[0].EndTime = "08:00" },
		"HH:MM":       func(s *Schedule) { s.Rules[0].StartTime = "9:00" },
		"不存在":         func(s *Schedule) { s.Rules[0].Models["x"] = Adjustment{Mode: ModePercent, Value: 1} },
		"调价百分比":       func(s *Schedule) { s.Rules[0].Models["a"] = Adjustment{Mode: ModePercent, Value: -99} },
		"订阅优惠积分":      func(s *Schedule) { s.Subscriber.Models["a"] = Adjustment{Mode: ModePoints, Value: -1} },
		"日期时间":        func(s *Schedule) { s.Rules[0].Kind = KindDate },
		"重复":          func(s *Schedule) { s.Rules = append(s.Rules, s.Rules[0]) },
	}
	for want, mutate := range cases {
		schedule := Schedule{Rules: []Rule{valid.Rules[0]}, Subscriber: SubscriberDiscount{Models: map[string]Adjustment{"a": {Mode: ModePoints, Value: 2}}}}
		schedule.Rules[0].Models = map[string]Adjustment{"a": {Mode: ModePercent, Value: -20}}
		mutate(&schedule)
		if err := Validate(schedule, cfg); err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("%s: got %v", want, err)
		}
	}
}

func TestRaisingADiscountedPriceDropsTheStrikethrough(t *testing.T) {
	standard, discount := adjustPair(20, ptr(16), Adjustment{Mode: ModePercent, Value: 10}, modelconfig.Model{}, 0)
	if standard != 18 || discount != nil { // 16 × 1.1 = 17.6 → 18
		t.Fatalf("raised = %d/%v", standard, discount)
	}
	standard, discount = adjustPair(20, ptr(16), Adjustment{Mode: ModePercent, Value: -50}, modelconfig.Model{}, 0)
	if standard != 20 || discount == nil || *discount != 8 {
		t.Fatalf("lowered = %d/%v", standard, discount)
	}
}
