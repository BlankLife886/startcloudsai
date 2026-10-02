package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	ToolCommerceSetPlan     = "commerce_set_plan"
	ToolCommerceSetGenerate = "commerce_set_generate"
	ToolCommerceSetRedo     = "commerce_set_redo"
	ToolCommerceSetStatus   = "commerce_set_status"
	ToolImageToolPlan       = "image_tool_plan"

	PermissionCommerceSets Permission = "commerce.sets"

	// DomainCommerceSet is the manifest id.
	DomainCommerceSet = "commerce_set"
)

// CommerceSetContext is what one assistant turn hands the commerce tools:
// the product images the user attached and a vision model for copy.
type CommerceSetContext struct {
	ConversationID *uuid.UUID
	RunID          *uuid.UUID
	InputKeys      []string
	Copy           commerceset.CopyWriter
}

func commerceTypeCatalogText() string {
	var builder strings.Builder
	builder.WriteString("出图类型（id=名称，主图/详情页：用途）：")
	for index, item := range commerceset.Types() {
		if index > 0 {
			builder.WriteString("；")
		}
		role := "详情页"
		if item.Role == "main" {
			role = "主图"
		}
		builder.WriteString(item.ID + "=" + item.Label + "，" + role + "：" + item.Hint)
	}
	return builder.String()
}

func typeIDs() []any {
	out := []any{}
	for _, item := range commerceset.Types() {
		out = append(out, item.ID)
	}
	return out
}

func ratioEnum() []any {
	out := []any{}
	for _, ratio := range commerceset.Ratios() {
		out = append(out, ratio)
	}
	return out
}

func setIDSchema() map[string]any {
	return map[string]any{"type": "string", "description": "commerce_set_plan 返回的套图 id"}
}

func parseSetID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return uuid.Nil, errors.New("套图 id 无效")
	}
	return id, nil
}

// commerceObservation reports a set to the model and the card at once.
func commerceObservation(view *commerceset.View, extra map[string]any) (Result, error) {
	payload := map[string]any{"set": view}
	for key, value := range extra {
		payload[key] = value
	}
	content, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}
	return Result{Content: string(content), Meta: map[string]any{"view": "commerce_set", "data": view}}, nil
}

func commerceToolError(err error) (Result, error) {
	switch {
	case errors.Is(err, commerceset.ErrInvalid), errors.Is(err, commerceset.ErrPriceChanged):
		content, _ := json.Marshal(map[string]any{"error": err.Error()})
		return Result{Content: string(content), Meta: map[string]any{"invalid": true}}, nil
	}
	return Result{}, err
}

// NewCommerceSetManifest exposes e-commerce image sets. Planning is free for
// the user (the turn already pays for the model); generating spends points
// and is LevelSpend: it runs only within the user's auto-approval budget,
// which commerceset enforces inside the transaction that creates the tasks.
// Otherwise the user approves on the card.
func NewCommerceSetManifest(service commerceset.Service, turn CommerceSetContext) Manifest {
	view := func(ctx context.Context, userID, setID uuid.UUID) (*commerceset.View, error) {
		result, err := service.ViewByID(ctx, userID, setID)
		if err == nil && result == nil {
			err = commerceset.ErrInvalid
		}
		return result, err
	}
	spend := func(ctx context.Context, invocation Invocation, setID uuid.UUID, input commerceset.GenerateInput) (Result, error) {
		input.Via = store.CommerceApprovedByBudget
		_, err := service.Generate(ctx, invocation.UserID, setID, input)
		if errors.Is(err, commerceset.ErrNeedsConfirmation) {
			current, viewErr := view(ctx, invocation.UserID, setID)
			if viewErr != nil {
				return Result{}, viewErr
			}
			return commerceObservation(current, map[string]any{
				"needsConfirmation": true,
				"message":           strings.TrimPrefix(err.Error(), commerceset.ErrNeedsConfirmation.Error()+": "),
			})
		}
		if err != nil {
			return commerceToolError(err)
		}
		current, err := view(ctx, invocation.UserID, setID)
		if err != nil {
			return Result{}, err
		}
		return commerceObservation(current, map[string]any{"started": true})
	}
	return Manifest{
		ID:          DomainCommerceSet,
		Version:     "1",
		Description: "策划并生成电商商品套图（主图 + 详情页），以及对用户图片运行图片工具（背景移除）",
		Tools: []Definition{
			{
				Name: ToolImageToolPlan,
				Description: "对用户本轮上传的图片运行图片工具，目前支持 background_remove（移除背景，得到透明底 PNG）。每张图一个任务，只出方案和报价，不花积分；" +
					"之后按 commerce_set_generate 的规则执行（同样返回 setId，生成、重做、查进度都用 commerce_set_* 工具）。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"tool": map[string]any{"type": "string", "enum": []any{commerceset.ToolBackgroundRemove}},
					},
					"required":             []any{"tool"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionCommerceSets},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        30 * time.Second,
				MaxResultBytes: 32 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						Tool string `json:"tool"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("参数格式不正确")
					}
					set, err := service.PlanTool(ctx, commerceset.ToolPlanInput{UserID: invocation.UserID,
						ConversationID: turn.ConversationID, RunID: turn.RunID, Tool: input.Tool, InputKeys: turn.InputKeys})
					if err != nil {
						return commerceToolError(err)
					}
					current, err := service.BuildView(ctx, set)
					if err != nil {
						return Result{}, err
					}
					return commerceObservation(current, nil)
				},
			},
			{
				Name: ToolCommerceSetPlan,
				Description: "根据用户上传的商品图策划一套电商图：选出图类型和张数、策划每张的标题文案与构图，并报价（预计积分）。只出方案，不花积分。" +
					"不确定时 shots 留空，使用默认组合（白底图、场景主图、首屏、卖点、场景、工艺、参数）。一套最多 18 张，同一类型最多 4 张。" + commerceTypeCatalogText(),
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"productName":   map[string]any{"type": "string", "maxLength": 60},
						"sellingPoints": map[string]any{"type": "string", "maxLength": 1000, "description": "用户提供的卖点、参数、人群；没有就留空，不要编造"},
						"platform":      map[string]any{"type": "string", "maxLength": 40, "description": "如 " + strings.Join(commerceset.Platforms(), "、")},
						"market":        map[string]any{"type": "string", "maxLength": 40, "description": "如 " + strings.Join(commerceset.Markets(), "、")},
						"language":      map[string]any{"type": "string", "maxLength": 40, "description": "画面文案语言，如 " + strings.Join(commerceset.Languages(), "、")},
						"style":         map[string]any{"type": "string", "maxLength": 40, "description": "如 " + strings.Join(commerceset.StyleLabels(), "、")},
						"note":          map[string]any{"type": "string", "maxLength": 2000},
						"shots": map[string]any{
							"type": "array", "maxItems": 18,
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"type":  map[string]any{"type": "string", "enum": typeIDs()},
									"count": map[string]any{"type": "integer", "minimum": 1, "maximum": 4},
								},
								"required":             []any{"type"},
								"additionalProperties": false,
							},
						},
						"mainRatio":   map[string]any{"type": "string", "enum": ratioEnum(), "description": "主图画幅，默认 1:1"},
						"detailRatio": map[string]any{"type": "string", "enum": ratioEnum(), "description": "详情页画幅，默认 3:4"},
					},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionCommerceSets},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        120 * time.Second,
				MaxResultBytes: 64 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var brief commerceset.Brief
					if err := json.Unmarshal(invocation.Arguments, &brief); err != nil {
						return Result{}, errors.New("套图参数格式不正确")
					}
					set, err := service.Plan(ctx, commerceset.PlanInput{
						UserID: invocation.UserID, ConversationID: turn.ConversationID, RunID: turn.RunID,
						InputKeys: turn.InputKeys, Brief: brief, Copy: turn.Copy,
					})
					if err != nil {
						return commerceToolError(err)
					}
					current, err := service.BuildView(ctx, set)
					if err != nil {
						return Result{}, err
					}
					return commerceObservation(current, nil)
				},
			},
			{
				Name: ToolCommerceSetGenerate,
				Description: "按方案生成整套图或执行图片工具（花积分）。只有当方案的 autoApprovable 为 true（用户开启了自动授权且在预算内）时才调用；否则不要调用，请用户在方案卡片上确认。" +
					"返回 needsConfirmation 时说明预算不够或未授权，转告用户在卡片上确认。",
				InputSchema: map[string]any{
					"type":                 "object",
					"properties":           map[string]any{"setId": setIDSchema()},
					"required":             []any{"setId"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionCommerceSets},
				Risk:           RiskWrite,
				Level:          LevelSpend,
				Timeout:        60 * time.Second,
				MaxResultBytes: 64 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						SetID string `json:"setId"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("参数格式不正确")
					}
					setID, err := parseSetID(input.SetID)
					if err != nil {
						return commerceToolError(commerceset.ErrInvalid)
					}
					return spend(ctx, invocation, setID, commerceset.GenerateInput{})
				},
			},
			{
				Name:        ToolCommerceSetRedo,
				Description: "按用户要求重做套图里的某几张（花积分，规则同 commerce_set_generate：只在自动授权预算内执行，否则请用户在卡片上点“重做”）。note 写用户的修改要求。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"setId":   setIDSchema(),
						"shotIds": map[string]any{"type": "array", "minItems": 1, "maxItems": 18, "items": map[string]any{"type": "string"}},
						"note":    map[string]any{"type": "string", "maxLength": 200},
					},
					"required":             []any{"setId", "shotIds"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionCommerceSets},
				Risk:           RiskWrite,
				Level:          LevelSpend,
				Timeout:        60 * time.Second,
				MaxResultBytes: 64 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						SetID   string   `json:"setId"`
						ShotIDs []string `json:"shotIds"`
						Note    string   `json:"note"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("参数格式不正确")
					}
					setID, err := parseSetID(input.SetID)
					if err != nil {
						return commerceToolError(commerceset.ErrInvalid)
					}
					return spend(ctx, invocation, setID, commerceset.GenerateInput{ShotIDs: input.ShotIDs, Note: commerceset.RedoNote(nil, input.Note)})
				},
			},
			{
				Name:        ToolCommerceSetStatus,
				Description: "查看一套电商图的进度：每张的状态、检查结果、已花积分。",
				InputSchema: map[string]any{
					"type":                 "object",
					"properties":           map[string]any{"setId": setIDSchema()},
					"required":             []any{"setId"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionCommerceSets},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        10 * time.Second,
				MaxResultBytes: 64 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var input struct {
						SetID string `json:"setId"`
					}
					if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
						return Result{}, errors.New("参数格式不正确")
					}
					setID, err := parseSetID(input.SetID)
					if err != nil {
						return commerceToolError(commerceset.ErrInvalid)
					}
					current, err := view(ctx, invocation.UserID, setID)
					if err != nil {
						return commerceToolError(err)
					}
					return commerceObservation(current, nil)
				},
			},
		},
	}
}
