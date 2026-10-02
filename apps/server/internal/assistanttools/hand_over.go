package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

const (
	ToolHandOver = "hand_over"

	DomainRouting = "routing"

	// HandOverMeta is the result meta key carrying the target intent.
	HandOverMeta = "handOver"
)

// Targets the original engine handles.
const (
	HandOverCreate    = "create"
	HandOverWeb       = "web"
	HandOverWorkspace = "workspace"
)

// NewHandOverManifest lets the v2 model correct the router: when the turn
// actually asks to draw or change an image, search the web or run a site
// tool, it hands the turn to the original engine, which owns those
// capabilities. The worker acts on the result's meta; the tool itself only
// validates the target.
func NewHandOverManifest() Manifest {
	return Manifest{
		ID:          DomainRouting,
		Version:     "1",
		Description: "把这一轮交给负责出图、联网和站内工具的流程",
		Tools: []Definition{{
			Name: ToolHandOver,
			Description: "这一轮其实需要你没有的能力时调用，调用后本轮由对应流程接手，你不用再回答：" +
				"create（生成、修改、重画图片或设计，包括“改成粉色”“4K 高清”“再来一张”这类对刚出的图或方案的修改，以及抠图）、" +
				"web（需要联网查最新信息）、workspace（放大、压缩、导出、发送到工作台、网页截图、导入商品链接等站内工具）。" +
				"电商商品套图不要用它，用 commerce_set_plan。只在第一步、确定需要时调用；不要先回答再调用。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"target": map[string]any{"type": "string", "enum": []any{HandOverCreate, HandOverWeb, HandOverWorkspace}},
					"reason": map[string]any{"type": "string", "maxLength": 80},
				},
				"required":             []any{"target"},
				"additionalProperties": false,
			},
			Risk:           RiskRead,
			Level:          LevelRead,
			Timeout:        time.Second,
			MaxResultBytes: 1 << 10,
			Execute: func(_ context.Context, invocation Invocation) (Result, error) {
				var request struct {
					Target string `json:"target"`
				}
				if err := json.Unmarshal(invocation.Arguments, &request); err != nil {
					return Result{}, errors.New("交接参数格式不正确")
				}
				switch request.Target {
				case HandOverCreate, HandOverWeb, HandOverWorkspace:
				default:
					return Result{Content: `{"error":"target 只能是 create、web 或 workspace"}`, Meta: map[string]any{"invalid": true}}, nil
				}
				return Result{Content: `{"handedOver":true}`, Meta: map[string]any{HandOverMeta: request.Target}}, nil
			},
		}},
	}
}
