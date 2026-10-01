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
