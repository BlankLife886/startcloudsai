package statseval

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantv2"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	um "github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

var shanghai = time.FixedZone("CST", 8*3600)

// now is Thursday 2026-03-12 15:00 Beijing time.
var now = time.Date(2026, 3, 12, 15, 0, 0, 0, shanghai)

// idealArguments builds the call a perfect answer would make for a case.
func idealArguments(expect Expect) map[string]any {
	args := map[string]any{}
	if len(expect.Metrics) > 0 || len(expect.MetricsAny) > 0 {
		metrics := append([]um.Metric{}, expect.Metrics...)
		if len(expect.MetricsAny) > 0 {
			metrics = append(metrics, expect.MetricsAny[0])
		}
		args["metrics"] = metrics
	}
	dims := append([]um.Dimension{}, expect.Dimensions...)
	if len(expect.DimensionsAny) > 0 {
		dims = append(dims, expect.DimensionsAny[0])
	}
	if len(dims) > 0 {
		args["dimensions"] = dims
	}
	switch {
	case expect.Preset != "":
		args["timeRange"] = map[string]any{"preset": expect.Preset}
	case expect.LastDays > 0:
		args["timeRange"] = map[string]any{
			"from": now.AddDate(0, 0, -(expect.LastDays - 1)).Format("2006-01-02"),
			"to":   now.Format("2006-01-02"),
		}
	}
	if expect.Compare {
		args["compareToPrevious"] = true
	}
	if expect.RecordType != "" {
		args["type"] = expect.RecordType
	}
	if expect.Sort != "" {
		args["sort"] = expect.Sort
	}
	if len(expect.Filters) > 0 {
		if expect.Tool == toolOrders {
			for key, value := range expect.Filters {
				args[key] = value
			}
		} else {
			args["filters"] = expect.Filters
		}
	}
	return args
}

func TestBuiltinCasesAreWellFormed(t *testing.T) {
	registry, err := assistantv2.Registry(&store.Store{}, time.Now, false)
	if err != nil {
		t.Fatal(err)
	}
	tools := map[string]bool{}
	for _, name := range assistantv2.ToolsFor(registry) {
		tools[name] = true
	}
	categories := map[string]bool{}
	for _, category := range Categories {
		categories[category] = true
	}
	if len(BuiltinCases) < 50 || len(BuiltinCases) > 100 {
		t.Fatalf("case count = %d, want 50–100", len(BuiltinCases))
	}
	seen := map[string]bool{}
	for _, item := range BuiltinCases {
		if seen[item.ID] {
			t.Errorf("duplicate id %s", item.ID)
		}
		seen[item.ID] = true
		if !categories[item.Category] {
			t.Errorf("%s: unknown category %q", item.ID, item.Category)
		}
		if !tools[item.Expect.Tool] {
			t.Errorf("%s: tool %q is not exposed to v2", item.ID, item.Expect.Tool)
		}
		for _, name := range item.Expect.AlsoAccept {
			if !tools[name] {
				t.Errorf("%s: also-accepted tool %q is not exposed to v2", item.ID, name)
			}
		}
		raw, _ := json.Marshal(idealArguments(item.Expect))
		if item.Expect.Tool == toolStats {
			var req um.Request
			if err := json.Unmarshal(raw, &req); err != nil {
				t.Fatalf("%s: %v", item.ID, err)
			}
			if err := req.Validate(); err != nil {
				t.Errorf("%s: the expected query is not legal: %v", item.ID, err)
			}
		}
		// The ideal call must pass its own case; otherwise the case is
		// unsatisfiable.
		transcript := Transcript{Calls: []Call{{Name: item.Expect.Tool, Arguments: string(raw), Result: `{}`}}, Answer: "已查询，变化见上方卡片，较上期持平。"}
		if grade := GradeTranscript(item, transcript, now, shanghai); !grade.Passed {
			t.Errorf("%s: ideal call fails: %v", item.ID, grade.Problems)
		}
	}
}

func TestGradeChecksToolArgumentsAndWindow(t *testing.T) {
	item := Case{ID: "x", Prompt: "上个月花了多少积分", Expect: stats(metrics(um.MetricSpendPoints), um.RangeLastMonth)}
	grade := func(args string) Grade {
		return GradeTranscript(item, Transcript{Calls: []Call{{Name: toolStats, Arguments: args, Result: `{"totals":{"spend_points":120}}`}}, Answer: "上个月消耗 120 积分。"}, now, shanghai)
	}
	if g := grade(`{"metrics":["spend_points"],"timeRange":{"preset":"last_month"}}`); !g.Passed {
		t.Fatalf("preset: %v", g.Problems)
	}
	if g := grade(`{"metrics":["spend_points"],"timeRange":{"from":"2026-02-01","to":"2026-02-28"}}`); !g.Passed {
		t.Fatalf("explicit dates for the same month: %v", g.Problems)
	}
	if g := grade(`{"metrics":["spend_points"]}`); g.Passed || !strings.Contains(strings.Join(g.Problems, ""), "时间范围") {
		t.Fatalf("default window should fail last-month case: %+v", g)
	}
	if g := grade(`{"metrics":["creations"],"timeRange":{"preset":"last_month"}}`); g.Passed {
		t.Fatal("wrong metric passed")
	}
	noTool := GradeTranscript(item, Transcript{Answer: "上个月大约花了 120 积分"}, now, shanghai)
	if noTool.ToolOK || noTool.Passed {
		t.Fatalf("answer without a tool passed: %+v", noTool)
	}

	// "本月" answered as 1st–today equals 1st–31st.
	thisMonth := Case{ID: "y", Expect: stats(metrics(um.MetricImages), um.RangeThisMonth)}
	g := GradeTranscript(thisMonth, Transcript{Calls: []Call{{Name: toolStats,
		Arguments: `{"metrics":["images"],"timeRange":{"from":"2026-03-01","to":"2026-03-12"}}`}}}, now, shanghai)
	if !g.ArgsOK {
		t.Fatalf("month to date: %v", g.Problems)
	}
}

func TestUngroundedNumbersAllowsDerivedValuesOnly(t *testing.T) {
	calls := []Call{{Name: toolStats, Result: `{"range":{"label":"本月","from":"2026-03-01","to":"2026-03-31"},` +
		`"totals":{"spend_points":1234,"images":12345},"previousTotals":{"spend_points":1000,"images":10000},` +
		`"rows":[{"labels":{"workspace":"AI 电商"},"values":{"spend_points":834}},{"labels":{"workspace":"文生图"},"values":{"spend_points":400}}]}`}}
	answer := strings.Join([]string{
		"本月（2026-03-01 至 2026-03-31）消耗 1,234 积分，比上月多 234 积分，增长 23.4%。",
		"1. AI 电商 834 积分，占 67.6%；",
		"2. 文生图 400 积分。",
		"共生成约 1.2 万张图，第 3 周最多，[查看钱包](/wallet?tab=2)。",
		"每周三 10:00 最活跃。",
	}, "\n")
	if got := UngroundedNumbers(answer, "这个月花了多少", calls); len(got) != 0 {
		t.Fatalf("grounded answer flagged: %v", got)
	}
	if got := UngroundedNumbers("本月消耗 1,234 积分，预计月底会到 1,900 积分。", "", calls); len(got) != 1 || got[0] != "1,900" {
		t.Fatalf("invented projection not flagged: %v", got)
	}
	if got := UngroundedNumbers("最近 30 天你花了 1234 积分", "最近 30 天花了多少", calls); len(got) != 0 {
		t.Fatalf("number from the question flagged: %v", got)
	}
}

func TestEvaluateAggregatesByCategory(t *testing.T) {
	cases := []Case{
		{ID: "a", Category: "总量", Prompt: "我花了多少积分", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricSpendPoints)}},
		{ID: "b", Category: "账户", Prompt: "我还有多少积分", Expect: Expect{Tool: toolAccount}},
	}
	agent := func(_ context.Context, prompt string) (Transcript, error) {
		if strings.Contains(prompt, "还有") {
			return Transcript{Answer: "你还有 88 积分"}, nil // no tool, invented number
		}
		return Transcript{Calls: []Call{{Name: toolStats, Arguments: `{"metrics":["spend_points"]}`, Result: `{"totals":{"spend_points":50}}`}}, Answer: "最近 30 天花了 50 积分。"}, nil
	}
	report := Evaluate(context.Background(), cases, agent, "m", now, shanghai, 2)
	if report.Total != 2 || report.Passed != 1 || report.ToolRate != 0.5 || report.GroundedRate != 0.5 || len(report.Failures) != 1 || report.Failures[0].ID != "b" {
		t.Fatalf("report = %+v", report)
	}
	if len(report.ByCategory) != 2 || report.ByCategory[0].Category != "总量" || report.ByCategory[0].Passed != 1 {
		t.Fatalf("by category = %+v", report.ByCategory)
	}
}

func TestUngroundedNumbersAcceptsTotalsOfReturnedFields(t *testing.T) {
	calls := []Call{{Name: toolStats, Result: `{"totals":{"spend_points":16329,"deduct_points":187983,"refund_points":2046},` +
		`"previousTotals":{"spend_points":7000,"deduct_points":1033,"refund_points":500}}`}}
	answer := "已消耗 204,312 积分（16,329 + 187,983），扣除退回后净支出 202,266 积分，比之前 30 天多 196,279 积分。"
	if got := UngroundedNumbers(answer, "", calls); len(got) != 0 {
		t.Fatalf("totals flagged: %v", got)
	}
}
