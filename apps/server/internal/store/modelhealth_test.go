package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestModelHealthAttributionAndRollup(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC()
	user, err := store.InsertUser(ctx, st.Pool, "health-"+uuid.NewString()+"@test.dev", "health", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	image := map[string]any{"_modelConfigId": "img", "_modelEffectivePriceCents": 20}
	created := now.Add(-10 * time.Minute)
	ok := insertPerfTask(t, st, user.ID, created, "succeeded", "t2i", image)
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET output_keys = '["a","b"]'::jsonb WHERE id = $1`, ok.ID); err != nil {
		t.Fatal(err)
	}
	upstream := insertPerfTask(t, st, user.ID, created, "failed", "t2i", image)
	policy := insertPerfTask(t, st, user.ID, created, "failed", "t2i", image)
	insertPerfTask(t, st, user.ID, created, "canceled", "t2i", image)
	// Mirror tasks and running tasks never count.
	insertPerfTask(t, st, user.ID, created, "failed", "assistant", image)
	insertPerfTask(t, st, user.ID, created, "running", "t2i", image)
	for id, code := range map[uuid.UUID]string{upstream.ID: "upstream_timeout", policy.ID: "content_policy"} {
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET error_code = $2 WHERE id = $1`, id, code); err != nil {
			t.Fatal(err)
		}
	}

	chat := map[string]any{"_chatModelConfigId": "chat", "_chatModelEffectivePriceCents": 10}
	run := insertPerfAssistantRun(t, st, user.ID, "assistant", created, "succeeded", chat)
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_messages
		SET metadata = '{"usage":{"durationMs":4000,"firstTokenMs":800,"outputTokens":200}}'::jsonb
		WHERE id = $1`, run.AssistantMessageID); err != nil {
		t.Fatal(err)
	}
	insertPerfAssistantRun(t, st, user.ID, "assistant", created, "failed", chat)
	imageRun := insertPerfAssistantRun(t, st, user.ID, "assistant", created, "failed", chat)
	if _, err := st.Pool.Exec(ctx, `UPDATE assistant_runs SET mode = 'image', resolved_mode = 'image' WHERE id = $1`, imageRun.ID); err != nil {
		t.Fatal(err)
	}

	window, err := store.ModelHealthWindow(ctx, st.Pool, now.Add(-time.Hour), now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	img := window["img"]
	if img.Succeeded != 1 || img.Failed != 1 || img.Excluded != 2 {
		t.Fatalf("image counts = %+v", img)
	}
	// Fixture tasks run for one second and return two images.
	if img.LatencyP50Ms == nil || *img.LatencyP50Ms != 1000 || img.SpeedP50 == nil || *img.SpeedP50 != 120 || img.TTFTP50Ms != nil {
		t.Fatalf("image metrics = %+v", img)
	}
	if img.LatencyAvgMs == nil || *img.LatencyAvgMs != 1000 || img.PerImageAvgMs == nil || *img.PerImageAvgMs != 500 {
		t.Fatalf("image averages = %+v", img)
	}
	if img.PriceCents == nil || *img.PriceCents != 20 {
		t.Fatalf("image price = %v", img.PriceCents)
	}
	c := window["chat"]
	if c.Succeeded != 1 || c.Failed != 1 || c.Excluded != 0 {
		t.Fatalf("chat counts = %+v", c)
	}
	if c.LatencyP50Ms == nil || *c.LatencyP50Ms != 4000 || c.TTFTP50Ms == nil || *c.TTFTP50Ms != 800 ||
		c.SpeedP50 == nil || *c.SpeedP50 != 50 {
		t.Fatalf("chat metrics = %+v", c)
	}
	if c.LatencyAvgMs == nil || *c.LatencyAvgMs != 4000 || c.PerImageAvgMs != nil {
		t.Fatalf("chat averages = %+v", c)
	}
	if c.PriceCents == nil || *c.PriceCents != 10 {
		t.Fatalf("chat price = %v", c.PriceCents)
	}

	refresh := func(at time.Time) time.Time {
		t.Helper()
		var from time.Time
		if err := st.Tx(ctx, func(tx pgx.Tx) error {
			var err error
			from, err = store.RefreshModelHealthHourly(ctx, tx, at)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return from
	}
	if from := refresh(now.Add(time.Minute)); !from.Equal(now.Add(-store.ModelHealthRetention).Truncate(time.Hour)) {
		t.Fatalf("first refresh should backfill the retention window, from = %s", from)
	}
	// A second run only recomputes from the last stored hour and does not double count.
	if from := refresh(now.Add(2 * time.Minute)); !from.Equal(now.Add(-10*time.Minute).Truncate(time.Hour).Add(-time.Hour)) {
		t.Fatalf("incremental refresh from = %s", from)
	}
	buckets, err := store.ListModelHealthHourly(ctx, st.Pool, now.Add(-2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	totals := map[string]int{}
	for _, bucket := range buckets {
		totals[bucket.ModelID] += bucket.Succeeded + bucket.Failed + bucket.Excluded
	}
	if totals["img"] != 4 || totals["chat"] != 2 || len(totals) != 2 {
		t.Fatalf("hourly totals = %v", totals)
	}
}
