// Package trialfeature defines the product features that can be used by a
// trial campaign. This catalog is the server-side authority for admin
// configuration, task authorization, credit allocation, and user routing.
package trialfeature

type Feature struct {
	Key        string   `json:"key"`
	Label      string   `json:"label"`
	Route      string   `json:"route"`
	TaskTypes  []string `json:"taskTypes"`
	RuntimeKey string   `json:"runtimeKey"`
	Icon       string   `json:"icon"`
}

var catalog = []Feature{
	{
		Key: "text_to_image", Label: "文生图", Route: "/text-to-image",
		TaskTypes: []string{"t2i"}, RuntimeKey: "ai.wallpaperGeneration", Icon: "bi-stars",
	},
	{
		Key: "illustration_coloring", Label: "插画染色", Route: "/ai-illustration-coloring",
		TaskTypes: []string{"coloring"}, RuntimeKey: "ai.illustrationColoring", Icon: "bi-brush-fill",
	},
	{
		Key: "ui_design", Label: "UI 设计稿", Route: "/design-workshop",
		TaskTypes: []string{"ui_design"}, RuntimeKey: "ai.uiDesign", Icon: "bi-bezier2",
	},
	{
		Key: "ecommerce_design", Label: "AI 电商设计", Route: "/ecommerce-design",
		TaskTypes: []string{"ecommerce_design"}, RuntimeKey: "ai.ecommerceDesign", Icon: "bi-bag-check-fill",
	},
	{
		Key: "model_sheet", Label: "超高清模型图", Route: "/model-sheet",
		TaskTypes: []string{"model_sheet"}, RuntimeKey: "ai.ultraModelSheet", Icon: "bi-person-bounding-box",
	},
	{
		Key: "game_art", Label: "游戏设计", Route: "/game-art",
		TaskTypes: []string{"game_art"}, RuntimeKey: "ai.gameDesign", Icon: "bi-controller",
	},
	{
		Key: "background_remove", Label: "背景移除", Route: "/tools/background-remove",
		TaskTypes: []string{"background_remove"}, RuntimeKey: "ai.imageTools", Icon: "bi-person-bounding-box",
	},
}

func List() []Feature {
	result := make([]Feature, len(catalog))
	copy(result, catalog)
	return result
}

func Get(key string) (Feature, bool) {
	for _, feature := range catalog {
		if feature.Key == key {
			return feature, true
		}
	}
	return Feature{}, false
}

func ForTaskType(taskType string) (Feature, bool) {
	for _, feature := range catalog {
		for _, candidate := range feature.TaskTypes {
			if candidate == taskType {
				return feature, true
			}
		}
	}
	return Feature{}, false
}
