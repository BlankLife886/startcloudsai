package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

func TestOpenAIPublicModelIDUsesConfiguredName(t *testing.T) {
	model := modelconfig.Model{ID: "model-uuid-1", Name: "  gpt-image-2  "}
	if got := openAIPublicModelID(model); got != "gpt-image-2" {
		t.Fatalf("public id=%q", got)
	}
	object := asOpenAIModel(model)
	if object.ID != "gpt-image-2" {
		t.Fatalf("wire id=%q", object.ID)
	}
}

func TestMatchOpenAIChatSelectionPrefersNameThenID(t *testing.T) {
	selections := []modelconfig.Selection{
		{Model: modelconfig.Model{ID: "chat-a", Name: "alpha-chat"}},
		{Model: modelconfig.Model{ID: "chat-b", Name: "beta-chat"}},
	}
	if got := matchOpenAIChatSelection(selections, "beta-chat"); got == nil || got.Model.ID != "chat-b" {
		t.Fatalf("name match=%#v", got)
	}
	if got := matchOpenAIChatSelection(selections, "chat-a"); got == nil || got.Model.Name != "alpha-chat" {
		t.Fatalf("id fallback=%#v", got)
	}
	if got := matchOpenAIChatSelection(selections, ""); got == nil || got.Model.ID != "chat-a" {
		t.Fatalf("default=%#v", got)
	}
}

func TestMatchOpenAIChatSelectionAliasesDotsAndHyphens(t *testing.T) {
	selections := []modelconfig.Selection{
		{Model: modelconfig.Model{ID: "chat-55", Name: "gpt-5-5"}},
	}
	if got := matchOpenAIChatSelection(selections, "gpt-5.5"); got == nil || got.Model.ID != "chat-55" {
		t.Fatalf("alias match=%#v", got)
	}
	if got := matchOpenAIChatSelection(selections, "unknown-codex-model"); got == nil || got.Model.ID != "chat-55" {
		t.Fatalf("unknown fallback=%#v", got)
	}
	images := []modelconfig.Model{{ID: "img-1", Name: "gpt-image-2"}}
	if got := matchOpenAIChatSelection(selections, "gpt-image-2", images); got != nil {
		t.Fatalf("image model must not fall through to chat: %#v", got)
	}
}

func TestOpenAIWireModelEqual(t *testing.T) {
	if !openAIWireModelEqual("gpt-5-5", "gpt-5.5") {
		t.Fatal("expected gpt-5-5 and gpt-5.5 to match")
	}
	if openAIWireModelEqual("gpt-5-5", "gpt-5-6") {
		t.Fatal("different models must not match")
	}
}

func TestMatchOpenAIImageModelFamilyFallback(t *testing.T) {
	models := []modelconfig.Model{{ID: "img-1", Name: "gpt-image-2"}}
	if got := matchOpenAIImageModel(models, "gpt-image-2.5"); got == nil || got.ID != "img-1" {
		t.Fatalf("family fallback=%#v", got)
	}
	if got := matchOpenAIImageModel(models, "gpt-image-2"); got == nil || got.ID != "img-1" {
		t.Fatalf("exact match=%#v", got)
	}
}
