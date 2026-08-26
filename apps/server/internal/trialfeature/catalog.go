// Package trialfeature defines the product features that can be used by a
// trial campaign. This catalog is the server-side authority for admin
// configuration, task authorization, credit allocation, and user routing.
package trialfeature

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	AIAssistantKey    = "ai_assistant"
	InfiniteCanvasKey = "infinite_canvas"
)

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
		Key: AIAssistantKey, Label: "AI 助手", Route: "/assistant",
		TaskTypes: []string{}, RuntimeKey: "ai.assistant", Icon: "bi-robot",
	},
	{
		Key: InfiniteCanvasKey, Label: "无限画布", Route: "/canvas",
		TaskTypes: []string{}, RuntimeKey: "ai.infiniteCanvas", Icon: "bi-bounding-box-circles",
	},
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

// ForTask resolves task types that are shared by multiple product surfaces.
func ForTask(taskType string, params map[string]any) (Feature, bool) {
	if source, _ := params["_source"].(string); strings.EqualFold(strings.TrimSpace(source), store.CanvasTaskSource) {
		return Get(InfiniteCanvasKey)
	}
	return ForTaskType(taskType)
}

// ForAssistantParams maps assistant workspaces to their trial feature.
func ForAssistantParams(params map[string]any) (Feature, bool) {
	if workspace, _ := params["workspace"].(string); strings.EqualFold(strings.TrimSpace(workspace), "infinite_canvas") {
		return Get(InfiniteCanvasKey)
	}
	return Get(AIAssistantKey)
}

// Authorize enforces restricted campaigns only when the active campaign
// explicitly includes the requested feature.
func Authorize(ctx context.Context, q store.Q, userID uuid.UUID, feature Feature) error {
	if feature.Key == "" {
		return nil
	}
	campaign, err := store.GetActiveTrialCampaign(ctx, q)
	if err != nil {
		return err
	}
	if campaign == nil || campaign.AccessMode != "restricted" || !store.Contains(campaign.FeatureKeys, feature.Key) {
		return nil
	}
	allowed, err := store.HasActiveTrialFeatureEntitlement(ctx, q, userID, feature.Key)
	if err != nil {
		return err
	}
	if !allowed {
		return apperr.E("trial_feature_access_required", fmt.Sprintf("「%s」正在内测，请先申请并通过体验资格审核", feature.Label), 403)
	}
	return nil
}
