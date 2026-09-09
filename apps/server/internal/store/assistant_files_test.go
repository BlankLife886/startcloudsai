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

func TestAssistantFileLifecycleSearchAndRead(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "assistant-file-"+uuid.NewString()+"@test.dev", "files", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	key := "uploads/" + user.ID.String() + "/original/" + id.String() + ".txt"
	if err := store.InsertAssistantFileUploadEvent(ctx, st.Pool, id, user.ID, 128, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterUserUploadObjects(ctx, st.Pool, user.ID, []string{key}); err != nil {
		t.Fatal(err)
	}
	file, err := store.InsertAssistantFile(ctx, st.Pool, store.AssistantFile{
		ID: id, UserID: user.ID, ObjectKey: key, Name: "项目说明.txt", ContentType: "text/plain",
		SizeBytes: 128, SHA256: "abc", CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddUserUploadReferences(ctx, st.Pool, user.ID, store.UploadReferenceAssistantFile, id, []string{key}); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimAssistantFileIngestion(ctx, st.Pool, id, "worker", time.Now().UTC(), time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim = %#v err=%v", claimed, err)
	}
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		completed, err := store.CompleteAssistantFileIngestion(ctx, tx, claimed, "test-v1", 1, 22, []store.AssistantFileSegment{
			{FileID: id, Locator: map[string]any{"page": 1}, Content: "项目预算是 120 万元。"},
			{FileID: id, Locator: map[string]any{"page": 1}, Content: "Delivery deadline is September 2026."},
		})
		if err != nil {
			return err
		}
		if !completed {
			t.Fatal("completion lost the lease")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := store.ListUserAssistantFiles(ctx, st.Pool, user.ID, 10)
	if err != nil || len(listed) != 1 || listed[0].Status != "ready" || listed[0].SegmentCount != 2 {
		t.Fatalf("listed = %#v err=%v", listed, err)
	}
	searched, err := store.SearchAssistantFileSegments(ctx, st.Pool, user.ID, []uuid.UUID{id}, "预算", 5)
	if err != nil || len(searched) != 1 || searched[0].Ordinal != 0 {
		t.Fatalf("searched = %#v err=%v", searched, err)
	}
	fuzzy, err := store.SearchAssistantFileSegments(ctx, st.Pool, user.ID, []uuid.UUID{id}, "delivrey", 5)
	if err != nil || len(fuzzy) != 1 || fuzzy[0].Ordinal != 1 {
		t.Fatalf("fuzzy = %#v err=%v", fuzzy, err)
	}
	empty, err := store.SearchAssistantFileSegments(ctx, st.Pool, user.ID, []uuid.UUID{id}, "   ", 5)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty search = %#v err=%v", empty, err)
	}

	other, err := store.InsertUser(ctx, st.Pool, "assistant-file-other-"+uuid.NewString()+"@test.dev", "other", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	otherID := uuid.New()
	otherKey := "uploads/" + other.ID.String() + "/original/" + otherID.String() + ".txt"
	if err := store.RegisterUserUploadObjects(ctx, st.Pool, other.ID, []string{otherKey}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertAssistantFile(ctx, st.Pool, store.AssistantFile{
		ID: otherID, UserID: other.ID, ObjectKey: otherKey, Name: "private.txt", ContentType: "text/plain",
		SizeBytes: 64, SHA256: "def", CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	otherClaimed, err := store.ClaimAssistantFileIngestion(ctx, st.Pool, otherID, "worker", time.Now().UTC(), time.Minute)
	if err != nil || otherClaimed == nil {
		t.Fatalf("other claim = %#v err=%v", otherClaimed, err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		completed, err := store.CompleteAssistantFileIngestion(ctx, tx, otherClaimed, "test-v1", 1, 15,
			[]store.AssistantFileSegment{{FileID: otherID, Content: "confidential moonshot roadmap"}})
		if err == nil && !completed {
			t.Fatal("other completion lost the lease")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	isolated, err := store.SearchAssistantFileSegments(ctx, st.Pool, user.ID, []uuid.UUID{id, otherID}, "moonshot", 5)
	if err != nil || len(isolated) != 0 {
		t.Fatalf("cross-user search leaked segments = %#v err=%v", isolated, err)
	}
	read, err := store.ReadAssistantFileSegments(ctx, st.Pool, user.ID, id, 1, 2)
	if err != nil || len(read) != 1 || read[0].Ordinal != 1 {
		t.Fatalf("read = %#v err=%v", read, err)
	}
	deleted, ok, err := store.DeleteUserAssistantFile(ctx, st.Pool, user.ID, file.ID)
	if err != nil || !ok || deleted == nil {
		t.Fatalf("deleted = %#v ok=%v err=%v", deleted, ok, err)
	}
	usage, err := store.GetAssistantFileUsage(ctx, st.Pool, user.ID, time.Now().UTC().Add(-24*time.Hour))
	if err != nil || usage.FileCount != 0 || usage.TotalBytes != 0 || usage.Created24h != 1 {
		t.Fatalf("usage after delete = %#v err=%v", usage, err)
	}
}
