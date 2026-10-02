// Package assistantdecision is the AI assistant's per-turn judgment: which
// capability a message needs and whether to ask first. The worker uses it to
// route turns; the admin API uses the same code to evaluate decision models,
// so what is measured is exactly what runs.
package assistantdecision

import (
	"context"
	"errors"
	"log"
	"regexp"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/decision"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Intents the decision layer chooses between.
const (
	IntentAnswer    = "answer"
	IntentMyData    = "my_data"
	IntentCreate    = "create"
	IntentWeb       = "web"
	IntentWorkspace = "workspace"
	IntentAccount   = "account"
)

// Intents lists every intent in display order.
var Intents = []string{IntentAnswer, IntentMyData, IntentCreate, IntentWeb, IntentWorkspace, IntentAccount}

// DelegatesIntent reports intents whose capabilities still live in the
// original engine (image proposals, web search, workspace tools).
func DelegatesIntent(intent string) bool {
	switch intent {
	case IntentCreate, IntentWeb, IntentWorkspace:
		return true
	}
	return false
}

// Questions are asked of the decision provider every turn.
func Questions() []decision.Question {
	return []decision.Question{
		{
			ID: "intent", Kind: decision.KindChoice,
			Instructions: "判断用户最后一条消息主要需要哪类能力。",
			Options: []decision.Option{
				{ID: IntentAnswer, Description: "直接回答：闲聊、知识问答、写作、平台功能怎么用"},
				{ID: IntentMyData, Description: "查询用户本人的数据：用量、消耗、积分去向、创作次数、成功率、明细记录；查找或整理用户自己以前的图片、资产库"},
				{ID: IntentCreate, Description: "要求生成、修改或重绘图片和设计"},
				{ID: IntentWeb, Description: "需要联网查找最新的外部信息（新闻、价格、公开资料）"},
				{ID: IntentWorkspace, Description: "要求执行站内工具：抠图、放大、压缩、导出交付包、发送到工作台、网页截图、在网上找参考图、导入商品链接"},
				{ID: IntentAccount, Description: "账户与支付：充值、购买或退订套餐、订单、退款、修改密码、API Key"},
			},
		},
		{
			ID: "clarify", Kind: decision.KindYesNo,
			Instructions: "用户的要求是否缺少关键信息，必须先追问一个问题才能继续？能先给出合理默认答案的情况回答否。",
		},
	}
}

var myDataPattern = regexp.MustCompile(`(花了|花哪|花在|花费|钱|消耗|消费|扣了|扣费|积分|余额|用量|用了多少|多少张|多少次|成功率|失败率|统计|账单|明细|趋势|环比|本月|上月|这周|上周|今年)`)

// ownImagesPattern matches finding or organising the user's own images
// ("找一下我之前生成的海报", "把资产库里的图移到节日分组").
var ownImagesPattern = regexp.MustCompile(`((找|搜|翻|查|看看)[^，。？?！!,]{0,6}(我|自己|之前|以前|上次|上回|历史)[^，。？?！!,]{0,16}(图|照片|海报|素材|作品))|((资产库|素材库)[^，。？?！!,]{0,16}(整理|移到|移动|放到|分组|标签|删|找|搜))`)

// Rules answer only when the text makes the answer obvious, with deliberately
// low confidence; they are the fallback and the shadow baseline.
func Rules(prompt string) decision.Rules {
	return decision.Rules{
		"intent": func(string) (decision.Answer, bool) {
			switch {
			case ownImagesPattern.MatchString(prompt):
				// Before the image rules: "找我之前生成的图" mentions 生成 and 图.
				return decision.Answer{Choice: IntentMyData, Confidence: 0.5}, true
			case assistanttools.WebSearchRequested(prompt):
				return decision.Answer{Choice: IntentWeb, Confidence: 0.5}, true
			case assistanttools.WorkspaceToolForPrompt(prompt) != "":
				return decision.Answer{Choice: IntentWorkspace, Confidence: 0.5}, true
			case assistanttools.ImageActionRequested(prompt), commerceMakePattern.MatchString(prompt):
				return decision.Answer{Choice: IntentCreate, Confidence: 0.5}, true
			case myDataPattern.MatchString(prompt):
				return decision.Answer{Choice: IntentMyData, Confidence: 0.4}, true
			}
			return decision.Answer{Choice: IntentAnswer, Confidence: 0.2}, true
		},
		"clarify": decision.Fixed(decision.Answer{Yes: 0, Confidence: 0.2}),
	}
}

// Setup is everything one judgment needs: the chain (decision model first,
// rules as fallback), the rules alone for shadow comparison, and the
// thresholds for the model in use.
type Setup struct {
	Decider    decision.Decider
	Rules      decision.Rules
	Thresholds decision.Thresholds
	// ModelID is the decision model's id, empty when only rules are in use.
	ModelID string
}

// RulesOnly is the setup used when no decision model is available.
func RulesOnly(prompt string, thresholds decision.Thresholds) Setup {
	rules := Rules(prompt)
	return Setup{Decider: decision.Chain{Fallback: rules, Timeout: thresholds.Timeout()}, Rules: rules, Thresholds: thresholds}
}

// Resolve builds the setup for prompt. modelID chooses a specific chat model
// (for evaluation); empty applies the stored override, else the assistant
// page's default chat model. Any failure leaves the rules in charge.
func Resolve(ctx context.Context, q store.Q, masterKey, prompt, modelID string) Setup {
	override, err := decision.LoadOverride(ctx, q)
	if err != nil {
		log.Printf("assistant decision settings unreadable: %v", err)
	}
	setup := RulesOnly(prompt, override.ThresholdsFor(""))
	if modelID != "" {
		override.ModelID = modelID
	}
	selection, err := decision.ResolveModelWith(ctx, q, masterKey, override)
	if err != nil {
		if !errors.Is(err, decision.ErrNoModel) {
			log.Printf("assistant decision model unavailable: %v", err)
		}
		return setup
	}
	if modelID != "" && selection.Model.ID != modelID {
		// An explicit model that is not usable must not silently become a
		// different one during evaluation.
		return setup
	}
	client, err := decision.NewChatClient(selection)
	if err != nil {
		log.Printf("assistant decision client unavailable: %v", err)
		return setup
	}
	setup.Thresholds = override.ThresholdsFor(selection.Model.ID)
	setup.ModelID = selection.Model.ID
	setup.Decider = decision.Chain{
		Primary:  decision.LLM{Completer: decision.ClientCompleter{Client: client}, Model: selection.Model.ID},
		Fallback: setup.Rules,
		Timeout:  setup.Thresholds.Timeout(),
	}
	return setup
}

// Result is one turn's judgment after thresholds.
type Result struct {
	Intent string
	// ProviderIntent is what the provider chose before thresholds applied.
	ProviderIntent string
	Confidence     float64
	Clarify        bool
	RulesIntent    string
	LowConfidence  bool
	Thresholds     decision.Thresholds
	Response       decision.Response
	Err            error
}

// UsedFallback reports whether the intent came from the fallback provider.
func (r Result) UsedFallback() bool {
	for _, id := range r.Response.FallbackIDs {
		if id == "intent" {
			return true
		}
	}
	return false
}

// Confident reports whether the intent cleared the model's threshold.
func (r Result) Confident() bool {
	return r.Confidence >= r.Thresholds.Intent
}

// Metadata is the judgment as stored with the message (server-side only).
func (r Result) Metadata(sanitize func(string) string) map[string]any {
	out := map[string]any{
		"intent":        r.Intent,
		"confidence":    r.Confidence,
		"clarify":       r.Clarify,
		"rulesIntent":   r.RulesIntent,
		"lowConfidence": r.LowConfidence,
		"provider":      r.Response.Provider,
		"model":         r.Response.Model,
		"calibrated":    r.Response.Calibrated,
		"latencyMs":     r.Response.LatencyMs,
		"thresholds":    map[string]float64{"intent": r.Thresholds.Intent, "clarify": r.Thresholds.Clarify},
	}
	if len(r.Response.FallbackIDs) > 0 {
		out["fallbackIds"] = r.Response.FallbackIDs
	}
	if r.Err != nil {
		message := r.Err.Error()
		if sanitize != nil {
			message = sanitize(message)
		}
		out["error"] = message
	}
	return out
}

// Decide asks the chain, then applies the thresholds: an intent below the
// confidence floor defers to the rules, and clarification needs a clearly
// high "yes". The rules' own answer is always recorded for comparison.
func Decide(ctx context.Context, setup Setup, state string) Result {
	result := Result{Intent: IntentAnswer, Thresholds: setup.Thresholds}
	questions := Questions()
	response, err := setup.Decider.Decide(ctx, decision.Request{State: state, Questions: questions})
	result.Response, result.Err = response, err
	if answer, ok := response.Answers["intent"]; ok && answer.Choice != "" {
		result.Intent, result.Confidence = answer.Choice, answer.Confidence
		result.ProviderIntent = answer.Choice
	}
	if setup.Rules != nil {
		if rulesResponse, rulesErr := setup.Rules.Decide(ctx, decision.Request{State: state, Questions: questions}); rulesErr == nil {
			result.RulesIntent = rulesResponse.Answers["intent"].Choice
		}
	}
	if response.Provider != "rules" && !result.UsedFallback() && result.Confidence < setup.Thresholds.Intent && result.RulesIntent != "" {
		result.LowConfidence = true
		result.Intent = result.RulesIntent
	}
	if answer, ok := response.Answers["clarify"]; ok {
		result.Clarify = answer.Yes >= setup.Thresholds.Clarify
	}
	return result
}

// commerceSetPattern matches requests for e-commerce product images: a set,
// a main image, detail pages, or images for a named marketplace.
var commerceSetPattern = regexp.MustCompile(`(?i)(套图|主图|详情页|详情图|首图|白底图|卖点图|场景图|电商图|商品图|上架|listing|淘宝|天猫|京东|拼多多|抖音小店|亚马逊|amazon|temu|shopee|lazada|tiktok\s*shop)`)

// commerceMakePattern is the rules' narrower test: a making verb before an
// e-commerce image noun ("做一套天猫主图"), so questions that merely name a
// marketplace ("淘宝怎么开店") stay questions.
var commerceMakePattern = regexp.MustCompile(`(做|生成|出|设计|制作|画|来|弄)[^，。？?！!,]{0,14}(套图|主图|详情页|详情图|白底图|卖点图|场景图|电商图|商品图)`)

// commerceFollowUpPattern matches turns that act on a set already planned
// in the conversation ("开始生成吧", "第三张重做").
var commerceFollowUpPattern = regexp.MustCompile(`(生成|开始|确认|可以|好的|行|就这样|重做|重新|再来|换一|改一|进度|好了吗|第\s*[0-9一二三四五六七八九十]+\s*张)`)

// imageToolPattern matches requests to cut an attached image out.
var imageToolPattern = regexp.MustCompile(`(抠图|扣图|抠出|去背景|去掉背景|移除背景|删除背景|背景去掉|透明背景|透明底|免抠)`)

// ImageToolRequested reports whether a turn asks for background removal,
// which v2 runs itself on the attached images.
func ImageToolRequested(prompt string) bool { return imageToolPattern.MatchString(prompt) }

// CommerceSetRequested reports whether a create turn asks for e-commerce
// product images, which v2 produces itself through the commerce tools
// instead of handing the turn to the original engine.
func CommerceSetRequested(prompt string) bool { return commerceSetPattern.MatchString(prompt) }

// CommerceFollowUp reports whether a turn acts on an open set.
func CommerceFollowUp(prompt string) bool { return commerceFollowUpPattern.MatchString(prompt) }
