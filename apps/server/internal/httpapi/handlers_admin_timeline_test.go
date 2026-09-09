package httpapi

import (
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

func TestSynthesizeAdminTimelineFromImageTask(t *testing.T) {
	created := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	started := created.Add(2 * time.Second)
	finished := started.Add(8 * time.Second)
	task := &store.Task{
		ID:         uuid.New(),
		Type:       "coloring",
		Status:     "succeeded",
		CreatedAt:  created,
		StartedAt:  &started,
		FinishedAt: &finished,
	}

	events := synthesizeAdminTimeline(task, nil)
	if len(events) != 3 {
		t.Fatalf("events = %d, want 3", len(events))
	}
	if events[0].Stage != "queued" || events[1].Stage != "upstream_generate" || events[2].Stage != "succeeded" {
		t.Fatalf("stages = %s %s %s", events[0].Stage, events[1].Stage, events[2].Stage)
	}
	if events[0].DurationMs == nil || *events[0].DurationMs != 2000 {
		t.Fatalf("queue duration = %#v", events[0].DurationMs)
	}
	if events[1].DurationMs == nil || *events[1].DurationMs != 8000 {
		t.Fatalf("generate duration = %#v", events[1].DurationMs)
	}
}

func TestAssistantRunIDFromParams(t *testing.T) {
	id := uuid.New()
	if got := assistantRunIDFromParams(map[string]any{"assistantRunId": id.String()}); got != id {
		t.Fatalf("got %s want %s", got, id)
	}
	if got := assistantRunIDFromParams(map[string]any{"prompt": "hi"}); got != uuid.Nil {
		t.Fatalf("unexpected id %s", got)
	}
}
