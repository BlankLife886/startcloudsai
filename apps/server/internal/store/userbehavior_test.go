package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestUserBehaviorEventsDeduplicateFunnelAndCleanup(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "behavior-"+uuid.NewString()+"@test.dev", "behavior", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	openID := uuid.New()
	events := []store.UserBehaviorEventInput{
		{ClientEventID: openID, EventName: "feature_open", Feature: "text_to_image", Metadata: map[string]any{}},
		{ClientEventID: uuid.New(), EventName: "reference_upload_started", Feature: "text_to_image", Metadata: map[string]any{"uploadKind": "reference"}},
	}
	inserted, err := store.InsertUserBehaviorEvents(ctx, st.Pool, user.ID, events)
	if err != nil {
		t.Fatal(err)
	}
	if inserted != 2 {
		t.Fatalf("inserted = %d, want 2", inserted)
	}
	inserted, err = store.InsertUserBehaviorEvents(ctx, st.Pool, user.ID, events[:1])
	if err != nil {
		t.Fatal(err)
	}
	if inserted != 0 {
		t.Fatalf("duplicate inserted = %d, want 0", inserted)
	}

	task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: "image-model", Prompt: "test",
		Params: map[string]any{}, Count: 1, CostCents: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='succeeded', started_at=now()-interval '5 seconds', finished_at=now() WHERE id=$1`, task.ID); err != nil {
		t.Fatal(err)
	}

	funnel, err := store.UserBehaviorFunnel30(ctx, st.Pool, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if funnel.Opens != 1 || funnel.Submissions != 1 || funnel.Succeeded != 1 {
		t.Fatalf("funnel = %#v", funnel)
	}
	if funnel.ReferenceUploadsStarted != 1 || funnel.SubmitRateBPS != 10000 || funnel.SuccessRateBPS != 10000 {
		t.Fatalf("funnel secondary = %#v", funnel)
	}

	if _, err := st.Pool.Exec(ctx, `UPDATE user_behavior_events SET created_at=$2 WHERE user_id=$1`, user.ID, time.Now().UTC().AddDate(0, 0, -100)); err != nil {
		t.Fatal(err)
	}
	deleted, err := store.DeleteUserBehaviorEventsBefore(ctx, st.Pool, time.Now().UTC().AddDate(0, 0, -90))
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}
}
