package assistantdecision

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/decision"
)

func TestBuiltinCasesAreWellFormed(t *testing.T) {
	seen := map[string]bool{}
	valid := map[string]bool{}
	for _, intent := range Intents {
		valid[intent] = true
	}
	for _, item := range BuiltinCases {
		if item.ID == "" || seen[item.ID] || item.Prompt == "" || !valid[item.Expected] {
			t.Fatalf("bad case %+v", item)
		}
		seen[item.ID] = true
	}
	for _, intent := range Intents {
		count := 0
		for _, item := range BuiltinCases {
			if item.Expected == intent {
				count++
			}
		}
		if count < 3 {
			t.Fatalf("intent %s has only %d cases", intent, count)
		}
	}
}

// The rules baseline must keep handling the false positives that motivated
// v2; if this drops, a keyword change regressed.
func TestRulesBaselineOnBuiltinCases(t *testing.T) {
	report := Evaluate(context.Background(), BuiltinCases, "rules", func(prompt string) Setup {
		return RulesOnly(prompt, decision.DefaultThresholds)
	}, 4)
	if report.Total != len(BuiltinCases) || report.Accuracy != report.RulesAccuracy {
		t.Fatalf("report = %+v", report)
	}
	for _, id := range []string{"answer-02", "answer-03", "answer-04", "answer-05", "web-03", "create-01", "mydata-01"} {
		for _, mistake := range report.Mistakes {
			if mistake.ID == id {
				t.Fatalf("rules regressed on %s: got %s", id, mistake.Got)
			}
		}
	}
	if report.ThresholdCurve != nil {
		t.Fatal("rules-only evaluation has no threshold curve")
	}
	t.Logf("rules baseline accuracy %.3f (%d/%d)", report.Accuracy, report.Correct, report.Total)
}

type scriptedProvider map[string]decision.Answer

func (s scriptedProvider) Name() string { return "llm" }
func (s scriptedProvider) Decide(_ context.Context, req decision.Request) (decision.Response, error) {
	for prompt, answer := range s {
		if req.State == "用户："+prompt {
			return decision.Response{Provider: "llm", Model: "m", Answers: map[string]decision.Answer{"intent": answer}}, nil
		}
	}
	return decision.Response{}, decision.ErrNoAnswer
}

func TestThresholdCurveSuggestsTheLowestBestThreshold(t *testing.T) {
	cases := []EvalCase{
		{ID: "a", Prompt: "这个月积分花哪了", Expected: IntentMyData},
		{ID: "b", Prompt: "帮我生成一张猫咪海报", Expected: IntentCreate},
	}
	provider := scriptedProvider{
		// Confidently right.
		"帮我生成一张猫咪海报": {Choice: IntentCreate, Confidence: 0.9},
		// Wrong with low confidence: the rules (my_data) should win below 0.35.
		"这个月积分花哪了": {Choice: IntentAnswer, Confidence: 0.3},
	}
	report := Evaluate(context.Background(), cases, "model", func(prompt string) Setup {
		rules := Rules(prompt)
		return Setup{Decider: provider, Rules: rules, Thresholds: decision.Thresholds{Intent: 0, Clarify: 0.75}, ModelID: "m"}
	}, 2)
	if report.Accuracy != 0.5 || report.ModelID != "m" {
		t.Fatalf("report = %+v", report)
	}
	if report.SuggestedIntent == nil || *report.SuggestedIntent != 0.35 {
		t.Fatalf("suggested = %v curve = %+v", report.SuggestedIntent, report.ThresholdCurve)
	}
}

func TestLatencyCurveSuggestsTheShortestNearBestWait(t *testing.T) {
	results := []CaseResult{}
	// Ten cases: the model is right on all of them, the rules on none. Two
	// answers take 5.5 s, the rest 2 s; one more is a model failure.
	for index := 0; index < 10; index++ {
		latency := int64(2000)
		if index < 2 {
			latency = 5500
		}
		results = append(results, CaseResult{EvalCase: EvalCase{Expected: IntentMyData}, Got: IntentMyData,
			RulesIntent: IntentAnswer, Provider: "llm", LatencyMs: latency})
	}
	results = append(results, CaseResult{EvalCase: EvalCase{Expected: IntentAnswer}, Got: IntentAnswer, RulesIntent: IntentAnswer, Provider: "rules"})
	report := Report{}
	latencyCurve(&report, results)
	if report.LatencyP50Ms != 2000 || report.LatencyP90Ms != 5500 || report.LatencyMaxMs != 5500 {
		t.Fatalf("latency = %d / %d / %d", report.LatencyP50Ms, report.LatencyP90Ms, report.LatencyMaxMs)
	}
	at := map[int]TimeoutPoint{}
	for _, point := range report.TimeoutCurve {
		at[point.TimeoutMs] = point
	}
	if at[1000].Accuracy != round3(1.0/11) || at[3000].Accuracy != round3(9.0/11) || at[6000].Accuracy != 1 {
		t.Fatalf("curve = %+v", report.TimeoutCurve)
	}
	// 3 s loses two cases, so the suggestion is the first limit that keeps both.
	if report.SuggestedTimeout == nil || *report.SuggestedTimeout != 6000 {
		t.Fatalf("suggested = %v", report.SuggestedTimeout)
	}
}
