package assistantmemory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func newUser(t *testing.T, ctx context.Context, st *store.Store) *store.User {
	t.Helper()
	user, err := store.InsertUser(ctx, st.Pool, fmt.Sprintf("m-%s@test.dev", uuid.NewString()[:8]), "seller", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func TestRememberReplacesTheSameTitleAndKeepsUsersApart(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, other := newUser(t, ctx, st), newUser(t, ctx, st)

	created, err := Remember(ctx, st, user.ID, Input{Kind: KindBrand, Title: " 品牌色 ", Content: "蓝色"}, Origin{Source: SourceAssistant})
	if err != nil {
		t.Fatal(err)
	}
	if created.Action != ActionCreated || created.Memory.Title != "品牌色" || created.Memory.Source != SourceAssistant || created.Previous != nil {
		t.Fatalf("created = %+v", created)
	}
	// Same kind and title (any case) replaces instead of duplicating.
	replaced, err := Remember(ctx, st, user.ID, Input{Kind: KindBrand, Title: "品牌色", Content: "雾霾蓝"}, Origin{})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Action != ActionUpdated || replaced.Memory.ID != created.Memory.ID || replaced.Previous.Content != "蓝色" || replaced.Memory.Content != "雾霾蓝" {
		t.Fatalf("replaced = %+v", replaced)
	}
	all, err := List(ctx, st.Pool, user.ID)
	if err != nil || len(all) != 1 {
		t.Fatalf("list = %+v %v", all, err)
	}

	// Another user can neither see nor touch it.
	if _, err := Get(ctx, st.Pool, other.ID, created.Memory.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other get err = %v", err)
	}
	if _, err := Forget(ctx, st.Pool, other.ID, created.Memory.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other forget err = %v", err)
	}
	if _, err := Update(ctx, st, other.ID, created.Memory.ID, Patch{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other update err = %v", err)
	}
}

func TestRememberValidates(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, other := newUser(t, ctx, st), newUser(t, ctx, st)
	for name, in := range map[string]Input{
		"kind":         {Kind: "secret", Title: "x"},
		"title":        {Kind: KindStyle, Title: "  "},
		"long title":   {Kind: KindStyle, Title: strings.Repeat("长", MaxTitle+1)},
		"long content": {Kind: KindStyle, Title: "x", Content: strings.Repeat("长", MaxContent+1)},
		"foreign":      {Kind: KindProduct, Title: "杯子", ImageKeys: []string{"uploads/" + other.ID.String() + "/a.png"}},
		"traversal":    {Kind: KindProduct, Title: "杯子", ImageKeys: []string{"uploads/" + user.ID.String() + "/../x.png"}},
	} {
		if _, err := Remember(ctx, st, user.ID, in, Origin{}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
	own := "/api/v1/files/uploads/" + user.ID.String() + "/cup.png"
	change, err := Remember(ctx, st, user.ID, Input{Kind: KindProduct, Title: "保温杯", ImageKeys: []string{own, own}}, Origin{})
	if err != nil {
		t.Fatal(err)
	}
	if got := change.Memory.ImageKeys; len(got) != 1 || got[0] != "uploads/"+user.ID.String()+"/cup.png" || change.Memory.ImageURLs[0] != own {
		t.Fatalf("keys = %v urls = %v", got, change.Memory.ImageURLs)
	}
	// The cap holds.
	if _, err := st.Pool.Exec(ctx, `INSERT INTO assistant_memories (user_id, kind, title)
		SELECT $1, 'habit', 'h' || g FROM generate_series(1, $2) g`, user.ID, MaxPerUser-1); err != nil {
		t.Fatal(err)
	}
	if _, err := Remember(ctx, st, user.ID, Input{Kind: KindHabit, Title: "one more"}, Origin{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("over cap err = %v", err)
	}
	// Replacing an existing one still works at the cap.
	if _, err := Remember(ctx, st, user.ID, Input{Kind: KindHabit, Title: "h1", Content: "x"}, Origin{}); err != nil {
		t.Fatalf("replace at cap: %v", err)
	}
}

func TestUpdateForgetAndSearch(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user := newUser(t, ctx, st)
	style, _ := Remember(ctx, st, user.ID, Input{Kind: KindStyle, Title: "画面风格", Content: "喜欢暖色调、柔光，不要赛博朋克"}, Origin{})
	if _, err := Remember(ctx, st, user.ID, Input{Kind: KindHabit, Title: "常用平台", Content: "天猫，主图 1:1"}, Origin{}); err != nil {
		t.Fatal(err)
	}

	content := "喜欢冷色调"
	updated, err := Update(ctx, st, user.ID, style.Memory.ID, Patch{Content: &content})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Previous.Content != style.Memory.Content || updated.Memory.Content != content || updated.Memory.Title != "画面风格" {
		t.Fatalf("updated = %+v", updated)
	}
	empty := ""
	if _, err := Update(ctx, st, user.ID, style.Memory.ID, Patch{Title: &empty}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty title err = %v", err)
	}

	hits, err := Search(ctx, st.Pool, user.ID, "天猫 1:1", "")
	if err != nil || len(hits) != 1 || hits[0].Kind != KindHabit {
		t.Fatalf("search = %+v %v", hits, err)
	}
	if hits, _ := Search(ctx, st.Pool, user.ID, "", KindStyle); len(hits) != 1 {
		t.Fatalf("by kind = %+v", hits)
	}
	if hits, _ := Search(ctx, st.Pool, user.ID, "100%", ""); len(hits) != 0 {
		t.Fatalf("like wildcards must be literal: %+v", hits)
	}

	forgotten, err := Forget(ctx, st.Pool, user.ID, style.Memory.ID)
	if err != nil || forgotten.Action != ActionDeleted || forgotten.Previous.Content != content {
		t.Fatalf("forget = %+v %v", forgotten, err)
	}
	if _, err := Get(ctx, st.Pool, user.ID, style.Memory.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get after forget err = %v", err)
	}
}

func TestLoadRespectsTheSwitch(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user := newUser(t, ctx, st)
	if _, err := Remember(ctx, st, user.ID, Input{Kind: KindBrand, Title: "品牌名", Content: "暖光小屋"}, Origin{}); err != nil {
		t.Fatal(err)
	}
	recall, err := Load(ctx, st.Pool, user.ID)
	if err != nil || !recall.Enabled || !strings.Contains(recall.Block, "暖光小屋") {
		t.Fatalf("recall = %+v %v", recall, err)
	}
	if err := SetEnabled(ctx, st.Pool, user.ID, false); err != nil {
		t.Fatal(err)
	}
	recall, err = Load(ctx, st.Pool, user.ID)
	if err != nil || recall.Enabled || recall.Block != "" || len(recall.Memories) != 0 {
		t.Fatalf("recall while off = %+v %v", recall, err)
	}
	// Off keeps the memories.
	if all, _ := List(ctx, st.Pool, user.ID); len(all) != 1 {
		t.Fatalf("memories lost when switched off: %+v", all)
	}
}

func TestPromptBlockAndProductFor(t *testing.T) {
	memories := []Memory{
		{ID: uuid.New(), Kind: KindBrand, Title: "品牌色", Content: "雾霾蓝"},
		{ID: uuid.New(), Kind: KindProduct, Title: "保温杯", Content: "316 不锈钢，12 小时保温", ImageKeys: []string{"uploads/u/a.png"}},
		{ID: uuid.New(), Kind: KindProduct, Title: "保温杯 Pro", ImageKeys: []string{"uploads/u/b.png"}},
		{ID: uuid.New(), Kind: KindProduct, Title: "茶杯"},
	}
	block := PromptBlock(memories)
	if !strings.Contains(block, "品牌色：雾霾蓝") || !strings.Contains(block, "保温杯（有 1 张图）") || strings.Contains(block, "316 不锈钢") {
		t.Fatalf("block = %s", block)
	}
	if strings.Index(block, "品牌资料") > strings.Index(block, "商品") {
		t.Fatalf("kinds out of order: %s", block)
	}
	if got := ProductFor(memories, "用我的保温杯 pro 做一套天猫主图"); got == nil || got.Title != "保温杯 Pro" {
		t.Fatalf("product = %+v", got)
	}
	if got := ProductFor(memories, "给茶杯做主图"); got != nil {
		t.Fatalf("a product without photos cannot stand in for uploads: %+v", got)
	}

	var many []Memory
	for index := 0; index < 200; index++ {
		many = append(many, Memory{ID: uuid.New(), Kind: KindStyle, Title: fmt.Sprintf("偏好 %d", index), Content: strings.Repeat("长", 40)})
	}
	if long := PromptBlock(many); len([]rune(long)) > promptBudget+400 || !strings.Contains(long, "memory_search") {
		t.Fatalf("budget not enforced: %d runes", len([]rune(long)))
	}
}

func TestFavoriteFromSet(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, other := newUser(t, ctx, st), newUser(t, ctx, st)
	set, err := store.InsertCommerceSet(ctx, st.Pool, &store.CommerceSet{UserID: user.ID,
		Brief:   json.RawMessage(`{"productName":"保温杯","platform":"天猫","sellingPoints":"12 小时保温"}`),
		Summary: "清爽白蓝主线", InputKeys: []string{"uploads/cup.png"}, ModelID: "img",
		Shots: []store.CommerceSetShot{{ID: "white", Label: "白底主图"}, {ID: "selling", Label: "卖点图", Headline: "一杯暖一天"}}})
	if err != nil {
		t.Fatal(err)
	}
	in, err := FavoriteFromSet(ctx, st.Pool, user.ID, set.ID)
	if err != nil {
		t.Fatal(err)
	}
	if in.Kind != KindFavorite || in.Title != "电商套图 · 保温杯 · 天猫" || !strings.Contains(in.Content, "清爽白蓝主线") ||
		!strings.Contains(in.Content, "卖点图 一杯暖一天") || len(in.ImageKeys) != 0 {
		t.Fatalf("favorite = %+v", in)
	}
	if _, err := FavoriteFromSet(ctx, st.Pool, other.ID, set.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user's set err = %v", err)
	}
}
