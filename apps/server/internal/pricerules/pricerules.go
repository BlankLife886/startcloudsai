// Package pricerules 是站内模型的动态调价：按北京时间的工作日时段、周末、指定日期
// 规则临时上调或下调模型价格，另有对订阅用户始终生效的额外优惠。
//
// 调价只作用于站内用户（生图任务、AI 助手、电商套图等）；开发者 API /v1 按自己的
// 目录价计费，不调用本包。价格以提交任务那一刻的北京时间为准。
//
// 做法是把规则「套」进一份刚读出来的模型配置：参与调价的模型，其标准价、折扣价、
// 分档价格表、页面单价、推理档位价都按规则改写，下游报价和扣费代码不用改。后台编辑
// 读写的仍是原始配置。
package pricerules

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const SettingKey = "model_price_schedule"

const (
	KindWeekday = "weekday" // 周一到周五的每日时段
	KindWeekend = "weekend" // 周六、周日的每日时段
	KindDate    = "date"    // 指定起止日期时间

	ModePercent = "percent"
	ModePoints  = "points"

	MinPercent = -95
	MaxPercent = 500
	MaxPoints  = 1_000_000
	MaxRules   = 50
)

// Beijing 是规则使用的时区。用固定 UTC+8，不依赖服务器的时区数据库。
var Beijing = time.FixedZone("Asia/Shanghai", 8*3600)

// Adjustment 是一次调价：percent 按百分比（-20 为降 20%），points 按固定积分（-5 为降 5 积分）。
type Adjustment struct {
	Mode  string `json:"mode"`
	Value int64  `json:"value"`
}

// Rule 是一条调价规则。只有列在 Models 里的模型参与，每个模型有自己的调价幅度。
type Rule struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Enabled bool   `json:"enabled"`
	// StartTime / EndTime 是工作日、周末规则每天生效的时段（HH:MM，结束可写 24:00），左闭右开。
	StartTime string `json:"startTime,omitempty"`
	EndTime   string `json:"endTime,omitempty"`
	// StartAt / EndAt 是指定日期规则的起止（YYYY-MM-DDTHH:MM，北京时间），左闭右开。
	StartAt string                `json:"startAt,omitempty"`
	EndAt   string                `json:"endAt,omitempty"`
	Models  map[string]Adjustment `json:"models"`
}

// SubscriberDiscount 是订阅用户的额外优惠，始终生效，不看时段。Value 为正数，表示再减
// 多少积分或百分之多少；只对列在 Models 里的模型生效。
type SubscriberDiscount struct {
	Enabled bool                  `json:"enabled"`
	Models  map[string]Adjustment `json:"models"`
}

type Schedule struct {
	Enabled    bool               `json:"enabled"`
	Rules      []Rule             `json:"rules"`
	Subscriber SubscriberDiscount `json:"subscriber"`
}

// Active 说明某个模型此刻按哪条规则调价。
type Active struct {
	RuleID     string     `json:"ruleId"`
	RuleName   string     `json:"ruleName"`
	Kind       string     `json:"kind"`
	Adjustment Adjustment `json:"adjustment"`
	EndsAt     time.Time  `json:"endsAt"`
}

func Empty() Schedule {
	return Schedule{Rules: []Rule{}, Subscriber: SubscriberDiscount{Models: map[string]Adjustment{}}}
}

func Load(ctx context.Context, q store.Q) (Schedule, error) {
	raw, err := store.GetAppSetting(ctx, q, SettingKey)
	if err != nil {
		return Schedule{}, err
	}
	schedule := Empty()
	if len(raw) == 0 {
		return schedule, nil
	}
	if err := json.Unmarshal(raw, &schedule); err != nil {
		return Schedule{}, err
	}
	normalize(&schedule)
	return schedule, nil
}

func Save(ctx context.Context, q store.Q, schedule Schedule) error {
	normalize(&schedule)
	raw, err := json.Marshal(schedule)
	if err != nil {
		return err
	}
	return store.SetAppSetting(ctx, q, SettingKey, raw, time.Now().UTC())
}

func normalize(schedule *Schedule) {
	if schedule.Rules == nil {
		schedule.Rules = []Rule{}
	}
	for index := range schedule.Rules {
		rule := &schedule.Rules[index]
		rule.ID = strings.TrimSpace(rule.ID)
		rule.Name = strings.TrimSpace(rule.Name)
		rule.Kind = strings.TrimSpace(rule.Kind)
		if rule.Kind == KindDate {
			rule.StartTime, rule.EndTime = "", ""
		} else {
			rule.StartAt, rule.EndAt = "", ""
		}
		if rule.Models == nil {
			rule.Models = map[string]Adjustment{}
		}
	}
	if schedule.Subscriber.Models == nil {
		schedule.Subscriber.Models = map[string]Adjustment{}
	}
}

var (
	clockPattern    = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$|^24:00$`)
	dateTimePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`)
)

// minutesOf 把 HH:MM 转成当天的分钟数，24:00 为 1440。
func minutesOf(clock string) int {
	var hour, minute int
	_, _ = fmt.Sscanf(clock, "%d:%d", &hour, &minute)
	return hour*60 + minute
}

func parseBeijing(value string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02T15:04", value, Beijing)
}

func validateAdjustment(subject string, adjustment Adjustment, subscriber bool) error {
	switch adjustment.Mode {
	case ModePercent:
		if subscriber {
			if adjustment.Value < 0 || adjustment.Value > 100 {
				return fmt.Errorf("%s：订阅优惠百分比须在 0-100 之间", subject)
			}
		} else if adjustment.Value < MinPercent || adjustment.Value > MaxPercent {
			return fmt.Errorf("%s：调价百分比须在 %d%% 到 +%d%% 之间", subject, MinPercent, MaxPercent)
		}
	case ModePoints:
		if subscriber && adjustment.Value < 0 {
			return fmt.Errorf("%s：订阅优惠积分不能为负数", subject)
		}
		if adjustment.Value < -MaxPoints || adjustment.Value > MaxPoints {
			return fmt.Errorf("%s：调价积分超出范围", subject)
		}
	default:
		return fmt.Errorf("%s：调价方式只能是百分比或积分", subject)
	}
	return nil
}

// Validate 检查规则本身，以及引用的模型都存在且面向站内用户。
func Validate(schedule Schedule, cfg modelconfig.Config) error {
	normalize(&schedule)
	if len(schedule.Rules) > MaxRules {
		return apperr.E("validation_error", fmt.Sprintf("调价规则最多 %d 条", MaxRules), 422)
	}
	known := make(map[string]string, len(cfg.Models))
	for _, model := range cfg.Models {
		known[model.ID] = model.Name
	}
	seen := map[string]bool{}
	for index, rule := range schedule.Rules {
		subject := rule.Name
		if subject == "" {
			subject = fmt.Sprintf("第 %d 条规则", index+1)
		}
		fail := func(message string) error { return apperr.E("validation_error", subject+"："+message, 422) }
		if rule.ID == "" || seen[rule.ID] {
			return fail("规则编号为空或重复")
		}
		seen[rule.ID] = true
		if rule.Name == "" {
			return fail("请填写规则名称")
		}
		if len([]rune(rule.Name)) > 40 {
			return fail("规则名称最多 40 个字")
		}
		switch rule.Kind {
		case KindWeekday, KindWeekend:
			if !clockPattern.MatchString(rule.StartTime) || !clockPattern.MatchString(rule.EndTime) {
				return fail("请填写 HH:MM 格式的开始和结束时间")
			}
			if minutesOf(rule.StartTime) >= minutesOf(rule.EndTime) {
				return fail("结束时间须晚于开始时间（不跨天，全天可填 00:00–24:00）")
			}
		case KindDate:
			if !dateTimePattern.MatchString(rule.StartAt) || !dateTimePattern.MatchString(rule.EndAt) {
				return fail("请填写开始和结束的日期时间")
			}
			start, startErr := parseBeijing(rule.StartAt)
			end, endErr := parseBeijing(rule.EndAt)
			if startErr != nil || endErr != nil {
				return fail("日期时间无效")
			}
			if !end.After(start) {
				return fail("结束时间须晚于开始时间")
			}
		default:
			return fail("规则类型只能是工作日、周末或指定日期")
		}
		for modelID, adjustment := range rule.Models {
			name, ok := known[modelID]
			if !ok {
				return fail(fmt.Sprintf("模型 %s 不存在", modelID))
			}
			if err := validateAdjustment(name, adjustment, false); err != nil {
				return fail(err.Error())
			}
		}
	}
	for modelID, adjustment := range schedule.Subscriber.Models {
		name, ok := known[modelID]
		if !ok {
			return apperr.E("validation_error", fmt.Sprintf("订阅优惠：模型 %s 不存在", modelID), 422)
		}
		if err := validateAdjustment("订阅优惠 · "+name, adjustment, true); err != nil {
			return apperr.E("validation_error", err.Error(), 422)
		}
	}
	return nil
}

// window 返回规则在 at 所在那天（北京时间）的生效区间；不生效的日子返回 ok=false。
// 指定日期规则直接返回它的起止。
func (rule Rule) window(at time.Time) (start, end time.Time, ok bool) {
	local := at.In(Beijing)
	switch rule.Kind {
	case KindDate:
		start, startErr := parseBeijing(rule.StartAt)
		end, endErr := parseBeijing(rule.EndAt)
		return start, end, startErr == nil && endErr == nil && end.After(start)
	case KindWeekday, KindWeekend:
		weekend := local.Weekday() == time.Saturday || local.Weekday() == time.Sunday
		if weekend != (rule.Kind == KindWeekend) {
			return time.Time{}, time.Time{}, false
		}
		midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, Beijing)
		start = midnight.Add(time.Duration(minutesOf(rule.StartTime)) * time.Minute)
		end = midnight.Add(time.Duration(minutesOf(rule.EndTime)) * time.Minute)
		return start, end, end.After(start)
	}
	return time.Time{}, time.Time{}, false
}

// activeWindow 返回规则在 at 时刻是否生效以及本次生效到何时结束。
func (rule Rule) activeWindow(at time.Time) (time.Time, bool) {
	if !rule.Enabled {
		return time.Time{}, false
	}
	start, end, ok := rule.window(at)
	if !ok || at.Before(start) || !at.Before(end) {
		return time.Time{}, false
	}
	return end, true
}

func priority(kind string) int {
	switch kind {
	case KindDate:
		return 3
	case KindWeekend:
		return 2
	case KindWeekday:
		return 1
	}
	return 0
}

// ActiveFor 返回每个模型此刻生效的规则：在包含该模型、此刻生效的规则里，取优先级
// 最高的一条（指定日期 > 周末 > 工作日；同类型按列表顺序取第一条）。没有命中的模型不在结果里。
// 一条规则没列某个模型时，该模型仍可命中更低优先级的规则；要在某段时间让模型保持原价，
// 把它加进高优先级规则并把幅度设为 0。
func ActiveFor(schedule Schedule, at time.Time) map[string]Active {
	result := map[string]Active{}
	if !schedule.Enabled {
		return result
	}
	best := map[string]int{}
	for _, rule := range schedule.Rules {
		end, ok := rule.activeWindow(at)
		if !ok {
			continue
		}
		rank := priority(rule.Kind)
		for modelID, adjustment := range rule.Models {
			if rank <= best[modelID] {
				continue
			}
			best[modelID] = rank
			result[modelID] = Active{RuleID: rule.ID, RuleName: rule.Name, Kind: rule.Kind, Adjustment: adjustment, EndsAt: end}
		}
	}
	return result
}

// NextChange 返回 at 之后最近一次有规则开始或结束的时刻，用户端到点刷新价格；
// 7 天内没有变化时返回零值。
func NextChange(schedule Schedule, at time.Time) time.Time {
	if !schedule.Enabled {
		return time.Time{}
	}
	var next time.Time
	consider := func(candidate time.Time) {
		if candidate.After(at) && (next.IsZero() || candidate.Before(next)) {
			next = candidate
		}
	}
	for _, rule := range schedule.Rules {
		if !rule.Enabled || len(rule.Models) == 0 {
			continue
		}
		if rule.Kind == KindDate {
			if start, end, ok := rule.window(at); ok {
				consider(start)
				consider(end)
			}
			continue
		}
		for day := 0; day <= 7; day++ {
			if start, end, ok := rule.window(at.AddDate(0, 0, day)); ok {
				consider(start)
				consider(end)
			}
		}
	}
	return next
}

// Apply 返回一个按单价调价后的价格，并守住模型的底线：不允许零积分时至少 1，
// 不允许低于成本时不低于上游成本。原价已经低于底线（管理员允许过）时不再往下调。
func Apply(price int64, adjustment Adjustment, model modelconfig.Model, upstreamCost int64) int64 {
	adjusted := price
	switch adjustment.Mode {
	case ModePercent:
		adjusted = int64(math.Round(float64(price) * float64(100+adjustment.Value) / 100))
	case ModePoints:
		adjusted = price + adjustment.Value
	}
	return floor(adjusted, price, model, upstreamCost)
}

func floor(adjusted, original int64, model modelconfig.Model, upstreamCost int64) int64 {
	if adjusted >= original {
		return adjusted
	}
	minimum := int64(0)
	if !model.AllowZeroPrice {
		minimum = 1
	}
	if !model.AllowLossLeader && upstreamCost > minimum {
		minimum = upstreamCost
	}
	if minimum > original {
		minimum = original
	}
	return max(adjusted, minimum)
}

// SubscriberPrice 返回订阅用户在 price 上再减去订阅优惠后的价格；模型没设订阅优惠时原样返回。
func SubscriberPrice(schedule Schedule, model modelconfig.Model, price, upstreamCost int64) int64 {
	if !schedule.Subscriber.Enabled {
		return price
	}
	discount, ok := schedule.Subscriber.Models[model.ID]
	if !ok || discount.Value == 0 {
		return price
	}
	return Apply(price, Adjustment{Mode: discount.Mode, Value: -discount.Value}, model, upstreamCost)
}

// adjustPair 改写一组「标准价 + 可选折扣价」。用户实付价按规则调整：降价时保留标准价、
// 把实付价写进折扣价（用户端显示划线原价）；涨价时标准价改为新价并去掉折扣，
// 免得出现「现价 18、划线原价 20、标签却是涨价」这种显示。
func adjustPair(standard int64, discount *int64, adjustment Adjustment, model modelconfig.Model, upstreamCost int64) (int64, *int64) {
	effective := standard
	if discount != nil {
		effective = *discount
	}
	adjusted := Apply(effective, adjustment, model, upstreamCost)
	if adjusted == effective {
		return standard, discount
	}
	if adjusted > effective {
		return adjusted, nil
	}
	return standard, &adjusted
}

// ApplyToConfig 把此刻生效的规则套进 cfg（就地改写，cfg 须是刚从数据库读出的副本），
// 返回价格确实被改动的模型命中的规则。
func ApplyToConfig(cfg *modelconfig.Config, schedule Schedule, at time.Time) map[string]Active {
	active := ActiveFor(schedule, at)
	if len(active) == 0 {
		return active
	}
	models := make(map[string]modelconfig.Model, len(active))
	// changed 记下价格真的变了的模型：被底线截住、一分没变的不算命中，用户端不显示调价标签。
	changed := map[string]bool{}
	pair := func(id string, standard int64, discount *int64, adjustment Adjustment, model modelconfig.Model, cost int64) (int64, *int64) {
		nextStandard, nextDiscount := adjustPair(standard, discount, adjustment, model, cost)
		if nextStandard != standard || (nextDiscount == nil) != (discount == nil) || (nextDiscount != nil && *nextDiscount != *discount) {
			changed[id] = true
		}
		return nextStandard, nextDiscount
	}
	for index := range cfg.Models {
		model := &cfg.Models[index]
		hit, ok := active[model.ID]
		if !ok {
			continue
		}
		adjustment := hit.Adjustment
		original := *model
		model.PriceCents, model.DiscountPriceCents = pair(model.ID, original.PriceCents, original.DiscountPriceCents, adjustment, original, original.UpstreamCostCents)
		if pricing := original.ImageUpscalePricing; pricing != nil {
			next := *pricing
			next.HighPriceCents, next.HighDiscountPriceCents = pair(model.ID, pricing.HighPriceCents, pricing.HighDiscountPriceCents, adjustment, original, pricing.HighUpstreamCostCents)
			model.ImageUpscalePricing = &next
		}
		if len(original.ImagePricing) > 0 {
			matrix := make(map[string]map[string]modelconfig.ImageTierPrice, len(original.ImagePricing))
			for resolution, row := range original.ImagePricing {
				cells := make(map[string]modelconfig.ImageTierPrice, len(row))
				for quality, cell := range row {
					cell.PriceCents, cell.DiscountPriceCents = pair(model.ID, cell.PriceCents, cell.DiscountPriceCents, adjustment, original, cell.UpstreamCostCents)
					cells[quality] = cell
				}
				matrix[resolution] = cells
			}
			model.ImagePricing = matrix
		}
		if pricing := original.ReasoningPricing; pricing != nil && len(pricing.Efforts) > 0 {
			next := modelconfig.ReasoningPricing{DefaultEffort: pricing.DefaultEffort, Efforts: make(map[string]modelconfig.ReasoningEffortPricing, len(pricing.Efforts))}
			for effort, price := range pricing.Efforts {
				price.AssistantPriceCents, price.AssistantDiscountPriceCents = pair(model.ID, price.AssistantPriceCents, price.AssistantDiscountPriceCents, adjustment, original, original.UpstreamCostCents)
				price.CanvasAgentPriceCents, price.CanvasAgentDiscountPriceCents = pair(model.ID, price.CanvasAgentPriceCents, price.CanvasAgentDiscountPriceCents, adjustment, original, original.UpstreamCostCents)
				next.Efforts[effort] = price
			}
			model.ReasoningPricing = &next
		}
		models[model.ID] = original
	}
	if len(models) > 0 {
		workspaces := make(map[string]modelconfig.WorkspaceBinding, len(cfg.Workspaces))
		for name, binding := range cfg.Workspaces {
			if len(binding.ModelPricing) > 0 {
				pricing := make(map[string]modelconfig.WorkspaceModelPricing, len(binding.ModelPricing))
				for modelID, price := range binding.ModelPricing {
					if original, ok := models[modelID]; ok {
						price.PriceCents, price.DiscountPriceCents = pair(modelID, price.PriceCents, price.DiscountPriceCents, active[modelID].Adjustment, original, original.UpstreamCostCents)
					}
					pricing[modelID] = price
				}
				binding.ModelPricing = pricing
			}
			workspaces[name] = binding
		}
		cfg.Workspaces = workspaces
	}
	for modelID := range active {
		if !changed[modelID] {
			delete(active, modelID)
		}
	}
	return active
}

// SitePricing 是站内用户看到和支付的模型配置：原始配置套上此刻生效的调价规则。
type SitePricing struct {
	Config     modelconfig.Config
	Schedule   Schedule
	Active     map[string]Active
	NextChange time.Time
}

// LoadSite 读取模型配置和调价规则，返回 at 时刻站内生效的价格。开发者 API 不要用它。
func LoadSite(ctx context.Context, q store.Q, at time.Time) (SitePricing, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return SitePricing{}, err
	}
	schedule, err := Load(ctx, q)
	if err != nil {
		return SitePricing{}, err
	}
	active := ApplyToConfig(&cfg, schedule, at)
	return SitePricing{Config: cfg, Schedule: schedule, Active: active, NextChange: NextChange(schedule, at)}, nil
}

// LoadSiteConfig 是只要配置时的简写。
func LoadSiteConfig(ctx context.Context, q store.Q, at time.Time) (modelconfig.Config, error) {
	site, err := LoadSite(ctx, q, at)
	return site.Config, err
}
