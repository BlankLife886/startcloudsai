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

func TestSizeDerivedFromAspectRatioWhenMissing(t *testing.T) {
	_, size := prompt.Compile("t2i", "一只猫", map[string]any{
		"aspectRatio":     "16:9",
		"resolutionScale": "1K",
	})
	if size != "1088x608" {
		t.Fatalf("size = %q, want 1088x608 for 16:9 1K", size)
	}
}

func TestSizePrefersExplicitPixelsOverAspectRatio(t *testing.T) {
	_, size := prompt.Compile("t2i", "一只猫", map[string]any{
		"size":            "1536x1024",
		"aspectRatio":     "16:9",
		"resolutionScale": "1K",
	})
	if size != "1536x1024" {
		t.Fatalf("size = %q, want explicit 1536x1024", size)
	}
}

func TestAutoAspectRatioUsesAutoSize(t *testing.T) {
	_, size := prompt.Compile("t2i", "一只猫", map[string]any{"aspectRatio": "auto", "resolutionScale": "1K"})
	if size != "auto" {
		t.Fatalf("size = %q, want auto", size)
	}
}

func TestAutoAspectRatioCandidatesConstrainPrompt(t *testing.T) {
	p, _ := prompt.Compile("t2i", "山谷中的建筑", map[string]any{
		"aspectRatio":               "auto",
		"autoAspectRatioCandidates": []any{"1:1", "16:9", "9:16"},
	})
	if !strings.Contains(p, "最终图片比例只能从 1:1、16:9、9:16 中选择") {
		t.Fatalf("auto ratio boundary missing: %q", p)
	}
}

func TestUIDesignIterationLocksUnchangedContent(t *testing.T) {
	p, _ := prompt.Compile("ui_design", "只把主按钮改为蓝色", map[string]any{
		"platform":      "Web",
		"iterationMode": true,
	})
	for _, expected := range []string{
		"受控的 Web UI 迭代",
		"不要重新设计整张页面",
		"未提及的布局",
		"Noto Sans SC",
		"不要生成乱码",
		"只把主按钮改为蓝色",
	} {
		if !strings.Contains(p, expected) {
			t.Fatalf("compiled prompt missing %q: %s", expected, p)
		}
	}
}

func TestEcommerceAplusSpecLocksModuleSize(t *testing.T) {
	p, size := prompt.Compile("ecommerce_design", "生成灯泡 A+ 首屏", map[string]any{
		"outputSize": "970x600",
		"aplusSpec": map[string]any{
			"amazonName": "Standard Header Image",
			"outputSize": "970x600",
		},
	})
	if size != "970x600" {
		t.Fatalf("size = %q, want 970x600", size)
	}
	for _, expected := range []string{"Standard Header Image", "970x600", "A+ Content"} {
		if !strings.Contains(p, expected) {
			t.Fatalf("compiled aplus prompt missing %q: %s", expected, p)
		}
	}
}

func TestEcommerceDesignUsesCommercePromptBoundary(t *testing.T) {
	p, _ := prompt.Compile("ecommerce_design", "生成亚马逊耳机商品套图", map[string]any{})
	for _, expected := range []string{
		"专业电商视觉设计师",
		"保持商品外观",
		"不虚构商品参数",
		"生成亚马逊耳机商品套图",
	} {
		if !strings.Contains(p, expected) {
			t.Fatalf("compiled ecommerce prompt missing %q: %s", expected, p)
		}
	}
	if strings.Contains(p, "UI 设计稿") {
		t.Fatalf("ecommerce prompt must not use the UI design compiler: %s", p)
	}
}

func TestFemalePortraitDirectorSkillAppliedToT2I(t *testing.T) {
	p, size := prompt.Compile("t2i", "窗边的新中式女性人像", map[string]any{
		"size":     "1024x1536",
		"skillIds": []any{"female-portrait-director"},
	})
	if size != "1024x1536" {
		t.Fatalf("size = %q, want exact task size", size)
	}
	for _, expected := range []string{
		"窗边的新中式女性人像",
		"FEMALE-PORTRAIT-DIRECTOR-V1.6",
		"任务参数中的画幅比例",
		"只选择一个最匹配的主风格",
	} {
		if !strings.Contains(p, expected) {
			t.Fatalf("compiled prompt missing %q", expected)
		}
	}
}

func TestFemalePortraitDirectorSkillOnlyAppliesToT2I(t *testing.T) {
	p, _ := prompt.Compile("coloring", "USERPROMPT", map[string]any{
		"skillIds": []string{"female-portrait-director"},
	})
	if strings.Contains(p, "FEMALE-PORTRAIT-DIRECTOR") {
		t.Fatalf("portrait director must not affect coloring tasks: %q", p)
	}
}

func TestTypeTemplatesIncludeUserPrompt(t *testing.T) {
	for _, taskType := range []string{"coloring", "ui_design", "ecommerce_design", "model_sheet", "game_art", "puzzle"} {
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
