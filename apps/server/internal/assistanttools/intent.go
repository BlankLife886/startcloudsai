package assistanttools

import (
	"regexp"
	"strings"
)

var (
	negatedImageRequestPattern = regexp.MustCompile(`(?i)(不要|别|无需|不需要|不用|禁止|勿)\s*(再\s*)?(生成|画|绘制|制作|创建|设计|修改|编辑|重绘|去背景|抠图|擦除|移除|替换|添加)([^，。；;,.!?]{0,20})?(图片|图像|照片|人像|海报|插画|头像|壁纸|封面|logo|标志|图标|视觉稿|效果图|这张图|上一张图)`)
	technicalImagePattern      = regexp.MustCompile(`(?i)(图片|图像).{0,10}(数据库|数据表|表结构|字段|接口|api|代码|算法|存储|格式|协议)|(数据库|数据表|表结构|字段|接口|api|代码|算法|存储|格式|协议).{0,10}(图片|图像)`)
	visualReferencePattern     = regexp.MustCompile(`(?i)(这张|那张|上一张|刚才的|之前的|第[一二三四五六七八九1-9]张|图\s*[1-9])\s*(图|图片|照片|画面)?`)
	imageKnowledgePattern      = regexp.MustCompile(`(?i)^(什么是|为什么|为何|如何|怎么|怎样|你会|你能|你可以|你支持|请?解释|请?介绍|请?说明|how (do|to)|what is|can you|explain).{0,80}(生成|创建|绘制|制作|设计|编辑|修改|图片|图像|海报|插画|logo|generate|create|draw|design|edit|image|picture|poster)`)
	personalImageCommand       = regexp.MustCompile(`(?i)(帮我|给我|替我|为我|please)\s*(直接)?\s*(生成|创建|绘制|画|制作|设计|重绘|修改|编辑|generate|create|draw|design|edit)`)
)

func containsIntentTerm(text string, values ...string) bool {
	for _, value := range values {
		if strings.Contains(text, value) {
			return true
		}
	}
	return false
}

// ImageActionRequested identifies an explicit request to create or modify a
// visual deliverable. It is intentionally conservative because this result is
// allowed to upgrade the lightweight chat path into the tool-capable agent.
func ImageActionRequested(prompt string) bool {
	text := strings.ToLower(strings.TrimSpace(prompt))
	if text == "" {
		return false
	}
	positive := negatedImageRequestPattern.ReplaceAllString(text, "")
	if technicalImagePattern.MatchString(positive) && !containsIntentTerm(positive,
		"海报", "插画", "头像", "壁纸", "封面", "logo", "标志", "图标", "视觉稿", "效果图", "照片", "人像") {
		return false
	}
	if imageKnowledgePattern.MatchString(positive) && !personalImageCommand.MatchString(positive) &&
		!containsIntentTerm(positive, "然后", "并生成", "再生成", "接着生成", "then", "and generate", "after that") {
		return false
	}
	createAction := containsIntentTerm(positive,
		"生成", "画一", "画两", "画个", "画张", "绘制", "制作", "创建", "设计", "generate", "draw", "create", "make an image")
	visualNoun := containsIntentTerm(positive,
		"图片", "图像", "照片", "人像", "海报", "插画", "头像", "壁纸", "封面", "logo", "标志", "图标", "视觉稿", "效果图",
		"image", "picture", "photo", "portrait", "poster", "illustration", "wallpaper", "cover")
	if createAction && visualNoun {
		return true
	}
	editAction := containsIntentTerm(positive,
		"修改", "编辑", "重绘", "换成", "改成", "去背景", "抠图", "擦除", "移除", "替换", "扩图", "上色",
		"edit", "redraw", "remove background", "replace")
	return editAction && (visualNoun || visualReferencePattern.MatchString(positive))
}

func explanatoryToolQuestion(text string) bool {
	return containsIntentTerm(text,
		"是什么", "什么意思", "原理", "怎么实现", "如何实现", "如何开发", "代码", "接口设计", "教程", "解释一下", "介绍一下",
		"how to implement", "how does", "explain", "tutorial")
}

// WorkspaceToolForPrompt returns a tool only for a direct user command. A
// question about how a feature works must remain a normal conversation.
func WorkspaceToolForPrompt(prompt string) string {
	text := strings.ToLower(strings.TrimSpace(prompt))
	if text == "" || explanatoryToolQuestion(text) {
		return ""
	}
	switch {
	case containsIntentTerm(text, "网页截图", "网站截图", "截取网页", "capture webpage", "website screenshot"):
		return ToolWebpageCapture
	case containsIntentTerm(text, "搜索图片", "找参考图", "找些参考图", "找一些参考图", "图片素材", "image search") ||
		(strings.Contains(text, "参考图") && containsIntentTerm(text, "找", "搜索", "寻找", "缺少")):
		return ToolImageSearch
	case containsIntentTerm(text, "导入商品链接", "导入商品页", "商品链接导入", "product import"):
		return ToolProductImport
	case containsIntentTerm(text, "导出交付包", "打包交付", "打包所有图片", "delivery export"):
		return ToolDeliveryExport
	case containsIntentTerm(text, "参考图复刻", "复刻参考图", "照这个图做工作流", "reference rebuild"):
		return ToolReferenceRebuild
	case containsIntentTerm(text, "发送到无限画布", "发到无限画布", "发送到ai电商", "发送到 ai 电商", "send to workspace"):
		return ToolSendToWorkspace
	case containsIntentTerm(text, "抠图", "移除背景", "压缩图片", "高清放大", "图片裁剪", "切图"):
		return ToolMediaAction
	default:
		return ""
	}
}

// AgentExecutionRequested is the shared server-side routing contract. Clients
// may predict this for responsive UI, but the server remains authoritative.
func AgentExecutionRequested(prompt string) bool {
	return WebSearchRequested(prompt) || TaskStatusRequested(prompt) ||
		ImageActionRequested(prompt) || WorkspaceToolForPrompt(prompt) != ""
}
