package httpapi

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestResolveSeriesAnchor(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	newUser := func(t *testing.T) *store.User {
		t.Helper()
		user, err := store.InsertUser(ctx, st.Pool, "series-anchor-"+uuid.NewString()+"@test.dev", "", "", "user", nil)
		if err != nil {
			t.Fatal(err)
		}
		return user
	}
	owner := newUser(t)
	other := newUser(t)
	newTask := func(t *testing.T, userID uuid.UUID, taskType string, params map[string]any) *store.Task {
		t.Helper()
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: userID, Type: taskType, Model: "test-model",
			Prompt: "base", Count: 1, WorkUnits: 1, Params: params,
		})
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	batch := uuid.NewString()
	hero := newTask(t, owner.ID, "ecommerce_design", map[string]any{"batchId": batch, "batchIndex": 0})
	follower := func(anchor string) map[string]any {
		return map[string]any{"batchId": batch, "batchIndex": float64(1), seriesAnchorRequestParam: anchor}
	}

	t.Run("valid follower resolves and strips client params", func(t *testing.T) {
		params := follower(hero.ID.String())
		params[store.HandheldAnchorTaskParam] = hero.ID.String()
		params[store.HandheldAnchorResolvedParam] = true
		got, err := resolveSeriesAnchor(ctx, st.Pool, owner.ID, "ecommerce_design", params)
		if err != nil || got != hero.ID.String() {
			t.Fatalf("got=%q err=%v", got, err)
		}
		for _, key := range []string{seriesAnchorRequestParam, store.HandheldAnchorTaskParam, store.HandheldAnchorResolvedParam} {
			if _, exists := params[key]; exists {
				t.Fatalf("client param %s not stripped: %v", key, params)
			}
		}
	})

	t.Run("no request is a no-op but still strips handheld params", func(t *testing.T) {
		params := map[string]any{store.HandheldAnchorTaskParam: hero.ID.String()}
		got, err := resolveSeriesAnchor(ctx, st.Pool, owner.ID, "ecommerce_design", params)
		if err != nil || got != "" || len(params) != 0 {
			t.Fatalf("got=%q err=%v params=%v", got, err, params)
		}
	})

	otherBatchHero := newTask(t, owner.ID, "ecommerce_design", map[string]any{"batchId": uuid.NewString(), "batchIndex": 0})
	secondShot := newTask(t, owner.ID, "ecommerce_design", map[string]any{"batchId": batch, "batchIndex": 1})
	chained := newTask(t, owner.ID, "ecommerce_design", map[string]any{"batchId": batch, "batchIndex": 0, store.SeriesAnchorTaskParam: hero.ID.String()})
	foreignHero := newTask(t, other.ID, "ecommerce_design", map[string]any{"batchId": batch, "batchIndex": 0})
	t2iHero := newTask(t, owner.ID, "t2i", map[string]any{"batchId": batch, "batchIndex": 0})

	rejects := map[string]struct {
		taskType string
		params   map[string]any
	}{
		"other user's task":     {"ecommerce_design", follower(foreignHero.ID.String())},
		"different batch":       {"ecommerce_design", follower(otherBatchHero.ID.String())},
		"anchor not first shot": {"ecommerce_design", follower(secondShot.ID.String())},
		"chained anchor":        {"ecommerce_design", follower(chained.ID.String())},
		"anchor wrong type":     {"ecommerce_design", follower(t2iHero.ID.String())},
		"request wrong type":    {"t2i", follower(hero.ID.String())},
		"missing task":          {"ecommerce_design", follower(uuid.NewString())},
		"not a uuid":            {"ecommerce_design", follower("hero")},
		"follower is first":     {"ecommerce_design", map[string]any{"batchId": batch, "batchIndex": float64(0), seriesAnchorRequestParam: hero.ID.String()}},
		"missing batch":         {"ecommerce_design", map[string]any{"batchIndex": float64(1), seriesAnchorRequestParam: hero.ID.String()}},
		"non-string anchor":     {"ecommerce_design", map[string]any{"batchId": batch, "batchIndex": float64(1), seriesAnchorRequestParam: 42}},
	}
	for name, tc := range rejects {
		t.Run("rejects "+name, func(t *testing.T) {
			if got, err := resolveSeriesAnchor(ctx, st.Pool, owner.ID, tc.taskType, tc.params); err == nil {
				t.Fatalf("expected rejection, got %q", got)
			}
		})
	}
}
