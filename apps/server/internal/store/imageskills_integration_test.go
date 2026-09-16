package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func skillTestUser(t *testing.T, st *store.Store) uuid.UUID {
	t.Helper()
	user, err := store.InsertUser(context.Background(), st.Pool,
		"skill-"+uuid.NewString()[:8]+"@test.dev", "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	return user.ID
}

func mustInsertSkill(t *testing.T, st *store.Store, skill *store.ImageSkill) store.ImageSkill {
	t.Helper()
	if skill.Instruction == "" {
		skill.Instruction = "保持画面干净，主体居中。"
	}
	skill.Active = true
	created, err := store.InsertSkill(context.Background(), st.Pool, skill)
	if err != nil {
		t.Fatalf("insert skill %s: %v", skill.Name, err)
	}
	return *created
}

// 页面绑定优先于全局：某页面一旦有绑定，就只用页面的，不再叠加全局。
func TestResolveSkillsPageBindingOverridesGlobal(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)

	global := mustInsertSkill(t, st, &store.ImageSkill{Name: "全局风格"})
	pageOne := mustInsertSkill(t, st, &store.ImageSkill{Name: "涂色专用", TaskTypes: []string{"coloring"}})
	pageTwo := mustInsertSkill(t, st, &store.ImageSkill{Name: "涂色补充", TaskTypes: []string{"coloring"}})

	if err := store.SetSkillBindings(ctx, st, userID, store.SkillGlobalScope, []uuid.UUID{global.ID}); err != nil {
		t.Fatal(err)
	}

	// 没有页面绑定时，全局对每个页面都生效。
	for _, taskType := range []string{"t2i", "coloring", "game_art"} {
		resolved, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, taskType)
		if err != nil {
			t.Fatal(err)
		}
		if len(resolved) != 1 || resolved[0].ID != global.ID {
			t.Fatalf("%s 未自动装载全局 skill: %+v", taskType, resolved)
		}
	}

	if err := store.SetSkillBindings(ctx, st, userID, "coloring", []uuid.UUID{pageTwo.ID, pageOne.ID}); err != nil {
		t.Fatal(err)
	}
	resolved, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, "coloring")
	if err != nil {
		t.Fatal(err)
	}
	// 覆盖而非叠加，且保留装载顺序。
	if len(resolved) != 2 || resolved[0].ID != pageTwo.ID || resolved[1].ID != pageOne.ID {
		t.Fatalf("页面绑定未覆盖全局或丢了顺序: %+v", resolved)
	}
	// 其他页面不受影响，仍回落到全局。
	other, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, "t2i")
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 1 || other[0].ID != global.ID {
		t.Fatalf("t2i 不该被 coloring 的绑定影响: %+v", other)
	}

	// 清空页面绑定后重新回落到全局。
	if err := store.SetSkillBindings(ctx, st, userID, "coloring", nil); err != nil {
		t.Fatal(err)
	}
	back, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, "coloring")
	if err != nil {
		t.Fatal(err)
	}
	if len(back) != 1 || back[0].ID != global.ID {
		t.Fatalf("清空页面绑定后未回落全局: %+v", back)
	}
}

// 停用或收窄适用范围的 skill 不能继续影响已有装载。
func TestResolveSkillsDropsInactiveAndInapplicable(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)

	wide := mustInsertSkill(t, st, &store.ImageSkill{Name: "通用"})
	kept := mustInsertSkill(t, st, &store.ImageSkill{Name: "保留"})
	if err := store.SetSkillBindings(ctx, st, userID, store.SkillGlobalScope, []uuid.UUID{wide.ID, kept.ID}); err != nil {
		t.Fatal(err)
	}

	// 后台把官方 skill 收窄到只适用于 coloring。
	wide.TaskTypes = []string{"coloring"}
	if _, err := store.UpdateSkill(ctx, st.Pool, &wide); err != nil {
		t.Fatal(err)
	}
	resolved, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, "t2i")
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved) != 1 || resolved[0].ID != kept.ID {
		t.Fatalf("收窄适用范围后仍在 t2i 生效: %+v", resolved)
	}

	// 停用后同样不再生效。
	kept.Active = false
	if _, err := store.UpdateSkill(ctx, st.Pool, &kept); err != nil {
		t.Fatal(err)
	}
	empty, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, "t2i")
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("停用的 skill 仍在生效: %+v", empty)
	}
}

func TestSetSkillBindingsRejectsForeignSkillsAndOverflow(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)
	otherID := skillTestUser(t, st)

	mine := mustInsertSkill(t, st, &store.ImageSkill{Name: "我的", OwnerUserID: &userID})
	theirs := mustInsertSkill(t, st, &store.ImageSkill{Name: "别人的", OwnerUserID: &otherID})

	if err := store.SetSkillBindings(ctx, st, userID, store.SkillGlobalScope, []uuid.UUID{mine.ID}); err != nil {
		t.Fatalf("自建 skill 应可装载: %v", err)
	}
	if err := store.SetSkillBindings(ctx, st, userID, store.SkillGlobalScope, []uuid.UUID{theirs.ID}); err == nil {
		t.Fatal("装载了别人的 skill")
	}
	// 失败的装载不能破坏原有状态。
	resolved, err := store.ResolveSkillsForTaskType(ctx, st.Pool, userID, "t2i")
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved) != 1 || resolved[0].ID != mine.ID {
		t.Fatalf("失败的装载破坏了原状态: %+v", resolved)
	}

	overflow := make([]uuid.UUID, 0, store.SkillMaxBindingsPerScope+1)
	for index := 0; index <= store.SkillMaxBindingsPerScope; index++ {
		skill := mustInsertSkill(t, st, &store.ImageSkill{Name: "批量", OwnerUserID: &userID})
		overflow = append(overflow, skill.ID)
	}
	if err := store.SetSkillBindings(ctx, st, userID, store.SkillGlobalScope, overflow); err == nil {
		t.Fatal("超出单位上限仍被接受")
	}
	if err := store.SetSkillBindings(ctx, st, userID, "no_such_page", []uuid.UUID{mine.ID}); err == nil {
		t.Fatal("未知装载位被接受")
	}
	// 绑定到不适用的页面要被拒。
	coloringOnly := mustInsertSkill(t, st, &store.ImageSkill{Name: "仅涂色", OwnerUserID: &userID, TaskTypes: []string{"coloring"}})
	if err := store.SetSkillBindings(ctx, st, userID, "t2i", []uuid.UUID{coloringOnly.ID}); err == nil {
		t.Fatal("skill 被绑定到不适用的页面")
	}
}

func TestListSkillsScopesOfficialAndOwned(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)
	otherID := skillTestUser(t, st)

	official := mustInsertSkill(t, st, &store.ImageSkill{Name: "官方词条", Sort: 10})
	mine := mustInsertSkill(t, st, &store.ImageSkill{Name: "我的词条", OwnerUserID: &userID})
	mustInsertSkill(t, st, &store.ImageSkill{Name: "别人的词条", OwnerUserID: &otherID})

	officialOnly, err := store.ListSkills(ctx, st.Pool, store.SkillFilter{OfficialOnly: true, ActiveOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(officialOnly) != 1 || officialOnly[0].ID != official.ID || !officialOnly[0].Official() {
		t.Fatalf("官方词库混入了用户 skill: %+v", officialOnly)
	}

	combined, err := store.ListSkills(ctx, st.Pool, store.SkillFilter{OwnerUserID: &userID, IncludeOfficial: true, ActiveOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(combined) != 2 || combined[0].ID != official.ID || combined[1].ID != mine.ID {
		t.Fatalf("用户端应拿到官方+自己的，且官方在前: %+v", combined)
	}

	// 只在对应页面可用的 skill 不应出现在其他页面的候选里。
	mustInsertSkill(t, st, &store.ImageSkill{Name: "仅游戏", TaskTypes: []string{"game_art"}})
	forT2I, err := store.ListSkills(ctx, st.Pool, store.SkillFilter{OfficialOnly: true, ActiveOnly: true, TaskType: "t2i"})
	if err != nil {
		t.Fatal(err)
	}
	if len(forT2I) != 1 || forT2I[0].ID != official.ID {
		t.Fatalf("t2i 候选包含了不适用的 skill: %+v", forT2I)
	}
}

func TestNormalizeSkillGuardsInput(t *testing.T) {
	long := make([]rune, store.SkillMaxInstructionLen+1)
	for index := range long {
		long[index] = '好'
	}
	for name, skill := range map[string]store.ImageSkill{
		"空名称":    {Name: "   ", Instruction: "x"},
		"空指令":    {Name: "标题", Instruction: "  "},
		"指令过长":   {Name: "标题", Instruction: string(long)},
		"未知生图页面": {Name: "标题", Instruction: "x", TaskTypes: []string{"nope"}},
	} {
		candidate := skill
		if err := store.NormalizeSkill(&candidate); err == nil {
			t.Fatalf("%s 未被拒绝", name)
		}
	}
	// 合法输入应收敛空白、去重并补齐空值。
	skill := store.ImageSkill{Name: "  风格  ", Instruction: "  保持构图  ", TaskTypes: []string{"t2i", "t2i", " coloring "}}
	if err := store.NormalizeSkill(&skill); err != nil {
		t.Fatal(err)
	}
	if skill.Name != "风格" || skill.Instruction != "保持构图" {
		t.Fatalf("未收敛空白: %+v", skill)
	}
	if len(skill.TaskTypes) != 2 || skill.TaskTypes[0] != "coloring" || skill.TaskTypes[1] != "t2i" {
		t.Fatalf("未去重或未排序: %+v", skill.TaskTypes)
	}
	if skill.Tags == nil {
		t.Fatalf("空值未补齐: %+v", skill)
	}
}

// 装载位只开放给「用户自己写提示词」的页面。放开其他类型会在装载页出现一堆
// 永远不生效的选项：puzzle 的任务服务端根本不受理，background_remove 与
// media_tool 的提示词是系统生成的固定文案，拼进 skill 指令不会有任何效果。
func TestSkillScopesCoverOnlyPromptDrivenPages(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)
	skill := mustInsertSkill(t, st, &store.ImageSkill{Name: "通用", Instruction: "保持构图"})

	want := []string{"t2i", "coloring", "ui_design", "ecommerce_design", "model_sheet", "game_art"}
	if len(store.SkillTaskTypes) != len(want) {
		t.Fatalf("装载位清单已变动，请同步迁移的 CHECK 与前端 SKILL_TASK_TYPES: %v", store.SkillTaskTypes)
	}
	for _, kind := range want {
		if !store.Contains(store.SkillTaskTypes, kind) {
			t.Fatalf("缺少生图页面 %s: %v", kind, store.SkillTaskTypes)
		}
		// 每个开放的装载位都要真能写入，否则 CHECK 与 Go 清单已经漂移。
		if err := store.SetSkillBindings(ctx, st, userID, kind, []uuid.UUID{skill.ID}); err != nil {
			t.Fatalf("装载位 %s 写入失败，迁移 CHECK 与 SkillTaskTypes 不一致: %v", kind, err)
		}
	}
	for _, kind := range []string{"puzzle", "background_remove", "media_tool", "infinite_canvas", "nope"} {
		if err := store.SetSkillBindings(ctx, st, userID, kind, []uuid.UUID{skill.ID}); err == nil {
			t.Fatalf("装载位 %s 不该被接受", kind)
		}
	}
}
