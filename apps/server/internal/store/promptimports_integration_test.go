package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestApprovedPromptImportItemsPublishIncrementally(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	batch, err := store.CreatePromptImportBatch(ctx, st.Pool, "manual", 1)
	if err != nil {
		t.Fatal(err)
	}
	items := []*store.PromptImportItem{
		{
			ID: uuid.New(), BatchID: batch.ID, SourceID: "test-source", SourceName: "测试源",
			SourceItemKey: "first", Title: "第一条", Prompt: "first prompt", TaskType: "t2i",
			Category: "other", ContentFingerprint: store.PromptContentFingerprint("first prompt"),
			DuplicateKind: "none", DuplicateAction: "keep", ComplianceStatus: "safe",
			AssetOrigin: "missing", AssetStatus: "not_required", ReviewStatus: "approved",
		},
		{
			ID: uuid.New(), BatchID: batch.ID, SourceID: "test-source", SourceName: "测试源",
			SourceItemKey: "second", Title: "第二条", Prompt: "second prompt", TaskType: "t2i",
			Category: "other", ContentFingerprint: store.PromptContentFingerprint("second prompt"),
			DuplicateKind: "none", DuplicateAction: "keep", ComplianceStatus: "safe",
			AssetOrigin: "missing", AssetStatus: "not_required", ReviewStatus: "pending",
		},
	}
	if err := store.InsertPromptImportItems(ctx, st.Pool, items); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishPromptImportFetch(ctx, st.Pool, batch.ID, 2, 2, 0, 0, ""); err != nil {
		t.Fatal(err)
	}

	imported, updated, err := store.PublishApprovedPromptImportItems(ctx, st, batch.ID, []uuid.UUID{items[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	if imported != 1 || updated != 0 {
		t.Fatalf("first publish imported/updated = %d/%d, want 1/0", imported, updated)
	}
	first, err := store.GetPromptImportItem(ctx, st.Pool, batch.ID, items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.PublishedAt == nil || first.PublishedPromptID == nil {
		t.Fatalf("approved item was not marked published: %#v", first)
	}
	current, err := store.GetPromptImportBatch(ctx, st.Pool, batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != "review" || current.ImportedCount != 1 {
		t.Fatalf("partial batch status/imported = %s/%d, want review/1", current.Status, current.ImportedCount)
	}

	imported, updated, err = store.PublishApprovedPromptImportItems(ctx, st, batch.ID, []uuid.UUID{items[0].ID})
	if err != nil {
		t.Fatal(err)
	}
	if imported != 0 || updated != 0 {
		t.Fatalf("repeated publish imported/updated = %d/%d, want 0/0", imported, updated)
	}

	approved := "approved"
	if _, err := store.PatchPromptImportItem(ctx, st.Pool, batch.ID, items[1].ID,
		store.PromptImportItemPatch{ReviewStatus: &approved}); err != nil {
		t.Fatal(err)
	}
	imported, updated, err = store.PublishApprovedPromptImportItems(ctx, st, batch.ID, []uuid.UUID{items[1].ID})
	if err != nil {
		t.Fatal(err)
	}
	if imported != 1 || updated != 0 {
		t.Fatalf("second publish imported/updated = %d/%d, want 1/0", imported, updated)
	}
	current, err = store.GetPromptImportBatch(ctx, st.Pool, batch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != "completed" || current.ImportedCount != 2 || current.CompletedAt == nil {
		t.Fatalf("completed batch = %#v, want completed with 2 imports", current)
	}
	var promptCount int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM prompt_library WHERE source_id = 'test-source'`).Scan(&promptCount); err != nil {
		t.Fatal(err)
	}
	if promptCount != 2 {
		t.Fatalf("prompt library count = %d, want 2", promptCount)
	}
}

func TestBulkPromptImportReviewUsesSelectedIDsWithoutAssetGate(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	batch, err := store.CreatePromptImportBatch(ctx, st.Pool, "manual", 1)
	if err != nil {
		t.Fatal(err)
	}
	makeItem := func(key, assetStatus string) *store.PromptImportItem {
		return &store.PromptImportItem{
			ID: uuid.New(), BatchID: batch.ID, SourceID: "bulk-source", SourceName: "批量测试源",
			SourceItemKey: key, Title: key, Prompt: key + " prompt", TaskType: "t2i",
			Category: "other", ContentFingerprint: store.PromptContentFingerprint(key + " prompt"),
			DuplicateKind: "none", DuplicateAction: "keep", ComplianceStatus: "pending",
			AssetOrigin: "missing", AssetStatus: assetStatus, ReviewStatus: "pending",
		}
	}
	first := makeItem("first", "not_required")
	unverified := makeItem("unverified", "pending")
	untouched := makeItem("untouched", "not_required")
	if err := store.InsertPromptImportItems(ctx, st.Pool, []*store.PromptImportItem{first, unverified, untouched}); err != nil {
		t.Fatal(err)
	}
	if err := store.FinishPromptImportFetch(ctx, st.Pool, batch.ID, 3, 3, 0, 0, ""); err != nil {
		t.Fatal(err)
	}

	reviewed, err := store.BulkReviewPromptImportItems(ctx, st.Pool, batch.ID, "approve-selected",
		[]uuid.UUID{first.ID, unverified.ID})
	if err != nil {
		t.Fatal(err)
	}
	if reviewed != 2 {
		t.Fatalf("reviewed = %d, want 2 selected items", reviewed)
	}
	imported, updated, err := store.PublishApprovedPromptImportItems(ctx, st, batch.ID,
		[]uuid.UUID{first.ID, unverified.ID})
	if err != nil {
		t.Fatal(err)
	}
	if imported != 2 || updated != 0 {
		t.Fatalf("published selected imported/updated = %d/%d, want 2/0", imported, updated)
	}
	unverifiedAfter, err := store.GetPromptImportItem(ctx, st.Pool, batch.ID, unverified.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unverifiedAfter.ReviewStatus != "approved" || unverifiedAfter.PublishedAt == nil {
		t.Fatalf("selected external item was not published: %#v", unverifiedAfter)
	}
	untouchedAfter, err := store.GetPromptImportItem(ctx, st.Pool, batch.ID, untouched.ID)
	if err != nil {
		t.Fatal(err)
	}
	if untouchedAfter.ReviewStatus != "pending" || untouchedAfter.PublishedAt != nil {
		t.Fatalf("unselected item changed unexpectedly: %#v", untouchedAfter)
	}
}

func TestUpdatePromptImportItemCoverDoesNotRequireAssetReview(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	batch, err := store.CreatePromptImportBatch(ctx, st.Pool, "manual", 1)
	if err != nil {
		t.Fatal(err)
	}
	item := &store.PromptImportItem{
		ID: uuid.New(), BatchID: batch.ID, SourceID: "cover-source", SourceName: "封面测试源",
		SourceItemKey: "cover", Title: "封面", Prompt: "cover prompt", TaskType: "t2i",
		Category: "other", ContentFingerprint: store.PromptContentFingerprint("cover prompt"),
		DuplicateKind: "none", DuplicateAction: "keep", ComplianceStatus: "pending",
		AssetOrigin: "external", AssetStatus: "pending", ReviewStatus: "pending",
	}
	if err := store.InsertPromptImportItems(ctx, st.Pool, []*store.PromptImportItem{item}); err != nil {
		t.Fatal(err)
	}
	updated, err := store.UpdatePromptImportItemCover(ctx, st.Pool, batch.ID, item.ID,
		"prompt-covers/import-test.png", "管理员上传替换")
	if err != nil {
		t.Fatal(err)
	}
	if updated.CoverKey != "prompt-covers/import-test.png" || updated.AssetOrigin != "owned_storage" ||
		updated.AssetStatus != "not_required" || updated.AssetNote != "管理员上传替换" {
		t.Fatalf("updated import cover = %#v", updated)
	}
}
