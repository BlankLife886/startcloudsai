// Package usermetrics answers statistical questions about one user's own
// activity and spending. Callers pick metrics and dimensions from a fixed
// catalog; the package compiles them into SQL over the shared fact
// definitions in store/metric_facts.go. No caller-provided SQL is ever
// executed, and the user scope always comes from the caller's session.
package usermetrics

// Metric is one measurable quantity in the catalog.
type Metric string

const (
	MetricCreations    Metric = "creations"
	MetricImages       Metric = "images"
	MetricSucceeded    Metric = "succeeded"
	MetricFailed       Metric = "failed"
	MetricSuccessRate  Metric = "success_rate"
	MetricAvgSeconds   Metric = "avg_seconds"
	MetricSpendPoints  Metric = "spend_points"
	MetricDeductPoints Metric = "deduct_points"
	MetricRefundPoints Metric = "refund_points"
	MetricIncomePoints Metric = "income_points"
	MetricCostPerImage Metric = "cost_per_image"
)

func (m Metric) String() string { return string(m) }

// Dimension is one way to group the facts.
type Dimension string

const (
	DimDay       Dimension = "day"
	DimWeek      Dimension = "week"
	DimMonth     Dimension = "month"
	DimWeekday   Dimension = "weekday"
	DimHour      Dimension = "hour"
	DimWorkspace Dimension = "workspace"
	DimModel     Dimension = "model"
	DimStatus    Dimension = "status"
	DimSource    Dimension = "source"
)

// factFamily says which fact table a metric or dimension can be computed from.
type factFamily int

const (
	familyActivity factFamily = 1 << iota
	familyLedger
	familyBoth = familyActivity | familyLedger
)

type metricSpec struct {
	Label       string
	Unit        string
	Description string
	family      factFamily
}

type dimensionSpec struct {
	Label       string
	Description string
	family      factFamily
	time        bool
}

var metricCatalog = map[Metric]metricSpec{
	MetricCreations:    {"创作次数", "次", "站内图片任务与 AI 助手运行的次数，与个人中心一致", familyActivity},
	MetricImages:       {"生成图片数", "张", "成功生成的图片数（含之后删除的）", familyActivity},
	MetricSucceeded:    {"成功次数", "次", "状态为成功的创作次数", familyActivity},
	MetricFailed:       {"失败次数", "次", "状态为失败的创作次数", familyActivity},
	MetricSuccessRate:  {"成功率", "%", "成功次数 ÷（成功 + 失败）；排队中、运行中、已取消不计入", familyActivity},
	MetricAvgSeconds:   {"平均耗时", "秒", "有开始和结束时间的创作的平均耗时，单次最多计 1 小时", familyActivity},
	MetricSpendPoints:  {"消耗积分", "积分", "生成消耗，与钱包“已消耗”中的生成部分一致", familyLedger},
	MetricDeductPoints: {"人工扣减", "积分", "平台人工调整扣减的积分；钱包“已消耗”= 消耗积分 + 人工扣减", familyLedger},
	MetricRefundPoints: {"退回积分", "积分", "冻结后退回可用余额的积分，与钱包“退回”一致", familyLedger},
	MetricIncomePoints: {"入账积分", "积分", "充值、订阅发放、奖励、人工补发等入账，与钱包“入账”一致", familyLedger},
	MetricCostPerImage: {"单张平均成本", "积分/张", "消耗积分 ÷ 生成图片数", familyBoth},
}

var dimensionCatalog = map[Dimension]dimensionSpec{
	DimDay:       {"日期", "按用户本地日期", familyBoth, true},
	DimWeek:      {"周", "按自然周（周一开始）", familyBoth, true},
	DimMonth:     {"月份", "按自然月", familyBoth, true},
	DimWeekday:   {"星期", "周一到周日的分布", familyBoth, false},
	DimHour:      {"时段", "一天 24 小时的分布", familyBoth, false},
	DimWorkspace: {"功能", "文生图、AI 电商、AI 助手等", familyBoth, false},
	DimModel:     {"模型", "使用的模型", familyBoth, false},
	DimStatus:    {"状态", "成功、失败、已取消等，只适用于创作类指标", familyActivity, false},
	DimSource:    {"积分来源", "积分变动的来源，只适用于积分类指标", familyLedger, false},
}

// WorkspaceLabels mirror TASK_TYPE_LABELS in the web client.
var WorkspaceLabels = map[string]string{
	"assistant":         "AI 助手",
	"infinite_canvas":   "无限画布",
	"t2i":               "文生图",
	"coloring":          "插画染色",
	"ui_design":         "UI 设计稿",
	"ecommerce_design":  "AI 电商",
	"model_sheet":       "模型设计",
	"game_art":          "游戏设计",
	"puzzle":            "拼图",
	"background_remove": "背景移除",
	"media_tool":        "媒体工具",
	"developer_api":     "API 调用",
	"other":             "其他",
}

// SourceLabels mirror the wallet page's ledger source labels.
var SourceLabels = map[string]string{
	"task":                     "创作任务",
	"assistant_run":            "AI 助手",
	"developer_api":            "API 调用",
	"order":                    "套餐入账",
	"redeem_code":              "兑换码入账",
	"daily_checkin":            "签到奖励",
	"subscription_daily":       "订阅积分发放",
	"subscription_cycle":       "订阅周期发放",
	"subscription_refund_hold": "订阅退订处理",
	"signup_bonus":             "注册赠送",
	"admin":                    "人工调整",
	"trial_access":             "体验积分",
	"usage_milestone":          "激励积分",
	"growth_group":             "拼团积分",
	"feedback_adoption":        "建议采纳",
	"task_failure_bonus":       "失败补偿",
	"referral":                 "邀请奖励",
	"referral_settlement":      "邀请奖励",
}

var statusLabels = map[string]string{
	"queued":    "排队中",
	"running":   "运行中",
	"succeeded": "成功",
	"failed":    "失败",
	"canceled":  "已取消",
}

var weekdayLabels = [7]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}

// MetricInfo describes a metric for tool schemas and result headers.
type MetricInfo struct {
	ID          Metric `json:"id"`
	Label       string `json:"label"`
	Unit        string `json:"unit"`
	Description string `json:"description"`
}

// DimensionInfo describes a dimension for tool schemas and result headers.
type DimensionInfo struct {
	ID          Dimension `json:"id"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
}

// Metrics lists the catalog in a stable order.
func Metrics() []MetricInfo {
	order := []Metric{
		MetricCreations, MetricImages, MetricSucceeded, MetricFailed, MetricSuccessRate, MetricAvgSeconds,
		MetricSpendPoints, MetricDeductPoints, MetricRefundPoints, MetricIncomePoints, MetricCostPerImage,
	}
	out := make([]MetricInfo, 0, len(order))
	for _, id := range order {
		spec := metricCatalog[id]
		out = append(out, MetricInfo{ID: id, Label: spec.Label, Unit: spec.Unit, Description: spec.Description})
	}
	return out
}

// Dimensions lists the catalog in a stable order.
func Dimensions() []DimensionInfo {
	order := []Dimension{DimDay, DimWeek, DimMonth, DimWeekday, DimHour, DimWorkspace, DimModel, DimStatus, DimSource}
	out := make([]DimensionInfo, 0, len(order))
	for _, id := range order {
		spec := dimensionCatalog[id]
		out = append(out, DimensionInfo{ID: id, Label: spec.Label, Description: spec.Description})
	}
	return out
}

func labelFor(dimension Dimension, key string) string {
	switch dimension {
	case DimWorkspace:
		if label, ok := WorkspaceLabels[key]; ok {
			return label
		}
	case DimSource:
		if label, ok := SourceLabels[key]; ok {
			return label
		}
	case DimStatus:
		if label, ok := statusLabels[key]; ok {
			return label
		}
	case DimModel:
		if key == "" {
			return "未记录模型"
		}
	}
	if key == "" {
		return "其他"
	}
	return key
}
