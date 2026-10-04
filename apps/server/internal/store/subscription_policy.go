package store

import (
	"encoding/json"
	"fmt"
	"strings"
)

type SubscriptionPolicy struct {
	ConcurrencyBonus   *int `json:"concurrencyBonus,omitempty"`
	CanvasProjectBonus int  `json:"canvasProjectBonus,omitempty"`
	// AssistantConversationBonus 是订阅在后台基础对话数之上追加的 AI 助手对话保留数。
	AssistantConversationBonus int      `json:"assistantConversationBonus,omitempty"`
	LockModelPrices            *bool    `json:"lockModelPrices,omitempty"`
	AllowTopupPriceLock        bool     `json:"allowTopupPriceLock"`
	TaskConcurrency            int      `json:"taskConcurrency,omitempty"`
	AssistantConcurrency       int      `json:"assistantConcurrency,omitempty"`
	RefundWindowHours          *int     `json:"refundWindowHours,omitempty"`
	Version                    int      `json:"version"`
	Series                     string   `json:"series"`
	Tier                       int      `json:"tier"`
	Channels                   []string `json:"channels"`
	FeatureKeys                []string `json:"featureKeys"`
	ModelIDs                   []string `json:"modelIds"`
	// APIModelIDs scopes the api channel to developer API catalog entries. It
	// only applies when ModelIDs restricts the plan; an unrestricted plan
	// covers every API model. It is derived from ModelIDs when the catalog is
	// introduced, so changing an API model's target keeps the entitlement.
	APIModelIDs []string `json:"apiModelIds,omitempty"`
}

func (p SubscriptionPolicy) ModelPricesLocked() bool {
	return p.LockModelPrices == nil || *p.LockModelPrices
}

func (p SubscriptionPolicy) ExtraConcurrency() int {
	if p.ConcurrencyBonus != nil {
		return *p.ConcurrencyBonus
	}
	return max(p.TaskConcurrency+p.AssistantConcurrency-DefaultUserConcurrency, 0)
}

func (p SubscriptionPolicy) MarshalJSON() ([]byte, error) {
	type policy SubscriptionPolicy
	normalized := policy(p)
	bonus := p.ExtraConcurrency()
	normalized.ConcurrencyBonus = &bonus
	return json.Marshal(normalized)
}

func (p SubscriptionPolicy) RefundGraceHours() int {
	if p.RefundWindowHours == nil {
		return 24
	}
	return *p.RefundWindowHours
}

func DefaultSubscriptionPolicy() SubscriptionPolicy {
	hours := 3
	return SubscriptionPolicy{Version: 2, Series: "general", Tier: 1, Channels: []string{"web", "api"}, FeatureKeys: []string{}, ModelIDs: []string{}, RefundWindowHours: &hours}
}

// Allows reports whether credits under this policy may pay for the use. On
// the api channel model is a developer API model id and is checked against
// APIModelIDs; elsewhere it is a site model id checked against ModelIDs.
func (p SubscriptionPolicy) Allows(feature, channel, model string) bool {
	if !Contains(p.Channels, channel) || (len(p.FeatureKeys) > 0 && !Contains(p.FeatureKeys, feature)) {
		return false
	}
	if len(p.ModelIDs) == 0 {
		return true
	}
	if channel == "api" {
		return Contains(p.APIModelIDs, model)
	}
	return Contains(p.ModelIDs, model)
}

func (p SubscriptionPolicy) Covers(old SubscriptionPolicy) bool {
	covers := func(next, previous []string, emptyAll bool) bool {
		if emptyAll && len(next) == 0 {
			return true
		}
		if emptyAll && len(previous) == 0 {
			return false
		}
		for _, v := range previous {
			if !Contains(next, v) {
				return false
			}
		}
		return true
	}
	apiCovered := len(p.ModelIDs) == 0 || (len(old.ModelIDs) > 0 && covers(p.APIModelIDs, old.APIModelIDs, false))
	return p.Series != "" && p.Series == old.Series && p.Tier > old.Tier && covers(p.Channels, old.Channels, false) && covers(p.FeatureKeys, old.FeatureKeys, true) && covers(p.ModelIDs, old.ModelIDs, true) && apiCovered
}

func (p *SubscriptionPolicy) Normalize() error {
	if p.ExtraConcurrency() < 0 || p.ExtraConcurrency() > 1000 {
		return fmt.Errorf("订阅额外并发须为0-1000的整数")
	}
	if p.CanvasProjectBonus < 0 || p.CanvasProjectBonus > MaxCanvasProjectBonus {
		return fmt.Errorf("订阅额外画布项目数须为0-%d的整数", MaxCanvasProjectBonus)
	}
	if p.AssistantConversationBonus < 0 || p.AssistantConversationBonus > MaxAssistantConversationBonus {
		return fmt.Errorf("订阅额外助手对话数须为0-%d的整数", MaxAssistantConversationBonus)
	}
	if p.TaskConcurrency < 0 || p.TaskConcurrency > 1000 || p.AssistantConcurrency < 0 || p.AssistantConcurrency > 100 {
		return fmt.Errorf("任务并发须为0-1000，助手并发须为0-100；0使用购买时的平台默认值")
	}
	bonus := p.ExtraConcurrency()
	p.ConcurrencyBonus = &bonus
	p.TaskConcurrency, p.AssistantConcurrency = 0, 0
	if p.Version < 0 || p.Version > 2 {
		return fmt.Errorf("无效的订阅策略版本")
	}
	if p.Version < 2 {
		if p.Series == "" {
			p.Series = "general"
		}
		if p.Tier == 0 {
			p.Tier = 1
		}
		if p.Channels == nil {
			p.Channels = []string{"web", "api"}
		}
	}
	p.Version = 2
	// Materialize new plan defaults; old subscription snapshots without this
	// field retain the legacy grace period in RefundGraceHours.
	if p.RefundWindowHours == nil {
		hours := 3
		p.RefundWindowHours = &hours
	}
	if p.RefundGraceHours() < 0 || p.RefundGraceHours() > 720 {
		return fmt.Errorf("未使用全退窗口须为0-720小时")
	}
	p.Series = strings.TrimSpace(p.Series)
	if p.Series == "" || len([]rune(p.Series)) > 64 || p.Tier < 1 || p.Tier > 100 {
		return fmt.Errorf("订阅系列须为1-64字符，级别须为1-100")
	}
	if len(p.Channels) == 0 || len(p.Channels) > 2 {
		return fmt.Errorf("请选择网站或API使用渠道")
	}
	for _, v := range p.Channels {
		if v != "web" && v != "api" {
			return fmt.Errorf("无效的订阅使用渠道")
		}
	}
	for _, list := range [][]string{p.FeatureKeys, p.ModelIDs, p.APIModelIDs} {
		if len(list) > 100 {
			return fmt.Errorf("订阅范围最多100项")
		}
		for _, v := range list {
			if strings.TrimSpace(v) == "" || len(v) > 128 {
				return fmt.Errorf("订阅范围包含无效标识")
			}
		}
	}
	if p.FeatureKeys == nil {
		p.FeatureKeys = []string{}
	}
	if p.ModelIDs == nil {
		p.ModelIDs = []string{}
	}
	return nil
}
