package store_test

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestPromptLibrarySortCursorAndCategoryCounts(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	category := func(value string) *string { return &value }
	for _, entry := range []*store.PromptEntry{
		{Title: "第三", Prompt: "prompt third", TaskType: "t2i", Category: category("scene"), Sort: 30, Active: true},
		{Title: "第一", Prompt: "prompt first", TaskType: "t2i", Category: category("portrait"), Sort: 10, Active: true},
		{Title: "第二", Prompt: "prompt second", TaskType: "t2i", Category: category("portrait"), Sort: 20, Active: true},
	} {
		if _, err := store.InsertPromptEntry(ctx, st.Pool, entry); err != nil {
			t.Fatal(err)
		}
	}

	filter := store.PromptFilter{TaskType: "t2i", ActiveOnly: true}
	first, err := store.ListPromptEntries(ctx, st.Pool, filter, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 || first[0].Sort != 10 {
		t.Fatalf("first page must start at sort 10, got %#v", first)
	}
	createdAt, id := first[0].CursorKey()
	second, err := store.ListPromptEntries(ctx, st.Pool, filter, 1, &store.Cursor{CreatedAt: createdAt, ID: id})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 2 || second[0].Sort != 20 {
		t.Fatalf("second page must start at sort 20, got %#v", second)
	}

	counts, err := store.CountPromptEntriesByCategory(ctx, st.Pool, filter)
	if err != nil {
		t.Fatal(err)
	}
	if counts["all"] != 3 || counts["portrait"] != 2 || counts["scene"] != 1 {
		t.Fatalf("unexpected category counts: %#v", counts)
	}
}
