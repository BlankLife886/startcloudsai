package store

import "strings"

var promptCategoryKeywords = []struct {
	category string
	keywords []string
}{
	{"typography", []string{"typography", "text_render", "font", "lettering", "字体", "排版", "文字渲染", "艺术字", "书法"}},
	{"game", []string{"game_ui", "game", "gaming", "游戏素材", "游戏美术", "游戏截图", "像素游戏", "关卡"}},
	{"product", []string{"product", "ecommerce", "commercial", "产品展示", "产品摄影", "电商", "商品", "包装设计", "商业广告"}},
	{"design", []string{"social_poster", "infographic", "poster", "logo", "ui/ux", "ui与界面", "界面设计", "信息图", "海报设计", "视觉设计", "社交媒体"}},
	{"illustration", []string{"illustration", "anime", "manga", "cartoon", "插画", "动漫", "漫画", "故事板", "绘本", "油画", "水彩"}},
	{"scene", []string{"landscape", "cityscape", "architecture", "interior", "scene", "风景", "场景", "建筑", "室内", "城市景观"}},
	{"portrait", []string{"portrait", "headshot", "profile photo", "人像", "肖像", "头像", "人物写真", "角色设定", "角色设计"}},
	{"photography", []string{"photography", "photorealistic", "photo-realistic", "摄影", "照片级", "纪实", "街拍", "抓拍", "静物"}},
}

// ClassifyPromptCategory 将同步源的自由标签归一到产品内置分类。
// 标签和标题权重高于长提示词，避免提示词中的偶然用词导致误分类。
func ClassifyPromptCategory(title, prompt string, tags []string) string {
	for _, text := range []string{strings.Join(tags, " "), title, prompt} {
		normalized := strings.ToLower(text)
		for _, group := range promptCategoryKeywords {
			if containsPromptKeyword(normalized, group.keywords) {
				return group.category
			}
		}
	}
	return "other"
}

func containsPromptKeyword(text string, keywords []string) bool {
	for _, keyword := range keywords {
		if strings.Contains(text, keyword) {
			return true
		}
	}
	return false
}
