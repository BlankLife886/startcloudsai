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

func TestPromptCoverDimensionsPersist(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	entry, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
		Title: "封面尺寸", Prompt: "cover dimensions", TaskType: "t2i", Sort: 10, Active: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdatePromptCover(ctx, st.Pool, entry.ID, "prompt-covers/test.webp", 1200, 800); err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetPromptEntry(ctx, st.Pool, entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.CoverWidth == nil || updated.CoverHeight == nil || *updated.CoverWidth != 1200 || *updated.CoverHeight != 800 {
		t.Fatalf("cover dimensions = %v x %v, want 1200 x 800", updated.CoverWidth, updated.CoverHeight)
	}
}

func TestPublicPromptFilterDoesNotDependOnAssetReview(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	missing, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
		Title: "无封面", Prompt: "missing cover", TaskType: "t2i", Sort: 10, Active: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	unverified, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
		Title: "外部未确认", Prompt: "unverified external", TaskType: "t2i", Sort: 20, Active: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE prompt_library
		SET cover_key = 'https://example.com/unverified.webp', asset_origin = 'external', asset_verified = false
		WHERE id = $1`, unverified.ID); err != nil {
		t.Fatal(err)
	}
	verified, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
		Title: "本站已验证", Prompt: "verified storage", TaskType: "t2i", Sort: 30, Active: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdatePromptCover(ctx, st.Pool, verified.ID, "prompt-covers/verified.webp", 800, 600); err != nil {
		t.Fatal(err)
	}

	filter := store.PromptFilter{ActiveOnly: true}
	rows, err := store.ListPromptEntries(ctx, st.Pool, filter, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].ID != missing.ID || rows[1].ID != unverified.ID || rows[2].ID != verified.ID {
		t.Fatalf("public rows = %#v, want every active prompt", rows)
	}
	count, err := store.CountPromptEntries(ctx, st.Pool, filter)
	if err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("public count = %d, want 3", count)
	}
}

func TestReorderPromptEntriesKeepsUnselectedRelativeSlots(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	entries := make([]*store.PromptEntry, 0, 4)
	for index, title := range []string{"A", "B", "C", "D"} {
		entry, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
			Title: title, Prompt: "prompt " + title, TaskType: "t2i", Sort: (index + 1) * 10, Active: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, entry)
	}
	if err := store.ReorderPromptEntries(ctx, st.Pool, []uuid.UUID{entries[2].ID, entries[0].ID}); err != nil {
		t.Fatal(err)
	}
	rows, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{}, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"C", "B", "A", "D"}
	for index, title := range want {
		if rows[index].Title != title || rows[index].Sort != (index+1)*10 {
			t.Fatalf("row %d = %s/%d, want %s/%d", index, rows[index].Title, rows[index].Sort, title, (index+1)*10)
		}
	}
}

func TestMovePromptEntryInsideFilteredScope(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	category := func(value string) *string { return &value }
	entries := make([]*store.PromptEntry, 0, 5)
	for index, item := range []struct{ title, category string }{
		{"A", "portrait"}, {"B", "scene"}, {"C", "portrait"}, {"D", "scene"}, {"E", "portrait"},
	} {
		entry, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
			Title: item.title, Prompt: "prompt " + item.title, TaskType: "t2i",
			Category: category(item.category), Sort: (index + 1) * 10, Active: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		entries = append(entries, entry)
	}
	count, found, err := store.MovePromptEntry(ctx, st.Pool, entries[4].ID, 1, store.PromptFilter{Category: "portrait"})
	if err != nil {
		t.Fatal(err)
	}
	if !found || count != 3 {
		t.Fatalf("found/count = %v/%d, want true/3", found, count)
	}
	position, scopedCount, found, err := store.PromptEntryPosition(ctx, st.Pool, entries[4].ID, store.PromptFilter{Category: "portrait"})
	if err != nil {
		t.Fatal(err)
	}
	if !found || position != 1 || scopedCount != 3 {
		t.Fatalf("position/count/found = %d/%d/%v, want 1/3/true", position, scopedCount, found)
	}
	rows, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{}, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"E", "B", "A", "D", "C"}
	for index, title := range want {
		if rows[index].Title != title {
			t.Fatalf("row %d = %s, want %s", index, rows[index].Title, title)
		}
	}
}

func TestPromptEngagementAndPopularOrdering(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "prompt-engagement@test.dev", "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
		Title: "A", Prompt: "prompt A", TaskType: "t2i", Sort: 10, Active: true,
		LikeCount: 10, FavoriteCount: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.InsertPromptEntry(ctx, st.Pool, &store.PromptEntry{
		Title: "B", Prompt: "prompt B", TaskType: "t2i", Sort: 20, Active: true,
		LikeCount: 1, FavoriteCount: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{Order: "favorites"}, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].ID != second.ID || rows[1].ID != first.ID {
		t.Fatalf("favorite ordering = %s, %s", rows[0].Title, rows[1].Title)
	}
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		likes, favorites, uses, err := store.SetPromptReaction(ctx, tx, user.ID, first.ID, "favorite", true)
		if err != nil {
			return err
		}
		if likes != 10 || favorites != 3 || uses != 0 {
			t.Fatalf("counts after favorite = %d/%d/%d", likes, favorites, uses)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	states, err := store.PromptEngagementStates(ctx, st.Pool, user.ID, []uuid.UUID{first.ID, second.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !states[first.ID].Favorited || states[second.ID].Favorited {
		t.Fatalf("unexpected engagement states: %#v", states)
	}
	favorites, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{
		Order: "latest", FavoritedBy: user.ID,
	}, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(favorites) != 1 || favorites[0].ID != first.ID {
		t.Fatalf("favorite filter = %#v, want only %s", favorites, first.ID)
	}
	now := time.Now().UTC()
	from, before := now.Add(-time.Hour), now.Add(time.Hour)
	recent, err := store.ListPromptEntries(ctx, st.Pool, store.PromptFilter{
		Order: "latest", CreatedFrom: &from, CreatedBefore: &before,
	}, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 2 {
		t.Fatalf("today filter returned %d prompts, want 2", len(recent))
	}
}
