package store_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// Popularity and manual orders carry the sort value in the cursor, so deleting
// the cursor row (or changing its counters) cannot empty or shift the next page.
func TestPromptValueCursorSurvivesCursorRowChanges(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	for i := 0; i < 7; i++ {
		if _, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
			Title: fmt.Sprintf("p%d", i), Prompt: fmt.Sprintf("prompt %d", i), TaskType: "t2i",
			Sort: i, LikeCount: 10 - i, Active: true,
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, order := range []string{"likes", "manual"} {
		first, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{Order: order}, 3, nil)
		if err != nil || len(first) != 4 {
			t.Fatalf("%s first page = %d rows, %v", order, len(first), err)
		}
		last := first[2]
		if last.OrderValue == nil {
			t.Fatalf("%s: missing order value", order)
		}
		cursor := &store.Cursor{CreatedAt: last.CreatedAt, ID: last.ID, Value: last.OrderValue}
		if err := store.DeletePromptEntry(ctx, st.Pool, last.ID); err != nil {
			t.Fatal(err)
		}
		next, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{Order: order}, 3, cursor)
		if err != nil {
			t.Fatal(err)
		}
		if len(next) == 0 || next[0].ID != first[3].ID {
			t.Fatalf("%s: next page after deleting cursor row starts wrong: %d rows", order, len(next))
		}
		jumped, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{Order: order}, 3, &store.Cursor{Offset: 2})
		if err != nil || len(jumped) == 0 || jumped[0].ID != first[3].ID {
			t.Fatalf("%s: offset page = %d rows, %v", order, len(jumped), err)
		}
	}
}
