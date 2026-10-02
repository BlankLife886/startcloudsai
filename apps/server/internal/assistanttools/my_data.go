package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

const (
	ToolMyStatsQuery  = "my_stats_query"
	ToolMyRecordsList = "my_records_list"

	PermissionMyDataRead Permission = "my_data.read"
)

func enumStrings[T ~string](values []T) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, string(value))
	}
	return out
}

func metricIDs() []usermetrics.Metric {
	out := []usermetrics.Metric{}
	for _, metric := range usermetrics.Metrics() {
		out = append(out, metric.ID)
	}
	return out
}

func dimensionIDs() []usermetrics.Dimension {
	out := []usermetrics.Dimension{}
	for _, dimension := range usermetrics.Dimensions() {
		out = append(out, dimension.ID)
	}
	return out
}

func presetIDs() []usermetrics.RangePreset {
	out := []usermetrics.RangePreset{}
	for _, preset := range usermetrics.RangePresets() {
		out = append(out, preset.ID)
	}
	return out
}

func timeRangeSchema() map[string]any {
	return map[string]any{
		"type":        "object",
		"description": "时间范围：给 preset，或者同时给 from 和 to（YYYY-MM-DD，含首尾，最长两年）。不确定时用 last_30_days。",
		"properties": map[string]any{
			"preset": map[string]any{"type": "string", "enum": enumStrings(presetIDs())},
			"from":   map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`},
			"to":     map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`},
		},
		"additionalProperties": false,
	}
}

func filtersSchema() map[string]any {
	return map[string]any{
		"type":        "object",
		"description": "可选筛选。workspace 取值如 t2i、ecommerce_design、assistant、infinite_canvas、developer_api；model 用结果里出现过的模型名；status 只用于创作类和 API 类（API 的失败是 failed 或 expired）；source 只用于积分类；apiKey 只用于 API 类，取结果里出现过的 Key 名称。",
		"properties": map[string]any{
			"workspace": map[string]any{"type": "string", "maxLength": 64},
			"model":     map[string]any{"type": "string", "maxLength": 120},
			"status":    map[string]any{"type": "string", "enum": []any{"queued", "running", "succeeded", "failed", "canceled", "pending", "expired"}},
			"source":    map[string]any{"type": "string", "maxLength": 64},
			"apiKey":    map[string]any{"type": "string", "maxLength": 120},
		},
		"additionalProperties": false,
	}
}

func metricCatalogText() string {
	text := "可选指标："
	for index, metric := range usermetrics.Metrics() {
		if index > 0 {
			text += "；"
		}
		text += metric.ID.String() + "=" + metric.Label + "（" + metric.Description + "）"
	}
	return text
}

// NewMyDataManifest exposes the user's own statistics and records. The user
// scope comes from Invocation.UserID, which the orchestrator fills from the
// run owner; nothing in the arguments can change it.
func NewMyDataManifest(db usermetrics.TxRunner, now func() time.Time) Manifest {
	if now == nil {
		now = time.Now
	}
	return Manifest{
		ID:          "my_data",
		Version:     "1",
		Description: "查询用户本人的创作、消耗、入账统计和明细",
		Tools: []Definition{
			{
				Name: ToolMyStatsQuery,
				Description: "统计用户本人的数据（创作次数、图片数、成功率、耗时、消耗、退回、入账、开发者 API 调用次数/失败率/消耗等），可按日期/周/月/星期/时段/功能/模型/状态/积分来源/API Key 分组，可与上一周期对比。" +
					"所有数字口径与个人中心、钱包页面一致。回答里的数字只能来自本工具的返回。" + metricCatalogText(),
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"metrics": map[string]any{
							"type": "array", "minItems": 1, "maxItems": 6,
							"items": map[string]any{"type": "string", "enum": enumStrings(metricIDs())},
						},
						"dimensions": map[string]any{
							"type": "array", "maxItems": 2,
							"description": "分组维度；日期、周、月只能选一个。不分组就省略。",
							"items":       map[string]any{"type": "string", "enum": enumStrings(dimensionIDs())},
						},
						"filters":           filtersSchema(),
						"timeRange":         timeRangeSchema(),
						"compareToPrevious": map[string]any{"type": "boolean", "description": "同时返回上一个可比周期，用于环比解读"},
					},
					"required":             []any{"metrics"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionMyDataRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        15 * time.Second,
				MaxResultBytes: 96 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var request usermetrics.Request
					if err := json.Unmarshal(invocation.Arguments, &request); err != nil {
						return Result{}, errors.New("统计参数格式不正确")
					}
					request.Timezone = invocation.Timezone
					result, err := usermetrics.Query(ctx, db, invocation.UserID, request, now())
					if err != nil {
						return toolError(err)
					}
					return jsonResultWithMeta(result, "stats")
				},
			},
			{
				Name:        ToolMyRecordsList,
				Description: "列出用户本人的具体记录：creations（创作记录）、spend（消耗明细）、income（入账明细）、api_calls（开发者 API 调用记录），sort=largest 时消耗、入账、API 按积分从大到小，创作记录按图片数从多到少，最多 50 条。问“最贵 / 花费最多的几次生成”要用 type=spend + sort=largest（创作记录不含积分）。每条带可点击的站内链接。要解释某一笔扣费的来龙去脉，把记录的 id 交给 explain_charge。",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"type":      map[string]any{"type": "string", "enum": []any{"creations", "spend", "income", "api_calls"}},
						"sort":      map[string]any{"type": "string", "enum": []any{"recent", "largest"}},
						"filters":   filtersSchema(),
						"timeRange": timeRangeSchema(),
						"limit":     map[string]any{"type": "integer", "minimum": 1, "maximum": 50},
					},
					"required":             []any{"type"},
					"additionalProperties": false,
				},
				Permissions:    []Permission{PermissionMyDataRead},
				Risk:           RiskRead,
				Level:          LevelRead,
				Timeout:        15 * time.Second,
				MaxResultBytes: 64 << 10,
				Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
					var request usermetrics.RecordsRequest
					if err := json.Unmarshal(invocation.Arguments, &request); err != nil {
						return Result{}, errors.New("记录查询参数格式不正确")
					}
					request.Timezone = invocation.Timezone
					result, err := usermetrics.ListRecords(ctx, db, invocation.UserID, request, now())
					if err != nil {
						return toolError(err)
					}
					return jsonResultWithMeta(result, "records")
				},
			},
		},
	}
}

// toolError turns a caller mistake into an observation the model can correct;
// infrastructure errors still fail the tool call.
func toolError(err error) (Result, error) {
	if errors.Is(err, usermetrics.ErrInvalid) {
		content, _ := json.Marshal(map[string]any{"error": err.Error()})
		return Result{Content: string(content), Meta: map[string]any{"invalid": true}}, nil
	}
	return Result{}, err
}

// jsonResultWithMeta returns the payload both as model-visible JSON and as
// structured metadata the client renders (charts, tables).
func jsonResultWithMeta(value any, view string) (Result, error) {
	content, err := json.Marshal(value)
	if err != nil {
		return Result{}, err
	}
	return Result{Content: string(content), Meta: map[string]any{"view": view, "data": value}}, nil
}
