// Package statseval evaluates the assistant's answers to questions about the
// user's own data. Each case pairs a real-world phrasing with what a correct
// answer must do: which tool, which metrics and groupings, which time window,
// whether to compare periods. Every answer is also checked against the rule
// that matters most: each number in it must come from a tool result.
package statseval

import (
	um "github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// Tool names, repeated here so the cases read on their own.
const (
	toolStats    = "my_stats_query"
	toolRecords  = "my_records_list"
	toolAccount  = "my_account_overview"
	toolOrders   = "my_orders_list"
	toolCharge   = "explain_charge"
	toolTaskStat = "task_status"
)

// Expect is what a correct answer does. Empty fields are not checked.
type Expect struct {
	// Tool must be called at least once. The remaining checks pass when any
	// one call of this tool satisfies all of them.
	Tool string `json:"tool"`
	// AlsoAccept lists other tools that answer the question correctly; they
	// pass the tool check without argument checks.
	AlsoAccept []string `json:"alsoAccept,omitempty"`
	// Metrics must all be requested; MetricsAny needs at least one of them.
	Metrics    []um.Metric `json:"metrics,omitempty"`
	MetricsAny []um.Metric `json:"metricsAny,omitempty"`
	// Dimensions must all be grouped by; DimensionsAny needs one of them.
	Dimensions    []um.Dimension `json:"dimensions,omitempty"`
	DimensionsAny []um.Dimension `json:"dimensionsAny,omitempty"`
	// Preset or LastDays fix the time window. They are compared after
	// resolving, so last_month and the same explicit dates are equal.
	Preset   um.RangePreset `json:"preset,omitempty"`
	LastDays int            `json:"lastDays,omitempty"`
	Compare  bool           `json:"compare,omitempty"`
	// Records checks for my_records_list.
	RecordType string `json:"recordType,omitempty"`
	Sort       string `json:"sort,omitempty"`
	// Filters are field → value on the tool's filters object (or, for
	// my_orders_list, top-level arguments such as status).
	Filters map[string]string `json:"filters,omitempty"`
	// MentionsChange requires the answer to describe a change (上升, 减少…),
	// for questions that ask how something moved.
	MentionsChange bool `json:"mentionsChange,omitempty"`
}

// Case is one labelled question.
type Case struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Prompt   string `json:"prompt"`
	Expect   Expect `json:"expect"`
	Note     string `json:"note,omitempty"`
}

// Categories in report order.
var Categories = []string{"总量", "时间", "对比", "分组", "明细", "API", "账户", "扣费"}

func metrics(values ...um.Metric) []um.Metric    { return values }
func dims(values ...um.Dimension) []um.Dimension { return values }
func filter(key, value string) map[string]string { return map[string]string{key: value} }
func stats(m []um.Metric, preset um.RangePreset) Expect {
	return Expect{Tool: toolStats, Metrics: m, Preset: preset}
}

// BuiltinCases is the versioned evaluation set: 64 phrasings collected from
// how users actually ask, including vague ones that should default to the
// last 30 days rather than a follow-up question.
var BuiltinCases = []Case{
	// 总量：单个数字，默认最近 30 天。
	{ID: "total-01", Category: "总量", Prompt: "我最近创作了多少次", Expect: stats(metrics(um.MetricCreations), um.RangeLast30Days)},
	{ID: "total-02", Category: "总量", Prompt: "这个月我一共生成了多少张图", Expect: stats(metrics(um.MetricImages), um.RangeThisMonth)},
	{ID: "total-03", Category: "总量", Prompt: "我花了多少积分", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricSpendPoints), Preset: um.RangeLast30Days}, Note: "含糊问题默认最近 30 天"},
	{ID: "total-04", Category: "总量", Prompt: "我的生成成功率怎么样", Expect: stats(metrics(um.MetricSuccessRate), um.RangeLast30Days)},
	{ID: "total-05", Category: "总量", Prompt: "平均一张图要多少积分", Expect: stats(metrics(um.MetricCostPerImage), um.RangeLast30Days)},
	{ID: "total-06", Category: "总量", Prompt: "生成一次平均要等多久", Expect: stats(metrics(um.MetricAvgSeconds), um.RangeLast30Days)},
	{ID: "total-07", Category: "总量", Prompt: "今年我总共充了多少积分", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricIncomePoints), Preset: um.RangeThisYear, AlsoAccept: []string{toolOrders}}, Note: "“充值”也可以理解为已完成的充值订单"},
	{ID: "total-08", Category: "总量", Prompt: "失败了几次", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricFailed, um.MetricSuccessRate), Preset: um.RangeLast30Days}},
	{ID: "total-09", Category: "总量", Prompt: "退回给我的积分一共有多少", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricRefundPoints)}, Note: "“一共”可以理解为全部时间，也可以默认最近 30 天"},
	{ID: "total-10", Category: "总量", Prompt: "我从注册到现在一共用了多少积分", Expect: stats(metrics(um.MetricSpendPoints), um.RangeAllTime)},

	// 时间：预设和自定义窗口。
	{ID: "time-01", Category: "时间", Prompt: "今天用了多少积分", Expect: stats(metrics(um.MetricSpendPoints), um.RangeToday)},
	{ID: "time-02", Category: "时间", Prompt: "昨天生成了几张图", Expect: stats(metrics(um.MetricImages), um.RangeYesterday)},
	{ID: "time-03", Category: "时间", Prompt: "这周的消耗", Expect: stats(metrics(um.MetricSpendPoints), um.RangeThisWeek)},
	{ID: "time-04", Category: "时间", Prompt: "上周我创作了多少次", Expect: stats(metrics(um.MetricCreations), um.RangeLastWeek)},
	{ID: "time-05", Category: "时间", Prompt: "上个月花了多少积分", Expect: stats(metrics(um.MetricSpendPoints), um.RangeLastMonth)},
	{ID: "time-06", Category: "时间", Prompt: "最近 7 天的成功率", Expect: stats(metrics(um.MetricSuccessRate), um.RangeLast7Days)},
	{ID: "time-07", Category: "时间", Prompt: "最近两周生成了多少张", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricImages), LastDays: 14}},
	{ID: "time-08", Category: "时间", Prompt: "去年一年我的创作次数", Expect: stats(metrics(um.MetricCreations), um.RangeLastYear)},

	// 对比：需要上一周期并说明变化。
	{ID: "compare-01", Category: "对比", Prompt: "这个月比上个月多花了多少", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Preset: um.RangeThisMonth, Compare: true, MentionsChange: true}},
	{ID: "compare-02", Category: "对比", Prompt: "上周比前一周创作得多还是少", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricCreations), Preset: um.RangeLastWeek, Compare: true, MentionsChange: true}},
	{ID: "compare-03", Category: "对比", Prompt: "我最近的成功率是变好了还是变差了", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSuccessRate), Compare: true, MentionsChange: true}},
	{ID: "compare-04", Category: "对比", Prompt: "最近 7 天的消耗和之前 7 天比怎么样", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Preset: um.RangeLast7Days, Compare: true, MentionsChange: true}},
	{ID: "compare-05", Category: "对比", Prompt: "今年和去年同期比，生成的图多了吗", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricImages), Compare: true, MentionsChange: true}, Note: "上一周期是去年全年，回答应说明口径"},
	{ID: "compare-06", Category: "对比", Prompt: "为什么这个月花得比上个月多", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Preset: um.RangeThisMonth, Compare: true, DimensionsAny: dims(um.DimWorkspace, um.DimModel), MentionsChange: true}, Note: "要找变化最大的部分"},

	// 分组：排名、分布、趋势。
	{ID: "group-01", Category: "分组", Prompt: "积分都花在哪了", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Dimensions: dims(um.DimWorkspace)}},
	{ID: "group-02", Category: "分组", Prompt: "哪个模型最费钱", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Dimensions: dims(um.DimModel)}},
	{ID: "group-03", Category: "分组", Prompt: "我一般几点创作最多", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricCreations), Dimensions: dims(um.DimHour)}},
	{ID: "group-04", Category: "分组", Prompt: "一周里哪天我最活跃", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricCreations, um.MetricImages), Dimensions: dims(um.DimWeekday)}},
	{ID: "group-05", Category: "分组", Prompt: "画一下最近 30 天每天的消耗趋势", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Dimensions: dims(um.DimDay), Preset: um.RangeLast30Days}},
	{ID: "group-06", Category: "分组", Prompt: "今年每个月生成了多少张图", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricImages), Dimensions: dims(um.DimMonth), Preset: um.RangeThisYear}},
	{ID: "group-07", Category: "分组", Prompt: "哪个功能失败最多", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricFailed, um.MetricSuccessRate), Dimensions: dims(um.DimWorkspace)}},
	{ID: "group-08", Category: "分组", Prompt: "我的积分都是从哪来的", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricIncomePoints), Dimensions: dims(um.DimSource)}},
	{ID: "group-09", Category: "分组", Prompt: "电商这个月花了多少", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSpendPoints), Preset: um.RangeThisMonth, Filters: filter("workspace", "ecommerce_design")}},
	{ID: "group-10", Category: "分组", Prompt: "各个模型的成功率对比", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricSuccessRate), Dimensions: dims(um.DimModel)}},
	{ID: "group-11", Category: "分组", Prompt: "文生图和 AI 电商哪个用得多", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricCreations, um.MetricImages, um.MetricSpendPoints), Dimensions: dims(um.DimWorkspace)}},
	{ID: "group-12", Category: "分组", Prompt: "每周的创作量是在涨还是在跌", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricCreations), Dimensions: dims(um.DimWeek), MentionsChange: true}},

	// 明细：具体记录。
	{ID: "records-01", Category: "明细", Prompt: "最贵的 10 次生成是哪些", Expect: Expect{Tool: toolRecords, RecordType: "spend", Sort: "largest"}},
	{ID: "records-02", Category: "明细", Prompt: "把我最近失败的几次列出来", Expect: Expect{Tool: toolRecords, RecordType: "creations", Filters: filter("status", "failed"), AlsoAccept: []string{toolTaskStat}}, Note: "task_status 的 failed 范围也能回答"},
	{ID: "records-03", Category: "明细", Prompt: "最近的入账记录", Expect: Expect{Tool: toolRecords, RecordType: "income", Sort: "recent"}},
	{ID: "records-04", Category: "明细", Prompt: "今天都生成了些什么", Expect: Expect{Tool: toolRecords, RecordType: "creations", Preset: um.RangeToday}},
	{ID: "records-05", Category: "明细", Prompt: "上个月消耗最多的几笔", Expect: Expect{Tool: toolRecords, RecordType: "spend", Sort: "largest", Preset: um.RangeLastMonth}},
	{ID: "records-06", Category: "明细", Prompt: "我在电商里最近做过哪些图", Expect: Expect{Tool: toolRecords, RecordType: "creations", Filters: filter("workspace", "ecommerce_design")}},
	{ID: "records-07", Category: "明细", Prompt: "一次出图最多的是哪次", Expect: Expect{Tool: toolRecords, RecordType: "creations", Sort: "largest"}},
	{ID: "records-08", Category: "明细", Prompt: "签到奖励领了哪些", Expect: Expect{Tool: toolRecords, RecordType: "income", Filters: filter("source", "daily_checkin")}},

	// API：开发者接口用量。
	{ID: "api-01", Category: "API", Prompt: "这个月 API 调用了多少次", Expect: stats(metrics(um.MetricAPICalls), um.RangeThisMonth)},
	{ID: "api-02", Category: "API", Prompt: "我的 API 失败率高吗", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricAPIFailureRate)}},
	{ID: "api-03", Category: "API", Prompt: "API 这个月扣了多少积分", Expect: stats(metrics(um.MetricAPISpendPoints), um.RangeThisMonth)},
	{ID: "api-04", Category: "API", Prompt: "哪个 Key 用得最多", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricAPICalls, um.MetricAPISpendPoints), Dimensions: dims(um.DimAPIKey)}},
	{ID: "api-05", Category: "API", Prompt: "接口每天调用量的趋势", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricAPICalls), Dimensions: dims(um.DimDay)}},
	{ID: "api-06", Category: "API", Prompt: "API 用的最多的是哪个模型", Expect: Expect{Tool: toolStats, MetricsAny: metrics(um.MetricAPICalls, um.MetricAPISpendPoints), Dimensions: dims(um.DimModel)}},
	{ID: "api-07", Category: "API", Prompt: "最近失败的 API 请求有哪些", Expect: Expect{Tool: toolRecords, RecordType: "api_calls"}},
	{ID: "api-08", Category: "API", Prompt: "API 调用失败率这周比上周怎么样", Expect: Expect{Tool: toolStats, Metrics: metrics(um.MetricAPIFailureRate), Preset: um.RangeThisWeek, Compare: true, MentionsChange: true}},

	// 账户：余额、订阅、订单。
	{ID: "account-01", Category: "账户", Prompt: "我还有多少积分", Expect: Expect{Tool: toolAccount}},
	{ID: "account-02", Category: "账户", Prompt: "我的会员什么时候到期", Expect: Expect{Tool: toolAccount}},
	{ID: "account-03", Category: "账户", Prompt: "今天的订阅积分发了吗", Expect: Expect{Tool: toolAccount}},
	{ID: "account-04", Category: "账户", Prompt: "为什么有积分被冻结了", Expect: Expect{Tool: toolAccount}, Note: "冻结额来自余额概况，原因可再查进行中的任务"},
	{ID: "account-05", Category: "账户", Prompt: "我刚付的款到账了吗", Expect: Expect{Tool: toolOrders}},
	{ID: "account-06", Category: "账户", Prompt: "有没有没付款的订单", Expect: Expect{Tool: toolOrders, Filters: filter("status", "unsettled")}, Note: "也可以用 pending"},
	{ID: "account-07", Category: "账户", Prompt: "我买过哪些套餐", Expect: Expect{Tool: toolOrders}, Note: "列出全部订单并说明哪些已完成同样正确"},
	{ID: "account-08", Category: "账户", Prompt: "订阅每天发多少积分，还能发几天", Expect: Expect{Tool: toolAccount}},

	// 扣费：解释单笔。
	{ID: "charge-01", Category: "扣费", Prompt: "刚才那笔为什么扣了这么多积分", Expect: Expect{Tool: toolCharge}},
	{ID: "charge-02", Category: "扣费", Prompt: "最近一次扣费是怎么算的", Expect: Expect{Tool: toolCharge}},
	{ID: "charge-03", Category: "扣费", Prompt: "生成失败的那次积分退回来了吗", Expect: Expect{Tool: toolCharge, AlsoAccept: []string{toolTaskStat}}, Note: "task_status 也能回答，但 explain_charge 给出完整流水"},
	{ID: "charge-04", Category: "扣费", Prompt: "昨天最贵的那次是怎么扣的", Expect: Expect{Tool: toolCharge}, Note: "先用 my_records_list 找到记录再解释"},
}
