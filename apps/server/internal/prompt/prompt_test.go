// prompt 编译模板。
package prompt_test

import (
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/prompt"
)

func TestT2IPassthrough(t *testing.T) {
	p, size := prompt.Compile("t2i", "一只猫", map[string]any{})
	if p != "一只猫" {
		t.Fatalf("prompt = %q, want passthrough", p)
	}
	if size != "" {
		t.Fatalf("size = %q, want empty", size)
	}
}

func TestSizeExtractedFromParams(t *testing.T) {
	_, size := prompt.Compile("t2i", "一只猫", map[string]any{"size": "1024x1024"})
	if size != "1024x1024" {
		t.Fatalf("size = %q, want 1024x1024", size)
	}
}

func TestTypeTemplatesIncludeUserPrompt(t *testing.T) {
	for _, taskType := range []string{"coloring", "ui_design", "model_sheet", "game_art", "puzzle"} {
		p, _ := prompt.Compile(taskType, "USERPROMPT", map[string]any{"style": "赛博朋克"})
		if !strings.Contains(p, "USERPROMPT") {
			t.Fatalf("%s: prompt missing user input: %q", taskType, p)
		}
		if !strings.Contains(p, "赛博朋克") {
			t.Fatalf("%s: prompt missing style: %q", taskType, p)
		}
		if p == "USERPROMPT" {
			t.Fatalf("%s: prompt should be templated", taskType)
		}
	}
}
