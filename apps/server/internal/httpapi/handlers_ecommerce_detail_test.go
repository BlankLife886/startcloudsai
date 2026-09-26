package httpapi

import (
	"strings"
	"testing"
)

func TestDecodeEcommerceDetailPlanAlignsItemsAndPainPoints(t *testing.T) {
	types := []ecommerceListingPlanTypeIn{
		{ID: "hero", Label: "首屏主视觉"},
		{ID: "pain", Label: "痛点困扰图"},
		{ID: "custom-1", Label: "圣诞礼盒"},
	}
	raw := "```json\n" + `{"summary":"暖调居家质感","painPoints":["够不够亮","刺眼吗","","够不够亮","装不装得上","寿命","费电","接口","多余"],"items":[` +
		`{"id":"pain","headline":"夜里起身总是摸黑","subline":"","direction":"昏暗卧室，人物摸索开关"},` +
		`{"id":"hero","headline":"一盏灯，点亮整间屋","subline":"暖光 3000K","direction":"商品居中，暖色台面"},` +
		`{"id":"unknown","headline":"忽略","subline":"","direction":""}]}` + "\n```"
	plan, err := decodeEcommerceDetailPlan(raw, types)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(plan.Items) != 3 {
		t.Fatalf("items = %d, want 3", len(plan.Items))
	}
	if plan.Items[0].ID != "hero" || plan.Items[1].ID != "pain" || plan.Items[2].ID != "custom-1" {
		t.Fatalf("items must follow requested order: %+v", plan.Items)
	}
	if plan.Items[2].Headline != "" {
		t.Fatalf("missing item should stay empty, got %q", plan.Items[2].Headline)
	}
	if len(plan.PainPoints) != 6 {
		t.Fatalf("painPoints = %v, want 6 deduped entries", plan.PainPoints)
	}
	if plan.PainPoints[0] != "够不够亮" || plan.PainPoints[1] != "刺眼吗" {
		t.Fatalf("painPoints order/dedupe broken: %v", plan.PainPoints)
	}
}

func TestDecodeEcommerceDetailPlanRejectsEmpty(t *testing.T) {
	types := []ecommerceListingPlanTypeIn{{ID: "hero"}}
	if _, err := decodeEcommerceDetailPlan(`{"items":[{"id":"hero","headline":""}]}`, types); err == nil {
		t.Fatal("expected error for empty plan")
	}
}

func TestBuildEcommerceDetailPlanPromptIncludesAmazonAndExtras(t *testing.T) {
	body := ecommerceDetailPlanIn{
		InputKeys:   []string{"a", "b"},
		ExtraKeys:   []string{"c"},
		Platform:    "Amazon",
		Market:      "美国",
		Language:    "英文",
		Style:       "简约清新",
		Category:    "灯泡 / 照明",
		ProductName: "LED 灯泡",
		Note:        "突出节能",
		Amazon:      &ecommerceDetailPlanAmazonIn{MarketplaceID: "US", Tier: "premium", ASIN: "b0abc12345", CompetitorASIN: "B0XYZ99999"},
	}
	types := []ecommerceListingPlanTypeIn{{ID: "hero", Label: "首屏主视觉", Direction: "商品居中"}}
	prompt := buildEcommerceDetailPlanPrompt(body, types)
	for _, want := range []string{
		"id=hero", "首屏主视觉", "商品居中",
		"前 2 张是商品图", "其后 1 张是用户补充的参考图",
		"用户补充描述：突出节能", "商品品类：灯泡 / 照明", "视觉风格：简约清新",
		"站点 US", "档位 premium", "ASIN B0ABC12345", "竞品 ASIN B0XYZ99999",
		"painPoints", "使用「英文」书写",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q\n%s", want, prompt)
		}
	}
}

func TestBuildEcommerceDetailPlanPromptOmitsAmazonForOtherPlatforms(t *testing.T) {
	body := ecommerceDetailPlanIn{InputKeys: []string{"a"}, Platform: "淘宝 / 天猫 / 1688", Language: "简体中文"}
	prompt := buildEcommerceDetailPlanPrompt(body, []ecommerceListingPlanTypeIn{{ID: "hero"}})
	if strings.Contains(prompt, "Amazon A+ 语境") || strings.Contains(prompt, "补充的参考图") {
		t.Fatalf("unexpected amazon/extras context:\n%s", prompt)
	}
	if !strings.Contains(prompt, "使用简体中文") {
		t.Fatalf("expected zh headline hint:\n%s", prompt)
	}
}

func TestNormalizeEcommercePlanTypesCapsDetailDirections(t *testing.T) {
	in := make([]ecommerceListingPlanTypeIn, 0, ecommerceDetailPlanMaxTypes+1)
	for i := 0; i <= ecommerceDetailPlanMaxTypes; i++ {
		in = append(in, ecommerceListingPlanTypeIn{ID: strings.Repeat("x", i%5+1) + string(rune('a'+i%26))})
	}
	if _, err := normalizeEcommercePlanTypes(in, ecommerceDetailPlanMaxTypes, "出图方向"); err == nil {
		t.Fatal("expected error when exceeding max directions")
	}
	if _, err := normalizeEcommercePlanTypes(in[:ecommerceDetailPlanMaxTypes], ecommerceDetailPlanMaxTypes, "出图方向"); err != nil {
		t.Fatalf("unexpected error at limit: %v", err)
	}
}
