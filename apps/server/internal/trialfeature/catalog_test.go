package trialfeature_test

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
)

func TestCatalogIncludesAssistantAndInfiniteCanvas(t *testing.T) {
	for key, wantLabel := range map[string]string{
		trialfeature.AIAssistantKey:    "AI 助手",
		trialfeature.InfiniteCanvasKey: "无限画布",
	} {
		feature, ok := trialfeature.Get(key)
		if !ok || feature.Label != wantLabel || feature.Route == "" || feature.TaskTypes == nil {
			t.Fatalf("feature %q = %#v, %v", key, feature, ok)
		}
	}
}

func TestFeatureResolutionSeparatesCanvasFromSharedTaskTypes(t *testing.T) {
	canvas, ok := trialfeature.ForTask("t2i", map[string]any{"_source": "react_canvas"})
	if !ok || canvas.Key != trialfeature.InfiniteCanvasKey {
		t.Fatalf("canvas task feature = %#v, %v", canvas, ok)
	}
	image, ok := trialfeature.ForTask("t2i", nil)
	if !ok || image.Key != "text_to_image" {
		t.Fatalf("regular task feature = %#v, %v", image, ok)
	}
	assistant, ok := trialfeature.ForAssistantParams(map[string]any{"workspace": "assistant"})
	if !ok || assistant.Key != trialfeature.AIAssistantKey {
		t.Fatalf("assistant feature = %#v, %v", assistant, ok)
	}
	canvasAssistant, ok := trialfeature.ForAssistantParams(map[string]any{"workspace": "infinite_canvas"})
	if !ok || canvasAssistant.Key != trialfeature.InfiniteCanvasKey {
		t.Fatalf("canvas assistant feature = %#v, %v", canvasAssistant, ok)
	}
}
