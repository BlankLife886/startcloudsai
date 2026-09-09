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
	displayKey := "uploads/" + user.ID.String() + "/display/standalone.jpg"
	if err := store.RegisterUserUploadObjects(ctx, st.Pool, user.ID, []string{sharedKey, standaloneKey, displayKey}); err != nil {
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
		keys, claimErr := store.ClaimUnreferencedUserUploadObjects(ctx, tx, []string{sharedKey, standaloneKey, displayKey}, cutoff)
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
	if keys := claim(); len(keys) != 2 || !containsUploadKey(keys, displayKey) || !containsUploadKey(keys, standaloneKey) {
		t.Fatalf("first claim = %#v, want standalone display and thumbnail objects", keys)
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

func containsUploadKey(keys []string, requested string) bool {
	for _, key := range keys {
		if key == requested {
			return true
		}
	}
	return false
}

func TestUserUploadStorageBytesTracksLiveObjectSizes(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "upload-quota-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	objects := []store.UserUploadObjectSize{
		{Key: "uploads/" + user.ID.String() + "/original/a.png", SizeBytes: 100},
		{Key: "uploads/" + user.ID.String() + "/thumb/a", SizeBytes: 25},
	}
	if err := store.RegisterUserUploadObjectSizes(ctx, st.Pool, user.ID, objects); err != nil {
		t.Fatal(err)
	}
	total, err := store.UserUploadStorageBytes(ctx, st.Pool, user.ID)
	if err != nil || total != 125 {
		t.Fatalf("storage total=%d err=%v", total, err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE user_upload_objects SET deleted_at=now() WHERE object_key=$1`, objects[1].Key); err != nil {
		t.Fatal(err)
	}
	total, err = store.UserUploadStorageBytes(ctx, st.Pool, user.ID)
	if err != nil || total != 100 {
		t.Fatalf("live storage total=%d err=%v", total, err)
	}
}

func TestGetUserAssetByFileKeyIsUserScoped(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	owner, err := store.InsertUser(ctx, st.Pool, "asset-owner-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.InsertUser(ctx, st.Pool, "asset-other-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	fileKey := "uploads/" + owner.ID.String() + "/original/handheld-source.png"
	inserted, err := store.InsertUserAsset(ctx, st.Pool, owner.ID, "手持商品", fileKey,
		"uploads/"+owner.ID.String()+"/thumb/handheld-source.jpg", "image/png", 128, nil)
	if err != nil {
		t.Fatal(err)
	}
	found, err := store.GetUserAssetByFileKey(ctx, st.Pool, owner.ID, fileKey)
	if err != nil {
		t.Fatal(err)
	}
	if found == nil || found.ID != inserted.ID {
		t.Fatalf("asset lookup = %#v, want %s", found, inserted.ID)
	}
	missing, err := store.GetUserAssetByFileKey(ctx, st.Pool, other.ID, fileKey)
	if err != nil {
		t.Fatal(err)
	}
	if missing != nil {
		t.Fatalf("cross-user asset lookup leaked %#v", missing)
	}
}
