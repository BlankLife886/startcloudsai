package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	ToolMemorySearch = "memory_search"
	ToolMemorySave   = "memory_save"
	ToolMemoryUpdate = "memory_update"
	ToolMemoryForget = "memory_forget"

	PermissionMemory Permission = "memory"

	DomainMemory = "memory"
)

// MemoryContext is what memory writes need from the turn: where a memory
// came from, and the images the user attached (a product's photos).
type MemoryContext struct {
	ConversationID *uuid.UUID
	InputKeys      []string
}

func memoryToolError(err error) (Result, error) {
	switch {
	case errors.Is(err, assistantmemory.ErrInvalid):
		content, _ := json.Marshal(map[string]any{"error": err.Error()})
		return Result{Content: string(content), Meta: map[string]any{"invalid": true}}, nil
	case errors.Is(err, assistantmemory.ErrNotFound):
		return Result{Content: `{"error":"没有找到这条记忆，先用 memory_search 查到它的 id"}`, Meta: map[string]any{"invalid": true}}, nil
	}
	return Result{}, err
}

// memoryChangeResult tells the model what changed and gives the card the
// change to show with its undo.
func memoryChangeResult(change *assistantmemory.Change) (Result, error) {
	content, err := json.Marshal(map[string]any{"change": change, "note": "已保存。回复里用一句话告诉用户记住或改了什么；卡片上可以撤销。"})
	if err != nil {
		return Result{}, err
	}
	return Result{Content: string(content), Meta: map[string]any{"view": "memory_change", "data": change}}, nil
}

func memoryID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, assistantmemory.ErrNotFound
	}
	return id, nil
}

func memoryKinds() []any {
	out := make([]any, 0, len(assistantmemory.Kinds))
	for _, kind := range assistantmemory.Kinds {
		out = append(out, kind)
	}
	return out
}

// NewMemoryManifest lets the assistant read and keep its memory of the user.
// It is only registered when the user has memory on.
func NewMemoryManifest(st *store.Store, turn MemoryContext) Manifest {
	kindHelp := "kind：brand 品牌资料（品牌名、品牌色、字体、调性、logo）、product 商品（名称、卖点、规格、商品图）、style 风格偏好（喜欢或不要的画面风格）、habit 习惯（常用平台、比例、语言、默认要求）、favorite 满意方案（用户满意的一套图或做法）。"
	return Manifest{
		ID:          DomainMemory,
		Version:     "1",
		Description: "查看与维护助手对用户的长期记忆",
		Tools: []Definition{
			{
				Name:        ToolMemorySearch,
				Description: "查找你记住的关于用户的信息（品牌、商品、偏好、满意方案），返回完整内容和图片。query 写 1-3 个关键词，不写则按类型列出。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{"type": "string", "maxLength": 60},
						"kind":  map[string]any{"type": "string", "enum": memoryKinds()},
					},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionMemory},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 48 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						Query string `json:"query"`
						Kind  string `json:"kind"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("查找参数格式不正确")
					}
					found, err := assistantmemory.Search(ctx, st.Pool, invocation.UserID, input.Query, input.Kind)
					if err != nil {
						return memoryToolError(err)
					}
					return jsonResult(map[string]any{"memories": found, "total": len(found)})
				},
			},
			{
				Name: ToolMemorySave,
				Description: "把用户希望你长期记住的信息存下来。只在用户明确要求记住（“记住…”“以后都…”“我的品牌是…”），或说出明显长期有效的偏好时调用；一次性的要求不要存。" + kindHelp +
					"title 是简短名称（如“品牌色”“保温杯 Pro”），同类型同名会覆盖旧内容。attachImages=true 时把用户本轮上传的图存进这条记忆（记住商品时用）。" +
					"commerceSetId 填本对话的电商套图 id 时，会把那套图的方案和成图存为满意方案。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"kind":          map[string]any{"type": "string", "enum": memoryKinds()},
						"title":         map[string]any{"type": "string", "minLength": 1, "maxLength": assistantmemory.MaxTitle},
						"content":       map[string]any{"type": "string", "maxLength": assistantmemory.MaxContent},
						"attachImages":  map[string]any{"type": "boolean"},
						"commerceSetId": map[string]any{"type": "string"},
					},
					"required":             []any{"kind", "title"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionMemory},
				Risk:           RiskWrite,
				Level:          LevelMemory,
				Timeout:        10 * time.Second,
				MaxResultBytes: 16 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						assistantmemory.Input
						AttachImages  bool   `json:"attachImages"`
						CommerceSetID string `json:"commerceSetId"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("记忆参数格式不正确")
					}
					in := input.Input
					origin := assistantmemory.Origin{Source: assistantmemory.SourceAssistant, ConversationID: turn.ConversationID}
					if input.CommerceSetID != "" {
						setID, err := uuid.Parse(input.CommerceSetID)
						if err != nil {
							return memoryToolError(assistantmemory.ErrNotFound)
						}
						favorite, err := assistantmemory.FavoriteFromSet(ctx, st.Pool, invocation.UserID, setID)
						if err != nil {
							return memoryToolError(err)
						}
						// The model's title and notes win; the set supplies the
						// images and, when the model wrote nothing, the details.
						in.ImageKeys = favorite.ImageKeys
						if in.Content == "" {
							in.Content = favorite.Content
						}
						origin.CommerceSetID = &setID
					}
					if input.AttachImages {
						in.ImageKeys = append(in.ImageKeys, turn.InputKeys...)
					}
					change, err := assistantmemory.Remember(ctx, st, invocation.UserID, in, origin)
					if err != nil {
						return memoryToolError(err)
					}
					return memoryChangeResult(change)
				},
			},
			{
				Name:        ToolMemoryUpdate,
				Description: "修改一条已有记忆（用户说“改一下”“不对，应该是…”时）。id 取自记忆列表或 memory_search；只传要改的字段，content 会整体替换。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":      map[string]any{"type": "string"},
						"kind":    map[string]any{"type": "string", "enum": memoryKinds()},
						"title":   map[string]any{"type": "string", "minLength": 1, "maxLength": assistantmemory.MaxTitle},
						"content": map[string]any{"type": "string", "maxLength": assistantmemory.MaxContent},
					},
					"required":             []any{"id"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionMemory},
				Risk:           RiskWrite,
				Level:          LevelMemory,
				Timeout:        10 * time.Second,
				MaxResultBytes: 16 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						ID string `json:"id"`
						assistantmemory.Patch
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("记忆参数格式不正确")
					}
					id, err := memoryID(input.ID)
					if err != nil {
						return memoryToolError(err)
					}
					input.Patch.ImageKeys = nil
					change, err := assistantmemory.Update(ctx, st, invocation.UserID, id, input.Patch)
					if err != nil {
						return memoryToolError(err)
					}
					return memoryChangeResult(change)
				},
			},
			{
				Name:        ToolMemoryForget,
				Description: "删除一条记忆（用户说“忘掉…”“别再用…”时）。id 取自记忆列表或 memory_search。删除后卡片上可以撤销。",
				InputSchema: map[string]any{
					"type":                 "object",
					"properties":           map[string]any{"id": map[string]any{"type": "string"}},
					"required":             []any{"id"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionMemory},
				Risk:           RiskWrite,
				Level:          LevelMemory,
				Timeout:        10 * time.Second,
				MaxResultBytes: 16 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						ID string `json:"id"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("记忆参数格式不正确")
					}
					id, err := memoryID(input.ID)
					if err != nil {
						return memoryToolError(err)
					}
					change, err := assistantmemory.Forget(ctx, st.Pool, invocation.UserID, id)
					if err != nil {
						return memoryToolError(err)
					}
					return memoryChangeResult(change)
				},
			},
		},
	}
}
