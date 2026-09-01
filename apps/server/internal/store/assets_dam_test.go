package store_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestAssetDAMSearchBatchAndTrash(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "dam-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	group, err := store.InsertUserAssetGroup(ctx, st.Pool, user.ID, "夏季产品", 0)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := store.InsertUserAssetDAM(ctx, st.Pool, user.ID, "红色商品主图",
		"uploads/"+user.ID.String()+"/original/red.png", "uploads/"+user.ID.String()+"/thumb/red.jpg",
		"image/png", 128, &group.ID, []string{"商品", "红色"}, "hash-red", "canvas", nil, json.RawMessage(`{"model":"test"}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	items, err := store.ListUserAssetsDAM(ctx, st.Pool, user.ID, store.UserAssetListOptions{Limit: 10, Query: "红色", Tags: []string{"商品"}})
	if err != nil || len(items) != 1 || items[0].ID != asset.ID {
		t.Fatalf("search items=%#v err=%v", items, err)
	}
	items, err = store.ListUserAssetsDAM(ctx, st.Pool, user.ID, store.UserAssetListOptions{Limit: 10, Query: "夏季"})
	if err != nil || len(items) != 1 || items[0].ID != asset.ID {
		t.Fatalf("group search items=%#v err=%v", items, err)
	}
	if _, err := store.BatchUpdateUserAssets(ctx, st.Pool, user.ID, []uuid.UUID{asset.ID}, false, nil, []string{"精选"}, []string{"红色"}); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetUserAsset(ctx, st.Pool, user.ID, asset.ID)
	if err != nil || updated == nil {
		t.Fatal(err)
	}
	if len(updated.Tags) != 2 || updated.Tags[0] != "商品" || updated.Tags[1] != "精选" {
		t.Fatalf("tags=%v", updated.Tags)
	}
	if err := store.DeleteUserAsset(ctx, st.Pool, user.ID, asset.ID); err != nil {
		t.Fatal(err)
	}
	if active, _ := store.GetUserAsset(ctx, st.Pool, user.ID, asset.ID); active != nil {
		t.Fatal("trashed asset remained active")
	}
	trash, err := store.ListUserAssetsDAM(ctx, st.Pool, user.ID, store.UserAssetListOptions{Limit: 10, Trash: true})
	if err != nil || len(trash) != 1 {
		t.Fatalf("trash=%#v err=%v", trash, err)
	}
	if restored, err := store.RestoreUserAsset(ctx, st.Pool, user.ID, asset.ID); err != nil || restored == nil {
		t.Fatalf("restore=%#v err=%v", restored, err)
	}
}
