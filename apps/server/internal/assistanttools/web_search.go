package assistanttools

import "strings"

// WebSearchRequested identifies an explicit request to use the public web.
// It intentionally excludes generic phrases such as "查一下" so local image,
// asset, and document searches are not routed outside the platform.
func WebSearchRequested(prompt string) bool {
	text := strings.ToLower(strings.TrimSpace(prompt))
	for _, term := range []string{
		"联网", "上网", "网上搜索", "搜索网页", "搜索网络", "联网搜索", "联网查找", "联网查证",
		"web search", "search the web", "browse the web", "look up online",
	} {
		if strings.Contains(text, term) {
			return true
		}
	}
	return false
}
