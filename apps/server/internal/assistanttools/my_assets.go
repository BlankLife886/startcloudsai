package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/useraccount"
	"github.com/BlankLife886/startcloudsai/server/internal/userassets"
)

const (
	ToolAssetsSearch   = "assets_search"
	ToolAssetsOrganize = "assets_organize"

	PermissionAssetsRead Permission = "assets.read"

	DomainMyAssets = "my_assets"
)

func assetsToolError(err error) (Result, error) {
	if errors.Is(err, userassets.ErrInvalid) {
		content, _ := json.Marshal(map[string]any{"error": err.Error()})
		return Result{Content: string(content), Meta: map[string]any{"invalid": true}}, nil
	}
	return Result{}, err
}

// NewMyAssetsManifest finds the user's images and proposes library changes.
// Both tools only read: assets_organize returns a proposal the user confirms
// on the card, which then calls userassets.Execute and offers an undo.
func NewMyAssetsManifest(st *store.Store) Manifest {
	return Manifest{
		ID:          DomainMyAssets,
		Version:     "1",
		Description: "查找用户自己的图片（资产库与生成记录）并提出资产库整理方案",
		Tools: []Definition{
			{
				Name: ToolAssetsSearch,
				Description: "按描述查找用户自己的图片：资产库素材（按标题、标签、分组名）和生成记录（按提示词）。query 写 1-3 个关键词，用空格分开（例如“猫 海报”），不写则列出最近的图。" +
					"结果带缩略图、原提示词（可以复用）和所在分组。资产库素材的 id 以 asset: 开头，可用于 assets_organize。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query":  map[string]any{"type": "string", "maxLength": 80},
						"source": map[string]any{"type": "string", "enum": []any{userassets.SourceAll, userassets.SourceLibrary, userassets.SourceHistory}},
						"limit":  map[string]any{"type": "integer", "minimum": 1, "maximum": 24},
					},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionAssetsRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 48 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var request userassets.SearchRequest
					if err := json.Unmarshal(invocation.Arguments, &request); err != nil {
						return Result{}, errors.New("查找参数格式不正确")
					}
					result, err := userassets.Search(ctx, st.Pool, invocation.UserID, request, useraccount.Location(invocation.Timezone))
					if err != nil {
						return assetsToolError(err)
					}
					return jsonResultWithMeta(result, "assets")
				},
			},
			{
				Name: ToolAssetsOrganize,
				Description: "提出资产库整理方案：move（移到分组，group 为空表示移出分组，分组不存在会新建）、tag（添加标签）、trash（移到回收站）。" +
					"只生成方案卡片，不会直接修改；用户在卡片上确认后才执行，执行后可撤销。assetIds 只能用 assets_search 返回的 asset: 开头的 id。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"action":   map[string]any{"type": "string", "enum": []any{userassets.ActionMove, userassets.ActionTag, userassets.ActionTrash}},
						"assetIds": map[string]any{"type": "array", "minItems": 1, "maxItems": 50, "items": map[string]any{"type": "string"}},
						"group":    map[string]any{"type": "string", "maxLength": 64},
						"tags":     map[string]any{"type": "array", "maxItems": 10, "items": map[string]any{"type": "string", "maxLength": 32}},
					},
					"required":             []any{"action", "assetIds"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionAssetsRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 16 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var action userassets.Action
					if err := json.Unmarshal(invocation.Arguments, &action); err != nil {
						return Result{}, errors.New("整理参数格式不正确")
					}
					proposal, err := userassets.Propose(ctx, st.Pool, invocation.UserID, action)
					if err != nil {
						return assetsToolError(err)
					}
					content, err := json.Marshal(map[string]any{"proposal": proposal, "needsConfirmation": true})
					if err != nil {
						return Result{}, err
					}
					return Result{Content: string(content), Meta: map[string]any{"view": "asset_action", "data": proposal}}, nil
				},
			},
		},
	}
}
