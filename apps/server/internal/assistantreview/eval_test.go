package assistantreview

import (
	"context"
	"errors"
	"testing"
)

func TestBuiltinCasesAreWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, item := range BuiltinCases {
		if item.ID == "" || seen[item.ID] {
			t.Fatalf("duplicate or empty id %q", item.ID)
		}
		seen[item.ID] = true
		if item.Mode != ModeChat && item.Mode != ModeAgent {
			t.Fatalf("%s: mode %q", item.ID, item.Mode)
		}
		if item.Prompt == "" || len(item.Expected) == 0 {
			t.Fatalf("%s: prompt or expectation missing", item.ID)
		}
		for _, expected := range item.Expected {
			if !ValidExpectation(expected) {
				t.Fatalf("%s: unknown expectation %q", item.ID, expected)
			}
		}
		if item.Mode == ModeChat && (item.Expected[0] == ExpectImage || item.Expected[0] == ExpectWorkspace) {
			t.Fatalf("%s: 问答 mode has no image or site tools", item.ID)
		}
		if item.Source != SourceBuiltin || !item.Active {
			t.Fatalf("%s: source %q active %v", item.ID, item.Source, item.Active)
		}
	}
}

func TestEvaluateCountsPassesFailuresAndErrors(t *testing.T) {
	cases := []Case{
		{ID: "a", Source: SourceBuiltin, Prompt: "你好", Expected: []string{ExpectAnswer}},
		{ID: "b", Source: SourceBuiltin, Prompt: "画猫", Expected: []string{ExpectImage}},
		{ID: "c", Source: SourceUser, Prompt: "我花了多少", Expected: []string{ExpectAnswer, ExpectData}},
		{ID: "d", Source: SourceUser, Prompt: "金价", Expected: []string{ExpectWeb}},
	}
	probe := func(_ context.Context, item Case) (Action, error) {
		switch item.ID {
		case "a":
			return Action{Category: ExpectAnswer, LatencyMs: 100}, nil
		case "b":
			return Action{Category: ExpectAnswer, LatencyMs: 300}, nil
		case "c":
			return Action{Category: ExpectData, Tool: "my_stats_query", LatencyMs: 200}, nil
		}
		return Action{}, errors.New("upstream down")
	}
	report := Evaluate(context.Background(), cases, probe, "m", 2)
	if report.Total != 4 || report.Passed != 2 || report.Errors != 1 || len(report.Failures) != 2 {
		t.Fatalf("report = %+v", report)
	}
	if report.AvgLatencyMs != 200 {
		t.Fatalf("avg latency = %d", report.AvgLatencyMs)
	}
	if report.Failures[0].Case.Source != SourceUser {
		t.Fatalf("user failures must come first: %+v", report.Failures)
	}
	if report.ByExpected[0].Expected != ExpectAnswer || report.ByExpected[0].Total != 2 || report.ByExpected[0].Passed != 2 {
		t.Fatalf("buckets = %+v", report.ByExpected)
	}
}
