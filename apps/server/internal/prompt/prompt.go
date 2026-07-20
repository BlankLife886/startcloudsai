// Package prompt 按任务类型把用户输入编译为最终 prompt。
//
// 每种类型一个中文模板函数；params 中的尺寸/风格等拼入 prompt 或作为
// size 参数返回。模板文案与 Python 版 prompt_compiler.py 逐字一致。
package prompt

import (
	"fmt"
	"strings"
)

func paramString(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	v, ok := params[key]
	if !ok || v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	default:
		return fmt.Sprintf("%v", v)
	}
}

// styleSuffix 与 Python _style_suffix 一致：style / palette / extra。
func styleSuffix(params map[string]any) string {
	var parts []string
	if style := paramString(params, "style"); style != "" {
		parts = append(parts, fmt.Sprintf("整体风格：%s。", style))
	}
	if palette := paramString(params, "palette"); palette != "" {
		parts = append(parts, fmt.Sprintf("配色方案：%s。", palette))
	}
	if extra := paramString(params, "extra"); extra != "" {
		parts = append(parts, extra)
	}
	return strings.Join(parts, " ")
}

func sizeOf(params map[string]any) string {
	return paramString(params, "size")
}

func compileT2I(prompt string, params map[string]any) string {
	suffix := styleSuffix(params)
	if suffix == "" {
		return prompt
	}
	return strings.TrimSpace(prompt + "\n" + suffix)
}

func compileColoring(prompt string, params map[string]any) string {
	parts := []string{
		"请为参考图中的线稿/插画上色，保持原始构图、线条与人物特征不变，",
		"只做上色与光影渲染，不要改变画面内容。",
		fmt.Sprintf("上色要求：%s", prompt),
	}
	if suffix := styleSuffix(params); suffix != "" {
		parts = append(parts, suffix)
	}
	return strings.Join(parts, " ")
}

func compileUIDesign(prompt string, params map[string]any) string {
	platform := paramString(params, "platform")
	if platform == "" {
		platform = "Web"
	}
	parts := []string{
		fmt.Sprintf("请设计一张高保真的 %s UI 设计稿，布局规范、层级清晰、", platform),
		"视觉现代，包含真实可信的界面文案与组件细节。",
		fmt.Sprintf("设计需求：%s", prompt),
	}
	if suffix := styleSuffix(params); suffix != "" {
		parts = append(parts, suffix)
	}
	return strings.Join(parts, " ")
}

func compileModelSheet(prompt string, params map[string]any) string {
	views := paramString(params, "views")
	if views == "" {
		views = "正面、侧面、背面"
	}
	parts := []string{
		"请生成一张超高清角色/物体模型参考图（model sheet），",
		fmt.Sprintf("在同一画面中以 %s 等多个视角展示同一对象，", views),
		"各视角比例一致、细节统一，白底或浅色纯色底，便于三维建模参考。",
		fmt.Sprintf("对象描述：%s", prompt),
	}
	if suffix := styleSuffix(params); suffix != "" {
		parts = append(parts, suffix)
	}
	return strings.Join(parts, " ")
}

func compileGameArt(prompt string, params map[string]any) string {
	assetType := paramString(params, "assetType")
	if assetType == "" {
		assetType = "游戏美术素材"
	}
	parts := []string{
		fmt.Sprintf("请生成可直接用于游戏开发的%s，", assetType),
		"画面完整、主体突出、边缘干净，适合作为游戏资源使用。",
		fmt.Sprintf("素材描述：%s", prompt),
	}
	if suffix := styleSuffix(params); suffix != "" {
		parts = append(parts, suffix)
	}
	return strings.Join(parts, " ")
}

func compilePuzzle(prompt string, params map[string]any) string {
	layout := paramString(params, "layout")
	if layout == "" {
		layout = "自然融合"
	}
	parts := []string{
		"请把提供的多张参考图智能合成为一张完整、和谐的图片，",
		fmt.Sprintf("采用「%s」的方式组合，过渡自然、光影统一、无明显拼接痕迹。", layout),
		fmt.Sprintf("合成要求：%s", prompt),
	}
	if suffix := styleSuffix(params); suffix != "" {
		parts = append(parts, suffix)
	}
	return strings.Join(parts, " ")
}

var compilers = map[string]func(string, map[string]any) string{
	"t2i":         compileT2I,
	"coloring":    compileColoring,
	"ui_design":   compileUIDesign,
	"model_sheet": compileModelSheet,
	"game_art":    compileGameArt,
	"puzzle":      compilePuzzle,
}

// Compile 返回 (final_prompt, size)；size 为空字符串表示未指定。
func Compile(taskType, prompt string, params map[string]any) (string, string) {
	if params == nil {
		params = map[string]any{}
	}
	compiler, ok := compilers[taskType]
	if !ok {
		compiler = compileT2I
	}
	return compiler(prompt, params), sizeOf(params)
}
