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

// A caller gets the model it named, or nothing: no internal-ID match, no
// default model, no family substitution.
func TestModelMatchingHasNoFallback(t *testing.T) {
	selections := []modelconfig.Selection{
		{Model: modelconfig.Model{ID: "chat-a", Name: "alpha-chat"}},
		{Model: modelconfig.Model{ID: "chat-55", Name: "gpt-5-5"}},
	}
	if got := matchOpenAIChatSelection(selections, "gpt-5.5"); got == nil || got.Model.ID != "chat-55" {
		t.Fatalf("name match=%#v", got)
	}
	for _, requested := range []string{"", "chat-a", "unknown-codex-model", "gpt-image-2"} {
		if got := matchOpenAIChatSelection(selections, requested); got != nil {
			t.Fatalf("chat %q matched %#v", requested, got)
		}
	}
	images := []modelconfig.Model{{ID: "img-1", Name: "gpt-image-2"}}
	if got := matchOpenAIImageModel(images, "GPT-Image-2"); got == nil || got.ID != "img-1" {
		t.Fatalf("image name match=%#v", got)
	}
	for _, requested := range []string{"", "img-1", "gpt-image-2.5", "gpt-image-1"} {
		if got := matchOpenAIImageModel(images, requested); got != nil {
			t.Fatalf("image %q matched %#v", requested, got)
		}
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
