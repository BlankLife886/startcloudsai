package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestUserAnalyticsAggregatesProfilesRetentionAndFunnel(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	activeUser, err := store.InsertUser(ctx, st.Pool, "analytics-active-"+uuid.NewString()+"@test.dev", "active", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	newUser, err := store.InsertUser(ctx, st.Pool, "analytics-new-"+uuid.NewString()+"@test.dev", "new", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	activeCreated := now.AddDate(0, 0, -10)
	if _, err := st.Pool.Exec(ctx, `UPDATE users SET created_at=$2 WHERE id=$1`, activeUser.ID, activeCreated); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE users SET created_at=$2 WHERE id=$1`, newUser.ID, now.AddDate(0, 0, -2)); err != nil {
		t.Fatal(err)
	}

	insertSucceededTask := func(createdAt time.Time) {
		t.Helper()
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: activeUser.ID, Type: "t2i", Model: "image-model", Prompt: "test",
			Params: map[string]any{}, Count: 1, CostCents: 20,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded', created_at=$2::timestamptz,
			started_at=$2::timestamptz, finished_at=$2::timestamptz+interval '5 seconds' WHERE id=$1`, task.ID, createdAt); err != nil {
			t.Fatal(err)
		}
	}
	insertSucceededTask(activeCreated.AddDate(0, 0, 1))
	insertSucceededTask(activeCreated.AddDate(0, 0, 7))

	_, err = store.InsertUserBehaviorEvents(ctx, st.Pool, activeUser.ID, []store.UserBehaviorEventInput{{
		ClientEventID: uuid.New(), EventName: "feature_open", Feature: "text_to_image", Metadata: map[string]any{},
	}})
	if err != nil {
		t.Fatal(err)
	}
	trackingSince := now.Add(-time.Hour)
	if _, err := st.Pool.Exec(ctx, `UPDATE user_behavior_events SET created_at=$2 WHERE user_id=$1`, activeUser.ID, trackingSince); err != nil {
		t.Fatal(err)
	}
	insertSucceededTask(now.Add(-30 * time.Minute))

	if err := store.RefreshUserProfiles(ctx, st.Pool, []uuid.UUID{activeUser.ID, newUser.ID}, store.DefaultUserProfileRules(), now); err != nil {
		t.Fatal(err)
	}
	analytics, err := store.GetUserAnalytics(ctx, st.Pool, now)
	if err != nil {
		t.Fatal(err)
	}
	if analytics.Summary.TotalUsers != 2 || analytics.Summary.ProfilesReady != 2 || analytics.Summary.NewUsers30 != 2 {
		t.Fatalf("summary = %#v", analytics.Summary)
	}
	if analytics.Summary.ActiveUsers7 != 1 || analytics.Summary.ActiveUsers30 != 1 {
		t.Fatalf("active summary = %#v", analytics.Summary)
	}
	if analytics.Funnel.TrackingSince == nil || len(analytics.Funnel.Features) != 1 {
		t.Fatalf("funnel = %#v", analytics.Funnel)
	}
	funnel := analytics.Funnel.Features[0]
	if funnel.Feature != "text_to_image" || funnel.Visitors != 1 || funnel.SubmittingUsers != 1 || funnel.SuccessfulUsers != 1 {
		t.Fatalf("feature funnel = %#v", funnel)
	}
	foundRetention := false
	for _, cohort := range analytics.Retention {
		if cohort.Day1 > 0 && cohort.Day7 > 0 {
			foundRetention = true
			break
		}
	}
	if !foundRetention {
		t.Fatalf("retention cohorts = %#v", analytics.Retention)
	}
	last := analytics.DailyTrend[len(analytics.DailyTrend)-1]
	if last.ActiveUsers != 1 || last.SubmittingUsers != 1 || last.SuccessfulUsers != 1 {
		t.Fatalf("today trend = %#v", last)
	}
}
