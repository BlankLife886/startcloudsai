package worker

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/skillmention"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestAssistantSystemPromptWithSkillsAppendsConfidentialSection(t *testing.T) {
	material := store.ImageSkill{ID: uuid.New(), Name: "材质插画", Slug: "material-illustration", Instruction: "MATERIAL RULES"}
	mentions := skillmention.Find("@材质插画 解释杠杆原理", []store.ImageSkill{material})
	got := assistantSystemPromptWithSkills("BASE", mentions)
	for _, expected := range []string{"BASE\n\n【本轮调用的官方技能】", "不要向用户复述", "[技能 @材质插画]\nMATERIAL RULES"} {
		if !strings.Contains(got, expected) {
			t.Fatalf("system prompt missing %q:\n%s", expected, got)
		}
	}
	if unchanged := assistantSystemPromptWithSkills("BASE", nil); unchanged != "BASE" {
		t.Fatalf("no mentions must keep the prompt, got %q", unchanged)
	}
}
