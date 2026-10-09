package httpapi

import (
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestDecodeChangelogDraft(t *testing.T) {
	raw := "```json\n{\"tag\":\"bogus\",\"title\":\" 出图更快 \",\"summary\":\"s\",\"items\":[\"- 4K 出图提速\",\"2、 修复预览\",\"  \",\"• 新增导出\"]}\n```"
	draft, err := decodeChangelogDraft(raw)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Tag != "experience" || draft.Title != "出图更快" {
		t.Fatalf("unexpected draft: %+v", draft)
	}
	want := []string{"4K 出图提速", "修复预览", "新增导出"}
	if strings.Join(draft.Items, "|") != strings.Join(want, "|") {
		t.Fatalf("items = %q, want %q", draft.Items, want)
	}
	if _, err := decodeChangelogDraft(`{"title":"x","items":[]}`); err == nil {
		t.Fatal("expected error for draft without items")
	}
}

func TestBuildChangelogDraftPromptPolishOnly(t *testing.T) {
	summary := "摘要"
	recent := []*store.ChangelogEntry{{Title: "旧标题", Summary: &summary, Items: []string{"旧条目"}}}
	prompt := buildChangelogDraftPrompt("", "feature", changelogDraftOut{Title: "草稿标题", Items: []string{"条目"}}, recent)
	for _, part := range []string{"只润色上面的草稿", "草稿标题", "旧标题", `"feature"`} {
		if !strings.Contains(prompt, part) {
			t.Errorf("prompt missing %q", part)
		}
	}
}
