package prompt

import (
	"os"
	"strings"
	"testing"
)

// 官方技能 SKILL.md 的正文必须与历史任务兼容用的常量一致，避免两份约定各自漂移。
func TestPortraitDirectorSkillFileMatchesLegacyPrompt(t *testing.T) {
	raw, err := os.ReadFile("skills/female-portrait-director/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(string(raw), "\n---\n", 2)
	if len(parts) != 2 {
		t.Fatal("SKILL.md is missing frontmatter")
	}
	if body := strings.TrimSpace(parts[1]); body != strings.TrimSpace(femalePortraitDirectorPrompt) {
		t.Fatal("SKILL.md body drifted from femalePortraitDirectorPrompt")
	}
}
