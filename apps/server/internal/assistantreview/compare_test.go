package assistantreview

import (
	"context"
	"errors"
	"testing"
)

func TestJudgeUsesOnlyTheUsersOwnBehaviour(t *testing.T) {
	cases := []struct {
		name   string
		replay Replay
		now    string
		want   string
	}{
		{"same move, no label", Replay{Recorded: ExpectAnswer}, ExpectAnswer, ""},
		{"now matches the correction", Replay{Recorded: ExpectImage, Label: ExpectAnswer}, ExpectAnswer, VerdictBetter},
		{"corrected and repeated", Replay{Recorded: ExpectImage, Label: ExpectAnswer}, ExpectImage, VerdictStillWrong},
		{"accepted proposal dropped", Replay{Recorded: ExpectImage, Executed: true}, ExpectAnswer, VerdictWorse},
		{"doubted move changed", Replay{Recorded: ExpectAnswer, Doubted: true}, ExpectWeb, VerdictLikelyBetter},
		{"changed with nothing to go on", Replay{Recorded: ExpectAnswer}, ExpectData, VerdictUnknown},
		{"changed away from the label", Replay{Recorded: ExpectImage, Label: ExpectAnswer}, ExpectWeb, VerdictUnknown},
	}
	for _, item := range cases {
		if got := Judge(item.replay, item.now); got != item.want {
			t.Errorf("%s: got %q want %q", item.name, got, item.want)
		}
	}
}

func TestCompareListsOnlyTurnsWorthLookingAt(t *testing.T) {
	replays := []Replay{
		{Case: Case{ID: "same"}, Recorded: ExpectAnswer},
		{Case: Case{ID: "better"}, Recorded: ExpectImage, Label: ExpectAnswer},
		{Case: Case{ID: "worse"}, Recorded: ExpectImage, Executed: true},
		{Case: Case{ID: "error"}, Recorded: ExpectAnswer},
	}
	probe := func(_ context.Context, item Case) (Action, error) {
		switch item.ID {
		case "same", "better", "worse":
			return Action{Category: ExpectAnswer}, nil
		}
		return Action{}, errors.New("timeout")
	}
	report := Compare(context.Background(), replays, probe, "m", 2)
	if report.Total != 4 || report.Same != 1 || report.Changed != 2 || report.Better != 1 || report.Worse != 1 || report.Errors != 1 {
		t.Fatalf("report = %+v", report)
	}
	if len(report.Items) != 3 {
		t.Fatalf("items = %+v", report.Items)
	}
}
