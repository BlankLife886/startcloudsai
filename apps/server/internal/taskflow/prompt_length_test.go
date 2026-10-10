package taskflow

import (
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestValidatePromptLengthPrefersModelLimit(t *testing.T) {
	selection := &modelconfig.Selection{Model: modelconfig.Model{PromptMaxChars: 20}}
	long := CreateInput{Prompt: strings.Repeat("字", 15), PromptMaxRunes: 10}
	if err := validatePromptLength(long, selection, true); err != nil {
		t.Fatalf("model limit 20 should allow 15 chars over global 10: %v", err)
	}
	selection.Model.PromptMaxChars = 5
	if err := validatePromptLength(long, selection, true); err == nil {
		t.Fatal("model limit 5 should reject 15 chars")
	}
	selection.Model.PromptMaxChars = 0
	if err := validatePromptLength(long, selection, true); err == nil {
		t.Fatal("without a model limit the global 10 applies")
	}
	if err := validatePromptLength(CreateInput{Prompt: long.Prompt}, selection, true); err != nil {
		t.Fatalf("no global limit for this task type: %v", err)
	}
	selection.Model.PromptMaxChars = 5
	if err := validatePromptLength(CreateInput{Prompt: long.Prompt}, selection, true); err == nil {
		t.Fatal("the model limit applies on pages without a global limit")
	}
}
