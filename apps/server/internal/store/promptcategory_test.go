package store

import "testing"

func TestClassifyPromptCategory(t *testing.T) {
	tests := []struct {
		name   string
		title  string
		prompt string
		tags   []string
		want   string
	}{
		{"explicit tag", "任意标题", "", []string{"产品展示图", "product"}, "product"},
		{"tag beats title", "电商 App 首页", "", []string{"UI / UX 与社交媒体"}, "design"},
		{"chinese title", "游戏素材 - 赛博朋克角色", "", nil, "game"},
		{"portrait", "电影感暗调摄影棚静默肖像", "", nil, "portrait"},
		{"prompt fallback", "无分类标题", "A photorealistic street photography shot", nil, "photography"},
		{"unknown", "抽象创意", "vivid colors", nil, "other"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyPromptCategory(tt.title, tt.prompt, tt.tags); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}
