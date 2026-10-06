package assistanttools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestAskChoicesNormalizesTheCard(t *testing.T) {
	raw := json.RawMessage(`{"title":"出图前确认几项","groups":[
		{"id":"ratio","label":"尺寸","options":["1:1","3:4","3:4"," 9:16 "]},
		{"label":"风格","options":["简约白底","生活场景"],"multiple":true},
		{"label":"只有一个","options":["唯一"]},
		{"id":"ratio","label":"重复","options":["a","b"]}
	]}`)
	choices, err := normalizeAskChoices(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(choices.Groups) != 2 {
		t.Fatalf("groups = %+v", choices.Groups)
	}
	if got := strings.Join(choices.Groups[0].Options, ","); got != "1:1,3:4,9:16" {
		t.Fatalf("options = %s", got)
	}
	if choices.Groups[1].ID != "风格" || !choices.Groups[1].Multiple {
		t.Fatalf("second group = %+v", choices.Groups[1])
	}
}

func TestAskChoicesRejectsAnEmptyCard(t *testing.T) {
	manifest := NewAskChoicesManifest()
	result, err := manifest.Tools[0].Execute(context.Background(), Invocation{Arguments: json.RawMessage(`{"groups":[{"label":"尺寸","options":["1:1"]}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	if result.Meta["invalid"] != true || !strings.Contains(result.Content, "至少") {
		t.Fatalf("result = %+v", result)
	}
	ok, err := manifest.Tools[0].Execute(context.Background(), Invocation{Arguments: json.RawMessage(`{"groups":[{"label":"尺寸","options":["1:1","3:4"]}]}`)})
	if err != nil || ok.Meta["view"] != "choices" {
		t.Fatalf("valid card: %+v %v", ok, err)
	}
	if card := ok.Meta["data"].(askChoices); card.Title != "先确认几项" {
		t.Fatalf("default title = %q", card.Title)
	}
}
