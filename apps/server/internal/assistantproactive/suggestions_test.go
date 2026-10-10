package assistantproactive

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func recentSet(status, product, platform string, age time.Duration, now time.Time) RecentSet {
	conversation := uuid.New()
	return RecentSet{ID: uuid.New(), ConversationID: &conversation, Status: status, ProductName: product, Platform: platform, CreatedAt: now.Add(-age)}
}

func TestBuildSuggestions(t *testing.T) {
	now := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	favorite := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindFavorite, Title: "精华液天猫套图", UpdatedAt: now.Add(-time.Hour)}
	older := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindFavorite, Title: "旧方案", UpdatedAt: now.Add(-48 * time.Hour)}
	cup := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindProduct, Title: "保温杯", ImageKeys: []string{"uploads/u/cup.png"}}
	serum := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindProduct, Title: "精华液", ImageKeys: []string{"uploads/u/serum.png"}}
	noPhoto := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindProduct, Title: "面霜"}

	t.Run("habit, favourite, product and resume", func(t *testing.T) {
		sets := []RecentSet{
			recentSet(store.CommerceSetPlanned, "口红", "京东", time.Hour, now),
			recentSet(store.CommerceSetDone, "精华液 30ml", "天猫", 24*time.Hour, now),
			recentSet(store.CommerceSetDone, "面膜", "天猫", 72*time.Hour, now),
		}
		got := Build(sets, []assistantmemory.Memory{older, serum, favorite, cup, noPhoto}, now)
		if len(got) != 3 {
			t.Fatalf("want 3 suggestions, got %+v", got)
		}
		if got[0].Kind != "resume" || got[0].ConversationID == nil || !strings.Contains(got[0].Text, "口红 · 京东") {
			t.Fatalf("resume first: %+v", got[0])
		}
		if got[1].Kind != "favorite" || got[1].Text != "按满意方案「精华液天猫套图」再做一套" || !strings.Contains(got[1].Reason, "天猫套图（2 套）") {
			t.Fatalf("latest favourite with habit: %+v", got[1])
		}
		// 精华液 already has a set ("精华液 30ml"), 面霜 has no photo: only the cup is left.
		if got[2].Kind != "product" || got[2].Prompt != "用我的保温杯做一套天猫电商套图" {
			t.Fatalf("unmade product with photo: %+v", got[2])
		}
		// The prompt has to name the product the way ProductFor looks it up.
		if product := assistantmemory.ProductFor([]assistantmemory.Memory{cup}, got[2].Prompt); product == nil {
			t.Fatal("product prompt must resolve to the remembered product")
		}
	})

	t.Run("stale plans and cancelled sets are ignored", func(t *testing.T) {
		sets := []RecentSet{
			recentSet(store.CommerceSetPlanned, "口红", "京东", 4*24*time.Hour, now),
			recentSet(store.CommerceSetCanceled, "a", "天猫", time.Hour, now),
			recentSet(store.CommerceSetCanceled, "b", "天猫", time.Hour, now),
		}
		if got := Build(sets, nil, now); len(got) != 0 {
			t.Fatalf("want nothing, got %+v", got)
		}
	})

	t.Run("habit without favourite", func(t *testing.T) {
		sets := []RecentSet{
			recentSet(store.CommerceSetDone, "a", "抖音", time.Hour, now),
			recentSet(store.CommerceSetDone, "b", "抖音", 2*time.Hour, now),
			recentSet(store.CommerceSetDone, "c", "天猫", 3*time.Hour, now),
		}
		got := Build(sets, nil, now)
		if len(got) != 1 || got[0].Kind != "habit" || got[0].Prompt != "帮我做一套抖音电商套图，商品是：" {
			t.Fatalf("habit card: %+v", got)
		}
	})

	t.Run("one set is not a habit", func(t *testing.T) {
		got := Build([]RecentSet{recentSet(store.CommerceSetDone, "a", "天猫", time.Hour, now)}, []assistantmemory.Memory{favorite}, now)
		if len(got) != 1 || strings.HasSuffix(got[0].Text, "天猫套图") || got[0].Reason != "你记下的满意方案" {
			t.Fatalf("favourite without habit: %+v", got)
		}
	})
}

func TestFavoriteCardText(t *testing.T) {
	now := time.Now()
	sets := []RecentSet{recentSet(store.CommerceSetDone, "a", "天猫", time.Hour, now), recentSet(store.CommerceSetDone, "b", "天猫", 2*time.Hour, now)}
	saved := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindFavorite, Title: "电商套图 · 精华液 · 天猫"}
	got := Build(sets, []assistantmemory.Memory{saved}, now)
	if got[0].Text != "按满意方案「精华液 · 天猫」再做一套" || !strings.Contains(got[0].Prompt, "「电商套图 · 精华液 · 天猫」") {
		t.Fatalf("saved set favourite: %+v", got[0])
	}
	other := assistantmemory.Memory{ID: uuid.New(), Kind: assistantmemory.KindFavorite, Title: "雾霾蓝主图"}
	if got := Build(sets, []assistantmemory.Memory{other}, now); got[0].Text != "按满意方案「雾霾蓝主图」再做一套天猫套图" {
		t.Fatalf("favourite without platform in name: %+v", got[0])
	}
}

func TestHabitsTieGoesToMostRecent(t *testing.T) {
	now := time.Now()
	habits := HabitsFrom([]RecentSet{
		recentSet(store.CommerceSetDone, "", "京东", time.Hour, now),
		recentSet(store.CommerceSetDone, "", "天猫", 2*time.Hour, now),
		recentSet(store.CommerceSetDone, "", "天猫", 3*time.Hour, now),
		recentSet(store.CommerceSetDone, "", "京东", 4*time.Hour, now),
	})
	if habits.TopPlatform != "京东" || habits.PlatformCount != 2 || habits.Sets != 4 {
		t.Fatalf("habits: %+v", habits)
	}
}

func TestHabitPrompt(t *testing.T) {
	if got := HabitNote(habitFacts(Habits{Sets: 1, TopPlatform: "天猫", PlatformCount: 1}, nil)); got != "" {
		t.Fatalf("no habit, no prompt: %q", got)
	}
	facts := habitFacts(Habits{Sets: 5, TopPlatform: "天猫", PlatformCount: 4},
		[]assistantmemory.Memory{{Kind: assistantmemory.KindFavorite, Title: "雾霾蓝主图"}})
	for _, want := range []string{"5 套", "天猫（4 套）", "「雾霾蓝主图」"} {
		if !strings.Contains(facts, want) {
			t.Fatalf("habit facts missing %q: %s", want, facts)
		}
	}
	if !strings.Contains(HabitNote(facts), "点明一次") {
		t.Fatal("habit note must ask the model to say it applied the habit")
	}
}

func TestSuggestRespectsSwitch(t *testing.T) {
	a := newActivity(t, 0)
	now := time.Now()
	for _, platform := range []string{"天猫", "天猫"} {
		if _, err := a.st.Pool.Exec(a.ctx, `INSERT INTO assistant_commerce_sets (user_id, status, brief) VALUES ($1, 'done', $2)`,
			a.user, `{"productName":"x","platform":"`+platform+`"}`); err != nil {
			t.Fatal(err)
		}
	}
	got, err := Suggest(a.ctx, a.st.Pool, a.user, now)
	if err != nil || len(got) != 1 || got[0].Kind != "habit" {
		t.Fatalf("suggest: %+v %v", got, err)
	}
	off := false
	if _, err := Update(a.ctx, a.st.Pool, a.user, Patch{Suggestions: &off}); err != nil {
		t.Fatal(err)
	}
	if got, err := Suggest(a.ctx, a.st.Pool, a.user, now); err != nil || len(got) != 0 {
		t.Fatalf("switched off: %+v %v", got, err)
	}
	if facts, err := HabitFacts(a.ctx, a.st.Pool, a.user, nil, now); err != nil || facts != "" {
		t.Fatalf("habit facts switched off: %q %v", facts, err)
	}
}
