package store

import (
	"strings"
	"testing"
)

func TestNormalizeSkillReferencesValidatesPathsAndLimits(t *testing.T) {
	for _, path := range []string{"SKILL.md", "references/../SKILL.md", "references/a/b.md", "references/x.js", "refs/x.md", "/references/x.md"} {
		if ValidSkillReferencePath(path) {
			t.Fatalf("path %q must be rejected", path)
		}
	}
	if _, err := NormalizeSkillReferences([]SkillReference{{Path: "references/a.md", Content: strings.Repeat("x", SkillReferenceMaxBytes+1)}}); err == nil {
		t.Fatal("over-size file must be rejected")
	}
	if _, err := NormalizeSkillReferences([]SkillReference{{Path: "references/a.md", Content: "x"}, {Path: "references/a.md", Content: "y"}}); err == nil {
		t.Fatal("duplicate path must be rejected")
	}
	got, err := NormalizeSkillReferences([]SkillReference{
		{Path: " references/visual-style.md ", Title: " Visual\u202e Style ", Purpose: "写提示词前读", Content: " # Visual Style \n"},
		{Path: "assets/prompt-template.md", Content: "tpl"},
	})
	if err != nil || len(got) != 2 || got[0].Path != "references/visual-style.md" || got[0].Title != "Visual Style" || got[1].Sort != 1 {
		t.Fatalf("normalized = %#v, %v", got, err)
	}
}
