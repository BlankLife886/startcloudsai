package store

import "strings"

func paramText(params map[string]any, keys ...string) string {
	if params == nil {
		return ""
	}
	for _, key := range keys {
		value, ok := params[key].(string)
		if !ok {
			continue
		}
		if text := strings.TrimSpace(value); text != "" {
			return text
		}
	}
	return ""
}

func IsCanvasOrigin(params map[string]any) bool {
	source := paramText(params, "_source", "source")
	kind := paramText(params, "_kind", "kind")
	workspace := paramText(params, "workspace")
	return strings.EqualFold(source, CanvasTaskSource) ||
		strings.EqualFold(source, PromptTaskTypeCanvas) ||
		strings.EqualFold(workspace, PromptTaskTypeCanvas) ||
		strings.HasPrefix(strings.ToLower(kind), "canvas-")
}

func IsAssistantOrigin(params map[string]any) bool {
	return strings.EqualFold(paramText(params, "_source", "source", "workspace"), PromptTaskTypeAssistant)
}

func AssistantProductName(params map[string]any) string {
	if IsCanvasOrigin(params) {
		return "无限画布"
	}
	return "AI 助手"
}
