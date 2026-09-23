package httpapi

import (
	"strings"
	"testing"
)

func TestDecodeEcommerceListingPlanAlignsToRequestedTypes(t *testing.T) {
	types := []ecommerceListingPlanTypeIn{
		{ID: "white", Label: "产品白底图"},
		{ID: "hero", Label: "首屏视觉图"},
		{ID: "spec", Label: "规格参数图"},
	}
	raw := "```json\n" + `{"summary":"以清晨厨房为主线","items":[
		{"id":"hero","headline":"一杯，唤醒清晨","subline":"三档温控 · 保温 6 小时","direction":"商品居中，晨光斜射"},
		{"id":"unknown","headline":"不该出现"},
		{"id":"white","headline":"","subline":"","direction":"纯白背景正面"}
	]}` + "\n```"
	plan, err := decodeEcommerceListingPlan(raw, types)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if plan.Summary != "以清晨厨房为主线" {
		t.Fatalf("summary = %q", plan.Summary)
	}
	if len(plan.Items) != 3 {
		t.Fatalf("items = %d, want 3 (one per requested type)", len(plan.Items))
	}
	for i, want := range []string{"white", "hero", "spec"} {
		if plan.Items[i].ID != want {
			t.Fatalf("items[%d].id = %q, want %q", i, plan.Items[i].ID, want)
		}
	}
	if plan.Items[1].Headline != "一杯，唤醒清晨" || plan.Items[1].Subline != "三档温控 · 保温 6 小时" {
		t.Fatalf("hero item not preserved: %+v", plan.Items[1])
	}
	if plan.Items[2].Headline != "" || plan.Items[2].Direction != "" {
		t.Fatalf("missing type should yield empty item, got %+v", plan.Items[2])
	}
}

func TestDecodeEcommerceListingPlanRejectsEmpty(t *testing.T) {
	types := []ecommerceListingPlanTypeIn{{ID: "white"}}
	if _, err := decodeEcommerceListingPlan(`{"summary":"x","items":[{"id":"white","headline":"  "}]}`, types); err == nil {
		t.Fatal("expected error when no headline is filled")
	}
	if _, err := decodeEcommerceListingPlan("no json here", types); err == nil {
		t.Fatal("expected error for non-JSON reply")
	}
}

func TestDecodeEcommerceListingPlanTruncatesLongCopy(t *testing.T) {
	types := []ecommerceListingPlanTypeIn{{ID: "hero"}}
	long := strings.Repeat("长", 200)
	plan, err := decodeEcommerceListingPlan(`{"items":[{"id":"hero","headline":"`+long+`","subline":"`+long+`","direction":"`+long+`"}]}`, types)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if n := len([]rune(plan.Items[0].Headline)); n != 24 {
		t.Fatalf("headline runes = %d, want 24", n)
	}
	if n := len([]rune(plan.Items[0].Subline)); n != 40 {
		t.Fatalf("subline runes = %d, want 40", n)
	}
	if n := len([]rune(plan.Items[0].Direction)); n != 120 {
		t.Fatalf("direction runes = %d, want 120", n)
	}
}

func TestNormalizeEcommerceListingPlanTypes(t *testing.T) {
	if _, err := normalizeEcommerceListingPlanTypes(nil); err == nil {
		t.Fatal("expected error for empty types")
	}
	tooMany := make([]ecommerceListingPlanTypeIn, ecommerceListingPlanMaxTypes+1)
	for i := range tooMany {
		tooMany[i].ID = strings.Repeat("a", i+1)
	}
	if _, err := normalizeEcommerceListingPlanTypes(tooMany); err == nil {
		t.Fatal("expected error for too many types")
	}
	if _, err := normalizeEcommerceListingPlanTypes([]ecommerceListingPlanTypeIn{{ID: "  "}}); err == nil {
		t.Fatal("expected error for blank id")
	}
	out, err := normalizeEcommerceListingPlanTypes([]ecommerceListingPlanTypeIn{
		{ID: " white ", Label: " 白底 "},
		{ID: "white", Label: "重复"},
		{ID: "hero", Direction: strings.Repeat("方", 500)},
	})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(out) != 2 || out[0].ID != "white" || out[0].Label != "白底" || out[1].ID != "hero" {
		t.Fatalf("unexpected normalized types: %+v", out)
	}
	if n := len([]rune(out[1].Direction)); n != 400 {
		t.Fatalf("direction runes = %d, want 400", n)
	}
}

func TestBuildEcommerceListingPlanPromptIncludesTypesAndNote(t *testing.T) {
	prompt := buildEcommerceListingPlanPrompt(ecommerceListingPlanIn{
		Platform: "Amazon", Market: "美国", Language: "英文",
		ProductName: "保温杯", SellingPoints: "6 小时保温", Note: "暖色调",
	}, []ecommerceListingPlanTypeIn{{ID: "hero", Label: "首屏视觉图", Direction: "商品居中"}})
	for _, want := range []string{"id=hero", "首屏视觉图", "商品居中", "用户补充要求：暖色调", "使用「英文」书写", "Amazon", "保温杯"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	zh := buildEcommerceListingPlanPrompt(ecommerceListingPlanIn{Language: "简体中文"}, []ecommerceListingPlanTypeIn{{ID: "hero"}})
	if !strings.Contains(zh, "使用简体中文") {
		t.Fatalf("expected Chinese headline hint:\n%s", zh)
	}
}
