package store_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// Editing a product that has not been reached yet must not hide it from the
// remaining pages (the list used to be keyed on updated_at).
func TestEcommerceProductPagingSurvivesEdits(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "shop-"+uuid.NewString()+"@test.dev", "shop", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	var ids []uuid.UUID
	for i := 0; i < 5; i++ {
		product, err := store.InsertEcommerceProduct(ctx, st.Pool, store.NewEcommerceProduct{UserID: user.ID, SKU: fmt.Sprintf("sku-%d", i), Title: fmt.Sprintf("p%d", i), AssetIDs: []string{uuid.NewString()}})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, product.ID)
	}
	seen := map[uuid.UUID]int{}
	var cursor *store.Cursor
	for page := 0; page < 5; page++ {
		rows, err := store.ListEcommerceProducts(ctx, st.Pool, user.ID, "", "", 2, cursor)
		if err != nil {
			t.Fatal(err)
		}
		hasMore := len(rows) > 2
		if hasMore {
			rows = rows[:2]
		}
		for _, row := range rows {
			seen[row.ID]++
		}
		if page == 0 {
			// Touch the oldest product, which is still on a later page.
			if _, err := st.Pool.Exec(ctx, `UPDATE ecommerce_products SET updated_at = now() + interval '1 minute' WHERE id = $1`, ids[0]); err != nil {
				t.Fatal(err)
			}
		}
		if !hasMore {
			break
		}
		last := rows[len(rows)-1]
		created, id := last.CursorKey()
		cursor = &store.Cursor{CreatedAt: created, ID: id}
	}
	for _, id := range ids {
		if seen[id] != 1 {
			t.Fatalf("product %s seen %d times", id, seen[id])
		}
	}
}
