package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestUserProfileRefreshQueueAndMetrics(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "profile-"+uuid.NewString()+"@test.dev", "profile", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: "image-model", Prompt: "test",
		Params: map[string]any{"_source": store.CanvasTaskSource}, Count: 2, CostCents: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded', started_at=$2, finished_at=$3 WHERE id=$1`,
		task.ID, now.Add(-20*time.Second), now); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUsageProfitEntry(ctx, st.Pool, store.UsageProfitEntry{
		SourceType: "task", SourceID: task.ID.String(), UserID: user.ID, EventStatus: "succeeded",
		Workspace: "canvas", ModelID: "image-model", Units: 2, RevenueCents: 100,
		UpstreamCostCents: 60, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	tx, err := st.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := store.LockQueuedUserProfileIDs(ctx, tx, 100)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, id := range ids {
		found = found || id == user.ID
	}
	if !found {
		t.Fatalf("new user %s was not queued for profile refresh: %v", user.ID, ids)
	}
	if err := store.RefreshUserProfiles(ctx, tx, []uuid.UUID{user.ID}, store.DefaultUserProfileRules(), now); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteUserProfileRefreshQueue(ctx, tx, []uuid.UUID{user.ID}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	profile, err := store.GetUserProfileMetric(ctx, st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if profile == nil || profile.Lifecycle != "activated" || profile.PrimaryWorkspace != "canvas" {
		t.Fatalf("profile identity = %#v", profile)
	}
	if profile.SuccessfulRuns30 != 1 || profile.SuccessfulUnits30 != 2 || profile.SuccessRateBPS30 != 10000 {
		t.Fatalf("profile quality = %#v", profile)
	}
	if profile.RevenueCents30 != 100 || profile.UpstreamCostCents30 != 60 || profile.GrossProfitCents30 != 40 {
		t.Fatalf("profile value = %#v", profile)
	}
	if profile.ValueTier != "standard" || profile.TagReasons["high_value"] != "" {
		t.Fatalf("profile value before scheduled ranking = %#v", profile)
	}
	changed, err := store.RefreshHighValueProfileTags(ctx, st.Pool, 90, now.Add(30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if changed != 1 {
		t.Fatalf("ranked profiles = %d, want 1", changed)
	}
	profile, err = store.GetUserProfileMetric(ctx, st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if profile.ValueTier != "high" || profile.TagReasons["high_value"] == "" {
		t.Fatalf("profile after scheduled ranking = %#v", profile)
	}
	changed, err = store.RefreshHighValueProfileTags(ctx, st.Pool, 90, now.Add(45*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if changed != 0 {
		t.Fatalf("unchanged ranking updated %d profiles", changed)
	}

	users, err := store.ListUsers(ctx, st.Pool, "", "", "activated", "", "high_value", 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 || users[0].ID != user.ID {
		t.Fatalf("profile filtered users = %#v", users)
	}

	history, err := store.UserProfileHistory(ctx, st.Pool, user.ID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 || history[0].Lifecycle != "activated" || history[0].ValueTier != "high" {
		t.Fatalf("initial profile history = %#v", history)
	}
	if err := store.RefreshUserProfiles(ctx, st.Pool, []uuid.UUID{user.ID}, store.DefaultUserProfileRules(), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	history, err = store.UserProfileHistory(ctx, st.Pool, user.ID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Fatalf("same-day unchanged refresh created history: %#v", history)
	}

	changedRules := store.DefaultUserProfileRules()
	changedRules.ActivationDays = -1
	if err := store.RefreshUserProfiles(ctx, st.Pool, []uuid.UUID{user.ID}, changedRules, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	history, err = store.UserProfileHistory(ctx, st.Pool, user.ID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 3 || history[0].Lifecycle != "active" {
		t.Fatalf("same-day classification change history = %#v", history)
	}

	if err := store.RefreshUserProfiles(ctx, st.Pool, []uuid.UUID{user.ID}, changedRules, now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	history, err = store.UserProfileHistory(ctx, st.Pool, user.ID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 4 {
		t.Fatalf("next-day profile history = %#v", history)
	}

	if _, err := st.Pool.Exec(ctx, `UPDATE user_profile_history SET calculated_at=$2
		WHERE id=(SELECT id FROM user_profile_history WHERE user_id=$1 ORDER BY calculated_at LIMIT 1)`,
		user.ID, now.AddDate(0, 0, -200)); err != nil {
		t.Fatal(err)
	}
	deleted, err := store.DeleteUserProfileHistoryBefore(ctx, st.Pool, now.AddDate(0, 0, -180))
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted profile history = %d, want 1", deleted)
	}
}

func TestUserProfileDailyRollupRebuildsDirtyDate(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "profile-rollup-"+uuid.NewString()+"@test.dev", "rollup", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: "image-model", Prompt: "test",
		Params: map[string]any{"_source": store.CanvasTaskSource}, Count: 2, CostCents: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded',started_at=$2,finished_at=$3 WHERE id=$1`,
		task.ID, now.Add(-10*time.Second), now); err != nil {
		t.Fatal(err)
	}
	if err := store.RefreshUserProfiles(ctx, st.Pool, []uuid.UUID{user.ID}, store.DefaultUserProfileRules(), now); err != nil {
		t.Fatal(err)
	}
	profile, err := store.GetUserProfileMetric(ctx, st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if profile.SuccessfulRuns30 != 1 || profile.FailedRuns30 != 0 || profile.AverageDurationMs30 != 10000 {
		t.Fatalf("initial rollup profile = %#v", profile)
	}

	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='failed' WHERE id=$1`, task.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.RefreshUserProfiles(ctx, st.Pool, []uuid.UUID{user.ID}, store.DefaultUserProfileRules(), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	profile, err = store.GetUserProfileMetric(ctx, st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if profile.SuccessfulRuns30 != 0 || profile.FailedRuns30 != 1 || profile.AverageDurationMs30 != 0 {
		t.Fatalf("rebuilt rollup profile = %#v", profile)
	}
	var dirty int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM user_profile_rollup_dirty WHERE user_id=$1`, user.ID).Scan(&dirty); err != nil {
		t.Fatal(err)
	}
	if dirty != 0 {
		t.Fatalf("dirty rollup rows = %d, want 0", dirty)
	}
}
