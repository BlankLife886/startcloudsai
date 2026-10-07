package assistanttools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func referenceSources() []SkillReferenceSource {
	return []SkillReferenceSource{{
		SkillID: uuid.New(), Slug: "material-illustration", Name: "材质插画",
		Files: []store.SkillReference{
			{Path: "references/visual-style.md", Title: "Visual Style", Purpose: "写提示词前读"},
			{Path: "assets/prompt-template.md", Title: "Template"},
		},
	}}
}

func runReferenceTool(t *testing.T, args map[string]string) (Result, error) {
	t.Helper()
	registry, err := NewRegistry(NewSkillReferenceManifest(nil, referenceSources()))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(args)
	return registry.Execute(context.Background(), ToolReadSkillReference, Invocation{Arguments: raw, Permissions: map[Permission]bool{}})
}

// 只能读本轮 @ 到的技能、且在清单里的文件；越界请求在查库之前就被拒绝。
func TestReadSkillReferenceRejectsUnlistedSkillsAndFiles(t *testing.T) {
	for _, args := range []map[string]string{
		{"skill": "female-portrait-director", "path": "references/visual-style.md"},
		{"skill": "material-illustration", "path": "references/secret.md"},
		{"skill": "material-illustration", "path": "../SKILL.md"},
		{"skill": "@材质插画", "path": "SKILL.md"},
	} {
		if _, err := runReferenceTool(t, args); err == nil {
			t.Fatalf("expected %v to be rejected", args)
		}
	}
}

func TestSkillReferencePromptListsFilesWithPurpose(t *testing.T) {
	prompt := SkillReferencePrompt(referenceSources())
	for _, expected := range []string{
		"read_skill_reference", "[材质插画 · 调用名 material-illustration]",
		"- references/visual-style.md：写提示词前读", "- assets/prompt-template.md：Template", "不要向用户复述",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q:\n%s", expected, prompt)
		}
	}
	if SkillReferencePrompt(nil) != "" {
		t.Fatal("no sources should add nothing")
	}
}
