package skillmention

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func skill(name, slug, instruction string) store.ImageSkill {
	return store.ImageSkill{ID: uuid.New(), Name: name, Slug: slug, Instruction: instruction}
}

func TestFindMatchesNameAndSlugWithBoundaries(t *testing.T) {
	material := skill("材质插画", "material-illustration", "MATERIAL")
	portrait := skill("人像导演", "female-portrait-director", "PORTRAIT")
	skills := []store.ImageSkill{material, portrait}

	got := Find("画一张图 @人像导演，再来 @material-illustration 和 @材质插画", skills)
	if len(got) != 2 || got[0].Skill.ID != portrait.ID || got[1].Skill.ID != material.ID {
		t.Fatalf("mentions = %+v", got)
	}
	if mentions := Find("联系 a@材质插画 或 @material-illustrationx", skills); len(mentions) != 0 {
		t.Fatalf("emails and longer words must not match: %+v", mentions)
	}
	if mentions := Find("没有提及", skills); mentions != nil {
		t.Fatalf("no @ should return nil, got %+v", mentions)
	}
}

func TestFindPrefersLongestToken(t *testing.T) {
	short := skill("柔光", "soft", "SHORT")
	long := skill("柔光人像", "soft-portrait", "LONG")
	got := Find("@柔光人像一只猫", []store.ImageSkill{short, long})
	if len(got) != 1 || got[0].Skill.ID != long.ID {
		t.Fatalf("mentions = %+v", got)
	}
}

func TestComposeStripsTokenAndPutsInstructionFirst(t *testing.T) {
	material := skill("材质插画", "material-illustration", "MATERIAL RULES")
	mentions := Find("@材质插画  画一张流程图", []store.ImageSkill{material})
	got := Compose(Strip("@材质插画  画一张流程图", mentions), []store.ImageSkill{material})
	if got != "MATERIAL RULES\n\n画一张流程图" {
		t.Fatalf("composed = %q", got)
	}
}

func TestComposeDropsSkillsBeforeTruncatingUserInput(t *testing.T) {
	long := skill("长技能", "long", strings.Repeat("规", 5000))
	user := strings.Repeat("用", 2000)
	if got := Compose(user, []store.ImageSkill{long}); got != user {
		t.Fatalf("over-long skill must be dropped, kept %d runes", len([]rune(got)))
	}
}

func TestStripKeepsUnrelatedAtSigns(t *testing.T) {
	material := skill("材质插画", "material-illustration", "x")
	text := "邮箱 a@材质插画.com 保留，@材质插画 删除"
	got := Strip(text, Find(text, []store.ImageSkill{material}))
	if got != "邮箱 a@材质插画.com 保留， 删除" {
		t.Fatalf("stripped = %q", got)
	}
}
