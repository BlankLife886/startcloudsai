package store_test

import (
	"context"
	"errors"
	"strings"
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

	// 控制字符与双向控制符要被剔除：它们能把 @技能名 在视觉上伪装成别的名字。
	spoof := store.ImageSkill{
		Name:        "柔光\u202e人像\u0007",
		Description: "第一行\n第二行\u200b",
		Instruction: "正文\u0000保留\n换行",
		Tags:        []string{" 人像 ", "人像", "\u202e", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"},
	}
	if err := store.NormalizeSkill(&spoof); err != nil {
		t.Fatal(err)
	}
	if spoof.Name != "柔光人像" || spoof.Description != "第一行 第二行" || spoof.Instruction != "正文保留\n换行" {
		t.Fatalf("不安全字符未剔除: %q %q %q", spoof.Name, spoof.Description, spoof.Instruction)
	}
	if len(spoof.Tags) != store.SkillMaxTags || spoof.Tags[0] != "人像" || spoof.Tags[1] != "a" {
		t.Fatalf("标签未去重/限量: %v", spoof.Tags)
	}
	longTag := store.ImageSkill{Name: "x", Instruction: "x", Tags: []string{strings.Repeat("长", store.SkillMaxTagLen+1)}}
	if err := store.NormalizeSkill(&longTag); err == nil {
		t.Fatal("超长标签未被拒绝")
	}
}

// 调用名：名称能推导就推导，纯中文名用 id 兜底；官方全局唯一、自建按用户唯一，
// 自建允许与官方同名。
func TestSkillSlugDerivationAndUniqueness(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)
	otherID := skillTestUser(t, st)

	ascii := mustInsertSkill(t, st, &store.ImageSkill{Name: "  Soft Light: Portrait!  "})
	if ascii.Slug != "soft-light-portrait" {
		t.Fatalf("ASCII 名称未推导出 hyphen-case 调用名: %q", ascii.Slug)
	}
	chinese := mustInsertSkill(t, st, &store.ImageSkill{Name: "柔光人像"})
	if chinese.Slug != store.FallbackSkillSlug(chinese.ID) {
		t.Fatalf("中文名称未用 id 兜底: %q", chinese.Slug)
	}
	explicit := mustInsertSkill(t, st, &store.ImageSkill{Name: "柔光人像", Slug: "Soft-Portrait"})
	if explicit.Slug != "soft-portrait" {
		t.Fatalf("显式调用名未小写化: %q", explicit.Slug)
	}

	// 官方同名冲突。
	if _, err := store.InsertSkill(ctx, st.Pool, &store.ImageSkill{Name: "撞名", Slug: "soft-portrait", Instruction: "x", Active: true}); !errors.Is(err, store.ErrSkillSlugTaken) {
		t.Fatalf("官方调用名重复应报 ErrSkillSlugTaken，实际: %v", err)
	}
	// 自建可以和官方同名，两个用户之间也互不影响，同一用户内不能重复。
	mine := mustInsertSkill(t, st, &store.ImageSkill{Name: "我的柔光", Slug: "soft-portrait", OwnerUserID: &userID})
	mustInsertSkill(t, st, &store.ImageSkill{Name: "别人的柔光", Slug: "soft-portrait", OwnerUserID: &otherID})
	if _, err := store.InsertSkill(ctx, st.Pool, &store.ImageSkill{Name: "再来一个", Slug: "soft-portrait", OwnerUserID: &userID, Instruction: "x", Active: true}); !errors.Is(err, store.ErrSkillSlugTaken) {
		t.Fatalf("同一用户内调用名重复应报 ErrSkillSlugTaken，实际: %v", err)
	}
	// 改名时也要查重。
	mine.Slug = store.FallbackSkillSlug(chinese.ID)
	if _, err := store.UpdateSkill(ctx, st.Pool, &mine); err != nil {
		t.Fatalf("自建改成与官方相同的调用名应被允许: %v", err)
	}

	// 非法格式被拒。
	for _, bad := range []string{"1abc", "-abc", "abc-", "a--b", "Ab c", "中文", "a_b"} {
		candidate := store.ImageSkill{Name: "x", Slug: bad, Instruction: "x"}
		if err := store.NormalizeSkill(&candidate); err == nil {
			t.Fatalf("非法调用名 %q 未被拒绝", bad)
		}
	}
}

// 云端配额只算存在云端的自建 skill，官方与别人的都不计入。
func TestCountSkillsOwnedByOnlyCountsOwnCloudSkills(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := skillTestUser(t, st)
	otherID := skillTestUser(t, st)

	mustInsertSkill(t, st, &store.ImageSkill{Name: "官方"})
	mustInsertSkill(t, st, &store.ImageSkill{Name: "别人的", OwnerUserID: &otherID})
	for index := 0; index < store.SkillMaxOwnedPerUser; index++ {
		mustInsertSkill(t, st, &store.ImageSkill{Name: "我的", OwnerUserID: &userID})
	}
	owned, err := store.CountSkillsOwnedBy(ctx, st.Pool, userID)
	if err != nil {
		t.Fatal(err)
	}
	if owned != store.SkillMaxOwnedPerUser {
		t.Fatalf("配额统计应只算自己的云端 skill，得到 %d", owned)
	}
	if store.SkillMaxOwnedPerUser != 5 {
		t.Fatalf("云端配额约定为 5，实际 %d", store.SkillMaxOwnedPerUser)
	}
}
