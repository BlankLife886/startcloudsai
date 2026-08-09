package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestUserUploadReferencesProtectSharedObjectsUntilLastRelease(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "uploads-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	sharedKey := "uploads/" + user.ID.String() + "/original/shared.png"
	standaloneKey := "uploads/" + user.ID.String() + "/thumb/standalone.jpg"
	if err := store.RegisterUserUploadObjects(ctx, st.Pool, user.ID, []string{sharedKey, standaloneKey}); err != nil {
		t.Fatal(err)
	}

	assetID := uuid.New()
	taskID := uuid.New()
	if err := store.AddUserUploadReferences(ctx, st.Pool, user.ID, store.UploadReferenceUserAsset, assetID, []string{sharedKey}); err != nil {
		t.Fatal(err)
	}
	if err := store.AddUserUploadReferences(ctx, st.Pool, user.ID, store.UploadReferenceTaskInput, taskID, []string{sharedKey}); err != nil {
		t.Fatal(err)
	}

	cutoff := time.Now().UTC().Add(time.Hour)
	claim := func() []string {
		tx, txErr := st.Pool.Begin(ctx)
		if txErr != nil {
			t.Fatal(txErr)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		keys, claimErr := store.ClaimUnreferencedUserUploadObjects(ctx, tx, []string{sharedKey, standaloneKey}, cutoff)
		if claimErr != nil {
			t.Fatal(claimErr)
		}
		if _, markErr := store.MarkUserUploadObjectsDeleted(ctx, tx, keys); markErr != nil {
			t.Fatal(markErr)
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			t.Fatal(commitErr)
		}
		return keys
	}
	if keys := claim(); len(keys) != 1 || keys[0] != standaloneKey {
		t.Fatalf("first claim = %#v, want only standalone object", keys)
	}

	if err := store.DeleteUserUploadReferences(ctx, st.Pool, store.UploadReferenceUserAsset, assetID); err != nil {
		t.Fatal(err)
	}
	if keys := claim(); len(keys) != 0 {
		t.Fatalf("shared claim after one release = %#v, want none until task release", keys)
	}

	if err := store.DeleteUserUploadReferences(ctx, st.Pool, store.UploadReferenceTaskInput, taskID); err != nil {
		t.Fatal(err)
	}
	keys := claim()
	if len(keys) != 1 || keys[0] != sharedKey {
		t.Fatalf("final shared claim = %#v, want shared object", keys)
	}

	var deletedAt *time.Time
	if err := st.Pool.QueryRow(ctx, `SELECT deleted_at FROM user_upload_objects WHERE object_key = $1`, sharedKey).Scan(&deletedAt); err != nil {
		t.Fatal(err)
	}
	if deletedAt == nil {
		t.Fatal("claimed object was not marked deleted")
	}
}
