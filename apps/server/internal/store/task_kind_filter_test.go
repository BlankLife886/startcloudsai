package store_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// AI 电商各模块只读取自己的历史：按 params._kind 过滤，不受其他模块任务数量挤占。
func TestListTasksByKindFiltersEcommerceModules(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("kind-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	insert := func(kind string) *store.Task {
		task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
			ID: uuid.New(), UserID: user.ID, Type: "ecommerce_design", Model: "image", Prompt: kind,
			Params: map[string]any{"_kind": kind}, Count: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	listing := insert("ui-design-ecommerce-listing-generation")
	for i := 0; i < 3; i++ {
		insert("ui-design-ecommerce-shoot-generation")
	}

	rows, err := store.ListTasksByKind(ctx, st.Pool, &user.ID, "ecommerce_design", "", "ui-design-ecommerce-listing-generation", nil, 2, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != listing.ID {
		t.Fatalf("listing history = %#v", rows)
	}
	all, err := store.ListTasks(ctx, st.Pool, &user.ID, "ecommerce_design", "", nil, 10, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 4 {
		t.Fatalf("unfiltered history = %d tasks, want 4", len(all))
	}
}
