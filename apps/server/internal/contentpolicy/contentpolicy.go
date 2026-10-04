// Package contentpolicy 识别上游因内容违规驳回的生图请求，并决定这次是否扣费。
//
// 上游被内容安全拦截时不会给出统一的错误码，只会返回一段说明文字，并且和其他
// 上游故障共用 upstream_error / upstream_rejected。这里按后台配置的关键词判断返回
// 文字；命中的失败记一条违规记录。上游已经处理过这次请求，所以默认按预留积分结算；
// 每个用户每天前若干次违规（后台可配）照常退回，避免误判伤到正常用户。
package contentpolicy

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	// Code 是内容违规且已扣费的错误码。
	Code = "content_policy"
	// WaivedCode 是内容违规但按规则退回积分的错误码（每日免扣次数内、规则关闭或本次免费）。
	WaivedCode = "content_policy_waived"

	// SettingKey 是后台配置在 app_settings 里的键。
	SettingKey = "content_policy_config"

	maxDailyFreeCount = 1000
	maxPhrases        = 200
	maxPhraseRunes    = 100
	maxPromptRunes    = 4000
	maxMessageRunes   = 2000
)

// 免扣原因，记录在违规记录上。
const (
	WaiveDailyFree = "daily_free"
	WaiveDisabled  = "disabled"
	WaiveNoCost    = "no_cost"
)

// 记录来源，与 content_policy_violations.source_type 一致。
const (
	SourceTask         = "task"
	SourceAssistantRun = "assistant_run"
	SourceDeveloperAPI = "developer_api"
)

// upstreamFailureCodes 是可能由内容违规造成、需要进一步看文字的上游失败码。
// 取消、超时、配置错误等其他失败码永远不按违规处理。
var upstreamFailureCodes = map[string]bool{
	"upstream_error":    true,
	"upstream_rejected": true,
	Code:                true,
	WaivedCode:          true,
}

// Config 是后台可调的识别规则与扣费规则。
type Config struct {
	// Enabled 关闭时仍识别并记录违规，但一律退回积分。
	Enabled bool `json:"enabled"`
	// DailyFreeCount 是每个用户每天（北京时间）照常退回的违规次数，超出后才扣费。
	DailyFreeCount int `json:"dailyFreeCount"`
	// PolicyPhrases 是上游安全过滤的固定说法，命中任意一个即为违规。
	PolicyPhrases []string `json:"policyPhrases"`
	// RefusalPhrases 与 SensitiveWords 同时命中才算违规：模型也会用“无法帮助”拒绝正常请求。
	RefusalPhrases []string `json:"refusalPhrases"`
	SensitiveWords []string `json:"sensitiveWords"`
}

// DefaultConfig 是没有后台配置时使用的规则，来自线上真实出现过的上游返回。
func DefaultConfig() Config {
	return Config{
		Enabled:        true,
		DailyFreeCount: 0,
		PolicyPhrases: []string{
			"防护限制", "内容政策", "使用政策", "内容审核拒绝",
			"content policy", "content_policy", "safety system", "rejected by the safety", "moderation_blocked",
		},
		RefusalPhrases: []string{"不能帮助", "无法帮助", "不能协助", "无法协助", "不能为你生成", "无法为你生成"},
		SensitiveWords: []string{
			"裸露", "裸体", "色情", "情色", "性化", "性暗示", "露骨", "私密部位", "隐私部位", "脱衣", "衣物", "性行为",
		},
	}
}

// Load 读取后台配置；没有配置时返回 DefaultConfig。
func Load(ctx context.Context, q store.Q) (Config, error) {
	raw, err := store.GetAppSetting(ctx, q, SettingKey)
	if err != nil {
		return Config{}, err
	}
	if raw == nil {
		return DefaultConfig(), nil
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode %s: %w", SettingKey, err)
	}
	return cfg.normalized(), nil
}

// Save 校验并保存后台配置，返回实际保存的内容。
func Save(ctx context.Context, q store.Q, cfg Config) (Config, error) {
	cfg = cfg.normalized()
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return Config{}, err
	}
	if err := store.SetAppSetting(ctx, q, SettingKey, raw, time.Now().UTC()); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate 检查后台提交的配置是否可用。
func (c Config) Validate() error {
	if c.DailyFreeCount < 0 || c.DailyFreeCount > maxDailyFreeCount {
		return apperr.E("validation_error", fmt.Sprintf("每日免扣次数须在 0-%d 之间", maxDailyFreeCount), 422)
	}
	for _, list := range []struct {
		name  string
		items []string
	}{{"违规说法", c.PolicyPhrases}, {"拒绝说法", c.RefusalPhrases}, {"敏感词", c.SensitiveWords}} {
		if len(list.items) > maxPhrases {
			return apperr.E("validation_error", fmt.Sprintf("%s最多 %d 个", list.name, maxPhrases), 422)
		}
		for _, item := range list.items {
			if utf8.RuneCountInString(item) > maxPhraseRunes {
				return apperr.E("validation_error", fmt.Sprintf("%s“%s”超过 %d 个字", list.name, item, maxPhraseRunes), 422)
			}
		}
	}
	if len(c.PolicyPhrases) == 0 && (len(c.RefusalPhrases) == 0 || len(c.SensitiveWords) == 0) {
		return apperr.E("validation_error", "至少要有一个违规说法，或同时填写拒绝说法和敏感词，否则什么都识别不出来", 422)
	}
	return nil
}

func (c Config) normalized() Config {
	c.PolicyPhrases = cleanPhrases(c.PolicyPhrases)
	c.RefusalPhrases = cleanPhrases(c.RefusalPhrases)
	c.SensitiveWords = cleanPhrases(c.SensitiveWords)
	return c
}

// cleanPhrases 去掉首尾空白、空项和重复项（不区分大小写），保留原有顺序。
func cleanPhrases(items []string) []string {
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		key := strings.ToLower(item)
		if item == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

// Match 判断上游返回的说明文字是否表示内容违规，并返回命中的规则。
func (c Config) Match(message string) (string, bool) {
	text := strings.ToLower(strings.TrimSpace(message))
	if text == "" {
		return "", false
	}
	for _, phrase := range c.PolicyPhrases {
		if strings.Contains(text, strings.ToLower(phrase)) {
			return phrase, true
		}
	}
	refusal := ""
	for _, phrase := range c.RefusalPhrases {
		if strings.Contains(text, strings.ToLower(phrase)) {
			refusal = phrase
			break
		}
	}
	if refusal == "" {
		return "", false
	}
	for _, word := range c.SensitiveWords {
		if strings.Contains(text, strings.ToLower(word)) {
			return refusal + " + " + word, true
		}
	}
	return "", false
}

// IsViolationCode 判断错误码是否表示内容违规（无论是否扣费）。
func IsViolationCode(code string) bool {
	return code == Code || code == WaivedCode
}

// Event 是一次失败的生图请求。
type Event struct {
	UserID      uuid.UUID
	SourceType  string
	SourceID    string
	Feature     string
	ModelID     string
	Prompt      string
	ErrorCode   string
	Message     string
	AmountCents int64
}

// Decision 是对一次失败的判定结果。
type Decision struct {
	// Code 是失败应记录的错误码：不是违规时为原错误码。
	Code      string
	Violation bool
	// Charge 为 true 时按 AmountCents 结算，否则照常退回。
	Charge bool
	Record *store.ContentPolicyViolation
}

// Decide 判断一次失败是否为内容违规；是违规时在 q 所在事务里记一条违规记录，并决定是否扣费。
// 调用方必须在同一事务里按 Decision.Charge 结算或退回积分。
func Decide(ctx context.Context, q store.Q, e Event, now time.Time) (Decision, error) {
	if !upstreamFailureCodes[strings.TrimSpace(e.ErrorCode)] {
		return Decision{Code: e.ErrorCode}, nil
	}
	cfg, err := Load(ctx, q)
	if err != nil {
		return Decision{}, err
	}
	rule, ok := cfg.Match(e.Message)
	if !ok {
		return Decision{Code: e.ErrorCode}, nil
	}
	if err := store.LockUserContentPolicy(ctx, q, e.UserID); err != nil {
		return Decision{}, err
	}
	used, err := store.CountUserContentPolicyViolationsSince(ctx, q, e.UserID, dayStart(now))
	if err != nil {
		return Decision{}, err
	}
	record := store.ContentPolicyViolation{
		UserID: e.UserID, SourceType: e.SourceType, SourceID: e.SourceID,
		Feature: e.Feature, ModelID: e.ModelID, MatchedRule: rule,
		Prompt: truncateRunes(e.Prompt, maxPromptRunes), UpstreamMessage: truncateRunes(e.Message, maxMessageRunes),
		AmountCents: max(e.AmountCents, 0), CreatedAt: now,
	}
	switch {
	case !cfg.Enabled:
		record.Status, record.WaiveReason = store.ContentPolicyWaived, WaiveDisabled
	case e.AmountCents <= 0:
		record.Status, record.WaiveReason = store.ContentPolicyWaived, WaiveNoCost
	case used < cfg.DailyFreeCount:
		record.Status, record.WaiveReason = store.ContentPolicyWaived, WaiveDailyFree
	default:
		record.Status, record.ChargedCents = store.ContentPolicyCharged, e.AmountCents
	}
	saved, _, err := store.InsertContentPolicyViolation(ctx, q, record)
	if err != nil {
		return Decision{}, err
	}
	// 同一来源已经判定过（例如重放的失败），沿用当时的结论，避免一次失败被判两次。
	charge := saved.Status == store.ContentPolicyCharged
	code := WaivedCode
	if charge {
		code = Code
	}
	return Decision{Code: code, Violation: true, Charge: charge, Record: saved}, nil
}

// TestResult 是后台“试一试”的识别结果。
type TestResult struct {
	Violation bool   `json:"violation"`
	Rule      string `json:"rule"`
}

// Test 用给定配置识别一段文字，不写任何记录。
func Test(cfg Config, message string) TestResult {
	rule, ok := cfg.normalized().Match(message)
	return TestResult{Violation: ok, Rule: rule}
}

var shanghai = time.FixedZone("Asia/Shanghai", 8*3600)

// dayStart 返回 now 所在北京时间自然日的零点，与签到、失败补偿的“每天”一致。
func dayStart(now time.Time) time.Time {
	local := now.In(shanghai)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, shanghai).UTC()
}

func truncateRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}
