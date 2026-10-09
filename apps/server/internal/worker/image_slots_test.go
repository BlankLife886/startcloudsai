package worker

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func slotCandidate(modelID, providerID, routeID string) modelconfig.Selection {
	return modelconfig.Selection{
		Provider: modelconfig.Provider{ID: providerID, RouteID: routeID, MaxConcurrency: 10},
		Model:    modelconfig.Model{ID: modelID},
	}
}

func TestSlotPriorityCandidatesUsesFirstMemberWithUntriedRoute(t *testing.T) {
	candidates := []modelconfig.Selection{
		slotCandidate("a", "pa", "r1"), slotCandidate("a", "pa", "r2"),
		slotCandidate("b", "pb", "r1"), slotCandidate("c", "pc", "r1"),
	}
	order := []string{"a", "b", "c"}
	ids := func(list []modelconfig.Selection) string {
		out := ""
		for _, item := range list {
			out += item.Model.ID + "/" + item.Provider.RouteID + " "
		}
		return out
	}
	if got := ids(slotPriorityCandidates(candidates, order, map[string]bool{})); got != "a/r1 a/r2 " {
		t.Fatalf("healthy chain pool = %q", got)
	}
	if got := ids(slotPriorityCandidates(candidates, order, map[string]bool{"pa/r1": true})); got != "a/r1 a/r2 " {
		t.Fatalf("one failed route keeps the member: %q", got)
	}
	if got := ids(slotPriorityCandidates(candidates, order, map[string]bool{"pa/r1": true, "pa/r2": true})); got != "b/r1 " {
		t.Fatalf("all routes of a failed moves to b: %q", got)
	}
	if got := ids(slotPriorityCandidates(candidates, nil, nil)); got != ids(candidates) {
		t.Fatalf("non-slot tasks keep every candidate: %q", got)
	}
}

func TestSlotFailureClassification(t *testing.T) {
	for code, want := range map[string]bool{
		"upstream_error": true, "upstream_unreachable": true, "content_policy_violation": false,
		"user_canceled": false, "internal_error": false, "invalid_request": false, "upstream_submission_uncertain": false,
	} {
		if got := slotFailureCounts(code); got != want {
			t.Errorf("slotFailureCounts(%q) = %t, want %t", code, got, want)
		}
	}
	slotTask := &store.Task{ID: uuid.New(), Params: map[string]any{"_slotResolution": "4K"}}
	plainTask := &store.Task{ID: uuid.New(), Params: map[string]any{}}
	unauthorized := &c2a.UpstreamError{StatusCode: 401, Message: "bad key"}
	if !slotMemberRejected(slotTask, unauthorized) {
		t.Error("a revoked key must move a slot task to its next member")
	}
	if slotMemberRejected(plainTask, unauthorized) {
		t.Error("non-slot tasks keep the existing retry rules")
	}
	if slotMemberRejected(slotTask, &c2a.UpstreamError{StatusCode: 400, Message: "bad prompt"}) || slotMemberRejected(slotTask, errors.New("x")) {
		t.Error("request errors are not member failures")
	}
}
