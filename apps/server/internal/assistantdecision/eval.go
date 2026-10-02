package assistantdecision

import (
	"context"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/decision"
)

// EvalCase is one labeled message: what the user typed (with optional prior
// context) and the intent a correct judgment reaches.
type EvalCase struct {
	ID       string `json:"id"`
	Prompt   string `json:"prompt"`
	Context  string `json:"context,omitempty"`
	Expected string `json:"expected"`
	// Note says why the case is in the set (e.g. a past false positive).
	Note string `json:"note,omitempty"`
}

// BuiltinCases is the versioned evaluation set. It deliberately includes the
// keyword false positives found in production review (物联网, 上网本, coding
// questions about tasks) so a regression in either the model or the rules
// shows up here.
var BuiltinCases = []EvalCase{
	{ID: "answer-01", Prompt: "帮我写一段 618 商品文案", Expected: IntentAnswer},
	{ID: "answer-02", Prompt: "物联网设备怎么配网", Expected: IntentAnswer, Note: "曾被关键词误判为联网搜索"},
	{ID: "answer-03", Prompt: "上网本和平板怎么选", Expected: IntentAnswer, Note: "曾被关键词误判为联网搜索"},
	{ID: "answer-04", Prompt: "帮我写一个定时任务失败自动重试的 Go 函数", Expected: IntentAnswer, Note: "曾被误判为任务状态"},
	{ID: "answer-05", Prompt: "Celery 任务状态一直是 PENDING 怎么排查", Expected: IntentAnswer, Note: "曾被误判为任务状态"},
	{ID: "answer-06", Prompt: "帮我优化一下简历的配色", Expected: IntentAnswer, Note: "曾被问答模式误拦"},
	{ID: "answer-07", Prompt: "我想修改一下这个界面的文案", Expected: IntentAnswer, Note: "曾被问答模式误拦"},
	{ID: "answer-08", Prompt: "如何写出好的生图提示词", Expected: IntentAnswer},
	{ID: "answer-09", Prompt: "你好", Expected: IntentAnswer},
	{ID: "answer-10", Prompt: "把这段话改得更简洁有力：我们的产品非常非常好用", Expected: IntentAnswer},
	{ID: "answer-11", Prompt: "电商主图一般用什么比例", Expected: IntentAnswer},
	{ID: "answer-12", Prompt: "这个平台的无限画布怎么用", Expected: IntentAnswer},
	{ID: "mydata-01", Prompt: "这个月积分都花在哪了", Expected: IntentMyData},
	{ID: "mydata-02", Prompt: "我最近 30 天创作了多少张图", Expected: IntentMyData},
	{ID: "mydata-03", Prompt: "最贵的 10 次生成是哪些", Expected: IntentMyData},
	{ID: "mydata-04", Prompt: "我的生成成功率怎么样", Expected: IntentMyData},
	{ID: "mydata-05", Prompt: "上周比前一周多花了多少", Expected: IntentMyData},
	{ID: "mydata-06", Prompt: "我一般什么时间段创作最多", Expected: IntentMyData},
	{ID: "mydata-07", Prompt: "哪个模型最费钱", Expected: IntentMyData},
	{ID: "mydata-08", Prompt: "今年我一共充值了多少积分", Expected: IntentMyData},
	{ID: "mydata-09", Prompt: "我刚才那个任务为什么失败了", Expected: IntentMyData, Note: "任务排查也由 v2 的只读工具处理"},
	{ID: "mydata-10", Prompt: "失败的那次生图退款了吗", Expected: IntentMyData},
	{ID: "mydata-11", Prompt: "找一下我之前生成的精华瓶图片", Expected: IntentMyData, Note: "曾被规则误判为生成图片（含“生成”“图片”）"},
	{ID: "mydata-12", Prompt: "把资产库里的海报都移到节日分组", Expected: IntentMyData},
	{ID: "create-01", Prompt: "帮我生成一张猫咪海报", Expected: IntentCreate},
	{ID: "create-02", Prompt: "画一只戴帽子的柴犬", Expected: IntentCreate},
	{ID: "create-03", Prompt: "做一套保温杯的天猫主图", Expected: IntentCreate},
	{ID: "create-04", Prompt: "再来一张", Context: "助手：[生成了 2 张图片：戴帽子的猫]", Expected: IntentCreate},
	{ID: "create-05", Prompt: "背景改成星空", Context: "助手：[生成了 1 张图片：城市夜景]", Expected: IntentCreate},
	{ID: "create-06", Prompt: "设计一个简洁的品牌图标", Expected: IntentCreate},
	{ID: "create-07", Prompt: "把这张图的背景换成纯白", Context: "（本轮附带 1 张参考图、0 个文档）", Expected: IntentCreate},
	{ID: "create-08", Prompt: "给我出 4 张不同风格的头像", Expected: IntentCreate},
	{ID: "create-09", Prompt: "帮我把这张图抠图", Context: "（本轮附带 1 张参考图、0 个文档）", Expected: IntentCreate},
	{ID: "web-01", Prompt: "联网搜索一下今天的科技新闻", Expected: IntentWeb},
	{ID: "web-02", Prompt: "查一下最新的 iPhone 发布会说了什么", Expected: IntentWeb},
	{ID: "web-03", Prompt: "帮我联网查一下物联网行业的最新融资消息", Expected: IntentWeb},
	{ID: "web-04", Prompt: "现在黄金价格是多少", Expected: IntentWeb},
	{ID: "workspace-01", Prompt: "帮我把这张图高清放大", Context: "（本轮附带 1 张参考图、0 个文档）", Expected: IntentWorkspace},
	{ID: "workspace-02", Prompt: "导出交付包", Expected: IntentWorkspace},
	{ID: "workspace-03", Prompt: "把这几张图发送到无限画布", Expected: IntentWorkspace},
	{ID: "workspace-04", Prompt: "给这个网站截个图 https://example.com", Expected: IntentWorkspace},
	{ID: "workspace-05", Prompt: "帮我找几张露营主题的参考图", Expected: IntentWorkspace},
	{ID: "account-01", Prompt: "怎么退订我的会员", Expected: IntentAccount},
	{ID: "account-02", Prompt: "我想充值 100 元", Expected: IntentAccount},
	{ID: "account-03", Prompt: "帮我改一下登录密码", Expected: IntentAccount},
	{ID: "account-04", Prompt: "怎么创建一个 API Key", Expected: IntentAccount},
}

// CaseResult is one evaluated case.
type CaseResult struct {
	EvalCase
	Got            string  `json:"got"`
	ProviderIntent string  `json:"providerIntent"`
	RulesIntent    string  `json:"rulesIntent"`
	Confidence     float64 `json:"confidence"`
	LowConfidence  bool    `json:"lowConfidence"`
	Provider       string  `json:"provider"`
	LatencyMs      int64   `json:"latencyMs"`
	Correct        bool    `json:"correct"`
	Error          string  `json:"error,omitempty"`
}

// IntentScore counts one expected intent's results.
type IntentScore struct {
	Intent  string `json:"intent"`
	Total   int    `json:"total"`
	Correct int    `json:"correct"`
}

// ThresholdPoint is the accuracy the set would reach with a given intent
// threshold (below it, the rules' answer is used).
type ThresholdPoint struct {
	Threshold float64 `json:"threshold"`
	Accuracy  float64 `json:"accuracy"`
}

// TimeoutPoint is what the set would score if turns waited at most
// TimeoutMs for the model before the rules answered.
type TimeoutPoint struct {
	TimeoutMs    int     `json:"timeoutMs"`
	Accuracy     float64 `json:"accuracy"`
	FallbackRate float64 `json:"fallbackRate"`
}

// MeasuringSetup lifts the wait limit so an evaluation sees how long the
// model really takes; the report then replays shorter limits.
func MeasuringSetup(setup Setup) Setup {
	if chain, ok := setup.Decider.(decision.Chain); ok && chain.Primary != nil {
		chain.Timeout = time.Duration(decision.MaxTimeoutMs) * time.Millisecond
		setup.Decider = chain
	}
	return setup
}

// Report summarises an evaluation.
type Report struct {
	ModelID         string           `json:"modelId"`
	Mode            string           `json:"mode"`
	Total           int              `json:"total"`
	Correct         int              `json:"correct"`
	Accuracy        float64          `json:"accuracy"`
	RulesAccuracy   float64          `json:"rulesAccuracy"`
	AvgLatencyMs    float64          `json:"avgLatencyMs"`
	FallbackCount   int              `json:"fallbackCount"`
	ByIntent        []IntentScore    `json:"byIntent"`
	Mistakes        []CaseResult     `json:"mistakes"`
	Cases           []CaseResult     `json:"cases"`
	ThresholdCurve  []ThresholdPoint `json:"thresholdCurve,omitempty"`
	SuggestedIntent *float64         `json:"suggestedIntentThreshold,omitempty"`
	// Latency and the timeout curve come from a model run measured without
	// the production wait limit (see MeasuringSetup).
	LatencyP50Ms     int64          `json:"latencyP50Ms,omitempty"`
	LatencyP90Ms     int64          `json:"latencyP90Ms,omitempty"`
	LatencyMaxMs     int64          `json:"latencyMaxMs,omitempty"`
	TimeoutCurve     []TimeoutPoint `json:"timeoutCurve,omitempty"`
	SuggestedTimeout *int           `json:"suggestedTimeoutMs,omitempty"`
	DurationMs       int64          `json:"durationMs"`
}

func caseState(item EvalCase) string {
	state := ""
	if item.Context != "" {
		state = item.Context + "\n"
	}
	return state + "用户：" + item.Prompt
}

func round3(value float64) float64 { return math.Round(value*1000) / 1000 }

// Evaluate runs every case through setupFor(prompt) with bounded
// concurrency. mode labels the report ("rules" or "model").
func Evaluate(ctx context.Context, cases []EvalCase, mode string, setupFor func(prompt string) Setup, concurrency int) Report {
	started := time.Now()
	if concurrency < 1 {
		concurrency = 1
	}
	results := make([]CaseResult, len(cases))
	var modelID string
	var modelOnce sync.Once
	slots := make(chan struct{}, concurrency)
	var wait sync.WaitGroup
	for index, item := range cases {
		wait.Add(1)
		go func(index int, item EvalCase) {
			defer wait.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			setup := setupFor(item.Prompt)
			modelOnce.Do(func() { modelID = setup.ModelID })
			result := Decide(ctx, setup, caseState(item))
			entry := CaseResult{
				EvalCase: item, Got: result.Intent, ProviderIntent: result.ProviderIntent, RulesIntent: result.RulesIntent,
				Confidence: result.Confidence, LowConfidence: result.LowConfidence, Provider: result.Response.Provider,
				LatencyMs: result.Response.LatencyMs, Correct: result.Intent == item.Expected,
			}
			if result.Err != nil {
				entry.Error = result.Err.Error()
			}
			results[index] = entry
		}(index, item)
	}
	wait.Wait()

	report := Report{ModelID: modelID, Mode: mode, Total: len(results), Cases: results, Mistakes: []CaseResult{}, ByIntent: []IntentScore{}}
	byIntent := map[string]*IntentScore{}
	var latency int64
	rulesCorrect := 0
	for _, result := range results {
		score := byIntent[result.Expected]
		if score == nil {
			score = &IntentScore{Intent: result.Expected}
			byIntent[result.Expected] = score
		}
		score.Total++
		if result.Correct {
			report.Correct++
			score.Correct++
		} else {
			report.Mistakes = append(report.Mistakes, result)
		}
		if result.RulesIntent == result.Expected {
			rulesCorrect++
		}
		if result.Provider == "rules" {
			report.FallbackCount++
		}
		latency += result.LatencyMs
	}
	for _, intent := range Intents {
		if score := byIntent[intent]; score != nil {
			report.ByIntent = append(report.ByIntent, *score)
		}
	}
	if report.Total > 0 {
		report.Accuracy = round3(float64(report.Correct) / float64(report.Total))
		report.RulesAccuracy = round3(float64(rulesCorrect) / float64(report.Total))
		report.AvgLatencyMs = round3(float64(latency) / float64(report.Total))
	}
	if mode == "model" {
		report.ThresholdCurve, report.SuggestedIntent = thresholdCurve(results)
		latencyCurve(&report, results)
	}
	sort.SliceStable(report.Mistakes, func(i, j int) bool { return report.Mistakes[i].ID < report.Mistakes[j].ID })
	report.DurationMs = time.Since(started).Milliseconds()
	return report
}

// thresholdCurve replays the cases at thresholds 0.00–0.95: a provider
// answer below the threshold is replaced by the rules' answer. The suggested
// threshold is the lowest one reaching the best accuracy, so the model's own
// judgment is kept wherever it is at least as good.
func thresholdCurve(results []CaseResult) ([]ThresholdPoint, *float64) {
	if len(results) == 0 {
		return nil, nil
	}
	curve := []ThresholdPoint{}
	best := -1.0
	var suggested float64
	for step := 0; step <= 19; step++ {
		threshold := round3(float64(step) * 0.05)
		correct := 0
		for _, result := range results {
			intent := result.ProviderIntent
			if result.Provider == "rules" || intent == "" || (result.Confidence < threshold && result.RulesIntent != "") {
				intent = result.RulesIntent
			}
			if intent == result.Expected {
				correct++
			}
		}
		accuracy := round3(float64(correct) / float64(len(results)))
		curve = append(curve, ThresholdPoint{Threshold: round3(threshold), Accuracy: accuracy})
		if accuracy > best {
			best, suggested = accuracy, round3(threshold)
		}
	}
	return curve, &suggested
}

// latencyCurve replays wait limits of 1–10 seconds: a case whose model
// answer took longer is scored with the rules' answer. The suggested limit is
// the shortest one within one case of the best accuracy, since every second
// of waiting delays the first visible token of every turn.
func latencyCurve(report *Report, results []CaseResult) {
	latencies := []int64{}
	for _, result := range results {
		if result.Provider == "llm" {
			latencies = append(latencies, result.LatencyMs)
		}
	}
	if len(latencies) == 0 || len(results) == 0 {
		return
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(p float64) int64 {
		return latencies[min(len(latencies)-1, int(math.Ceil(p*float64(len(latencies))))-1)]
	}
	report.LatencyP50Ms, report.LatencyP90Ms, report.LatencyMaxMs = percentile(0.5), percentile(0.9), latencies[len(latencies)-1]
	best := 0.0
	for timeout := 1000; timeout <= 10000; timeout += 1000 {
		correct, fallback := 0, 0
		for _, result := range results {
			intent := result.Got
			if result.Provider != "llm" || result.LatencyMs > int64(timeout) {
				intent = result.RulesIntent
				fallback++
			}
			if intent == result.Expected {
				correct++
			}
		}
		point := TimeoutPoint{TimeoutMs: timeout, Accuracy: round3(float64(correct) / float64(len(results))),
			FallbackRate: round3(float64(fallback) / float64(len(results)))}
		report.TimeoutCurve = append(report.TimeoutCurve, point)
		best = math.Max(best, point.Accuracy)
	}
	slack := 1.0/float64(len(results)) + 1e-9
	for _, point := range report.TimeoutCurve {
		if point.Accuracy >= best-slack {
			suggested := point.TimeoutMs
			report.SuggestedTimeout = &suggested
			return
		}
	}
}
