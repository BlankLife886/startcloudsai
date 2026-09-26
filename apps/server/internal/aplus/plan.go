package aplus

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type Marketplace struct {
	ID           string
	Label        string
	Site         string
	Region       string
	Language     string
	LanguageCode string
	Units        string
	ImageStyle   string
}

type ModuleType struct {
	ID          string
	AmazonName  string
	PEPCF       string
	Width       int
	Height      int
	Premium     bool
	HeadlineMax int
	BodyMax     int
}

type Category struct {
	ID          string
	Label       string
	Archetype   string
	PainPoints  []string
	CompareAxes []string
}

type Module struct {
	ID          string `json:"id"`
	TypeID      string `json:"typeId"`
	AmazonName  string `json:"amazonName"`
	PEPCF       string `json:"pepcf"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	OutputSize  string `json:"outputSize"`
	AspectRatio string `json:"aspectRatio"`
	Headline    string `json:"headline"`
	Body        string `json:"body"`
	ImagePrompt string `json:"imagePrompt"`
}

type Plan struct {
	ASIN           string         `json:"asin"`
	CompetitorASIN string         `json:"competitorAsin"`
	CategoryID     string         `json:"categoryId"`
	CategoryLabel  string         `json:"categoryLabel"`
	MarketplaceID  string         `json:"marketplaceId"`
	Language       string         `json:"language"`
	LanguageCode   string         `json:"languageCode"`
	Tier           string         `json:"tier"`
	Disclosure     bool           `json:"disclosure"`
	PainPoints     []string       `json:"painPoints"`
	PEPCF          []string       `json:"pepcf"`
	Modules        []Module       `json:"modules"`
	Compliance     map[string]any `json:"compliance"`
}

var marketplaces = []Marketplace{
	{ID: "US", Label: "Amazon US", Site: "amazon.com", Region: "international", Language: "英文", LanguageCode: "en-US", Units: "W/lm/K, E26", ImageStyle: "lifestyle interior, product hero, no watermark"},
	{ID: "UK", Label: "Amazon UK", Site: "amazon.co.uk", Region: "international", Language: "英文", LanguageCode: "en-GB", Units: "W/lm/K, BS 1363", ImageStyle: "British lifestyle, product hero, no watermark"},
	{ID: "DE", Label: "Amazon DE", Site: "amazon.de", Region: "international", Language: "德文", LanguageCode: "de-DE", Units: "W/lm/K, E27, CE", ImageStyle: "European lifestyle, product hero, no watermark"},
	{ID: "JP", Label: "Amazon JP", Site: "amazon.co.jp", Region: "international", Language: "日文", LanguageCode: "ja-JP", Units: "100V, PSE, metric", ImageStyle: "tidy Japanese interior, no watermark"},
	{ID: "CN", Label: "国内站", Site: "amazon.cn", Region: "domestic", Language: "简体中文", LanguageCode: "zh-CN", Units: "流明/瓦数/色温, E27, GB", ImageStyle: "studio product shot with dimension callouts, no watermark"},
}

var moduleTypes = []ModuleType{
	{ID: "std-header", AmazonName: "Standard Header Image", PEPCF: "Problem", Width: 970, Height: 600, HeadlineMax: 160, BodyMax: 1000},
	{ID: "std-overlay-light", AmazonName: "Standard Image & Light Text Overlay", PEPCF: "Explain", Width: 970, Height: 300, HeadlineMax: 150, BodyMax: 500},
	{ID: "std-four-image", AmazonName: "Standard Four Image & Text", PEPCF: "Explain", Width: 970, Height: 600, HeadlineMax: 80, BodyMax: 400},
	{ID: "std-compare", AmazonName: "Standard Comparison Chart", PEPCF: "Compare", Width: 970, Height: 600, HeadlineMax: 120, BodyMax: 800},
	{ID: "std-specs", AmazonName: "Standard Technical Specifications", PEPCF: "Proof", Width: 970, Height: 600, HeadlineMax: 80, BodyMax: 900},
	{ID: "std-highlights", AmazonName: "Standard Single Image Highlights", PEPCF: "Proof", Width: 970, Height: 600, HeadlineMax: 150, BodyMax: 600},
	{ID: "std-overlay-dark", AmazonName: "Standard Image & Dark Text Overlay", PEPCF: "Finish", Width: 970, Height: 300, HeadlineMax: 150, BodyMax: 500},
	{ID: "premium-banner", AmazonName: "Premium Banner", PEPCF: "Problem", Width: 1464, Height: 600, Premium: true, HeadlineMax: 160, BodyMax: 400},
	{ID: "premium-hotspots", AmazonName: "Premium Hotspots", PEPCF: "Proof", Width: 1464, Height: 600, Premium: true, HeadlineMax: 120, BodyMax: 400},
	{ID: "premium-three", AmazonName: "Premium Three Images & Text", PEPCF: "Explain", Width: 1464, Height: 600, Premium: true, HeadlineMax: 80, BodyMax: 500},
}

var archetypes = map[string]map[string][]string{
	"spec": {
		"basic":   {"std-header", "std-overlay-light", "std-compare", "std-specs", "std-overlay-dark"},
		"premium": {"premium-banner", "std-overlay-light", "std-compare", "std-specs", "premium-hotspots", "std-highlights", "std-overlay-dark"},
	},
	"lifestyle": {
		"basic":   {"std-header", "std-four-image", "std-overlay-light", "std-highlights", "std-overlay-dark"},
		"premium": {"premium-banner", "std-four-image", "premium-three", "std-compare", "premium-hotspots", "std-highlights", "std-overlay-dark"},
	},
	"beauty": {
		"basic":   {"std-header", "std-overlay-light", "std-highlights", "std-four-image", "std-overlay-dark"},
		"premium": {"premium-banner", "std-overlay-light", "std-four-image", "std-compare", "premium-hotspots", "std-highlights", "std-overlay-dark"},
	},
}

var categories = []Category{
	{ID: "led-bulb", Label: "灯泡 / 照明", Archetype: "spec", PainPoints: []string{"够亮吗", "刺眼吗", "接口兼容", "寿命", "费电"}, CompareAxes: []string{"功率", "流明", "色温", "寿命", "接口"}},
	{ID: "electronics-3c", Label: "3C 数码", Archetype: "spec", PainPoints: []string{"兼容性", "续航", "发热", "接口"}, CompareAxes: []string{"功率", "接口", "协议"}},
	{ID: "headphones", Label: "耳机", Archetype: "spec", PainPoints: []string{"降噪", "延迟", "舒适", "续航"}, CompareAxes: []string{"续航", "编码", "重量"}},
	{ID: "phone-accessories", Label: "手机配件", Archetype: "spec"},
	{ID: "smart-home", Label: "智能家居", Archetype: "spec", PainPoints: []string{"联网", "语音助手", "安装"}},
	{ID: "kitchen-appliance", Label: "厨房小电", Archetype: "lifestyle", PainPoints: []string{"清洗", "噪音", "容量"}},
	{ID: "furniture", Label: "家具", Archetype: "lifestyle", PainPoints: []string{"尺寸", "承重", "安装"}},
	{ID: "beauty-skincare", Label: "美妆护肤", Archetype: "beauty", PainPoints: []string{"成分刺激", "肤质", "吸收"}},
	{ID: "baby", Label: "母婴", Archetype: "lifestyle", PainPoints: []string{"安全认证", "材质"}},
	{ID: "pet", Label: "宠物", Archetype: "lifestyle"},
	{ID: "auto", Label: "汽车配件", Archetype: "spec"},
	{ID: "tools", Label: "五金工具", Archetype: "spec"},
	{ID: "charger", Label: "充电器", Archetype: "spec"},
	{ID: "generic", Label: "通用 / 其他", Archetype: "lifestyle", PainPoints: []string{"是什么", "怎么用", "和竞品差在哪"}},
}

var htmlTag = regexp.MustCompile(`(?i)<[^>]+>`)
var priceLike = regexp.MustCompile(`(?i)(\$|€|£|¥|￥)\s?\d|\d+(\.\d+)?\s?(usd|eur|gbp|rmb|cny)|免费试用价|秒杀价`)
var superlative = regexp.MustCompile(`(?i)\b(#1|number one|guaranteed|miracle)\b|第一名|绝对|永久|根治`)

func MarketplaceByID(id string) Marketplace {
	key := strings.ToUpper(strings.TrimSpace(id))
	for _, item := range marketplaces {
		if item.ID == key {
			return item
		}
	}
	return marketplaces[0]
}

func CategoryByID(id string) Category {
	key := strings.ToLower(strings.TrimSpace(id))
	for _, item := range categories {
		if item.ID == key {
			return item
		}
	}
	return categories[len(categories)-1]
}

func ModuleTypeByID(id string) (ModuleType, bool) {
	for _, item := range moduleTypes {
		if item.ID == id {
			return item, true
		}
	}
	return ModuleType{}, false
}

func Catalog() map[string]any {
	ms := make([]map[string]any, 0, len(marketplaces))
	for _, item := range marketplaces {
		ms = append(ms, map[string]any{
			"id": item.ID, "label": item.Label, "site": item.Site, "region": item.Region,
			"language": item.Language, "languageCode": item.LanguageCode, "units": item.Units,
		})
	}
	cs := make([]map[string]any, 0, len(categories))
	for _, item := range categories {
		cs = append(cs, map[string]any{
			"id": item.ID, "label": item.Label, "archetype": item.Archetype,
			"painPoints": item.PainPoints, "compareAxes": item.CompareAxes,
		})
	}
	ts := make([]map[string]any, 0, len(moduleTypes))
	for _, item := range moduleTypes {
		ts = append(ts, map[string]any{
			"id": item.ID, "amazonName": item.AmazonName, "pepcf": item.PEPCF,
			"width": item.Width, "height": item.Height, "premium": item.Premium,
			"headlineMax": item.HeadlineMax, "bodyMax": item.BodyMax,
		})
	}
	return map[string]any{"marketplaces": ms, "categories": cs, "moduleTypes": ts}
}

func maxModules(tier string) int {
	if strings.EqualFold(strings.TrimSpace(tier), "premium") {
		return 7
	}
	return 5
}

func NormalizeTier(tier string) string {
	if strings.EqualFold(strings.TrimSpace(tier), "premium") {
		return "premium"
	}
	return "basic"
}

func DefaultPlan(categoryID, marketplaceID, tier, productName string) Plan {
	category := CategoryByID(categoryID)
	market := MarketplaceByID(marketplaceID)
	tier = NormalizeTier(tier)
	seq := archetypes[category.Archetype][tier]
	if len(seq) == 0 {
		seq = archetypes["lifestyle"][tier]
	}
	plan := Plan{
		CategoryID:    category.ID,
		CategoryLabel: category.Label,
		MarketplaceID: market.ID,
		Language:      market.Language,
		LanguageCode:  market.LanguageCode,
		Tier:          tier,
		PainPoints:    append([]string{}, category.PainPoints...),
	}
	plan.Modules = make([]Module, 0, len(seq))
	for i, typeID := range seq {
		modType, ok := ModuleTypeByID(typeID)
		if !ok {
			continue
		}
		headline, body := defaultCopy(modType, category, market, productName, i)
		plan.Modules = append(plan.Modules, Module{
			ID:          fmt.Sprintf("%s-%d", modType.ID, i+1),
			TypeID:      modType.ID,
			AmazonName:  modType.AmazonName,
			PEPCF:       modType.PEPCF,
			Width:       modType.Width,
			Height:      modType.Height,
			OutputSize:  fmt.Sprintf("%dx%d", modType.Width, modType.Height),
			AspectRatio: closestRatio(modType.Width, modType.Height),
			Headline:    headline,
			Body:        body,
			ImagePrompt: defaultImagePrompt(modType, category, market, headline, productName),
		})
		plan.PEPCF = append(plan.PEPCF, modType.PEPCF)
	}
	plan.Compliance = map[string]any{
		"languageMatched": true, "noHtml": true, "noGif": true, "noPrice": true,
		"disclosureRequired": true, "disclosureAcknowledged": false,
	}
	return plan
}

func defaultCopy(modType ModuleType, category Category, market Marketplace, productName string, index int) (string, string) {
	name := strings.TrimSpace(productName)
	if name == "" {
		name = category.Label
	}
	pain := "core use concern"
	if index < len(category.PainPoints) {
		pain = category.PainPoints[index]
	} else if len(category.PainPoints) > 0 {
		pain = category.PainPoints[0]
	}
	if market.Region == "domestic" {
		return fmt.Sprintf("%s，先解决「%s」", name, pain),
			fmt.Sprintf("只陈述已提供事实。单位：%s。不写价格。", market.Units)
	}
	return fmt.Sprintf("Does it solve “%s”?", pain),
		fmt.Sprintf("State only confirmed facts. Units: %s. No prices.", market.Units)
}

func defaultImagePrompt(modType ModuleType, category Category, market Marketplace, headline, productName string) string {
	return strings.Join([]string{
		fmt.Sprintf("Create a %dx%d RGB Amazon A+ module (%s).", modType.Width, modType.Height, modType.AmazonName),
		market.ImageStyle,
		fmt.Sprintf("Category %s. PEPCF %s. Render headline: %s.", category.Label, modType.PEPCF, headline),
		"Keep product identity from references. No watermark, GIF, HTML, QR, price or superlatives. Mobile-readable type.",
	}, " ")
}

func closestRatio(w, h int) string {
	if w <= 0 || h <= 0 {
		return "16:9"
	}
	target := float64(w) / float64(h)
	best := "16:9"
	bestDelta := 99.0
	for _, pair := range [][2]int{{1, 1}, {3, 2}, {16, 9}, {21, 9}, {4, 3}, {4, 5}, {3, 4}, {2, 3}} {
		delta := abs(float64(pair[0])/float64(pair[1]) - target)
		if delta < bestDelta {
			bestDelta = delta
			best = fmt.Sprintf("%d:%d", pair[0], pair[1])
		}
	}
	return best
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

type Request struct {
	ASIN            string
	CompetitorASIN  string
	CategoryID      string
	MarketplaceID   string
	Language        string
	Tier            string
	ProductName     string
	SellingPoints   string
	SelectedModules []string
	Disclosure      bool
}

func BuildPlannerPrompt(req Request, fallback Plan) string {
	market := MarketplaceByID(req.MarketplaceID)
	category := CategoryByID(req.CategoryID)
	tier := NormalizeTier(req.Tier)
	limit := maxModules(tier)
	playbook, _ := json.Marshal(map[string]any{
		"category": category, "marketplace": market, "fallbackModules": fallback.Modules,
		"painPoints": category.PainPoints, "compareAxes": category.CompareAxes,
	})
	return fmt.Sprintf(`你是亚马逊 A+ Content / 国内详情页的结构化策划引擎，不是随机出图器。
按 PEPCF（Problem → Explain → Compare → Proof → Finish）为任意品类规划 A+ 项目。

输入：
- ASIN：%s
- 竞品 ASIN：%s（只分析模块结构，禁止抄品牌/文案）
- 品类：%s（%s）
- 站点：%s %s，语言必须是 %s
- 档位：%s，模块数最多 %d（Basic 5 / Premium 7）
- 商品名：%s
- 卖点：%s
- 用户勾选的内容重点：%s
- Disclosure 已确认：%v
- 知识库：%s

规则：
1. 只根据参考图和卖点里能确认的事实，禁止虚构认证、参数、折扣和效果。
2. 国外站用生活场景图；国内站用实拍产品图+尺寸/参数标注，单位服从该站（US E26，CN E27/GB）。
3. 文案语言必须匹配目标站；无 HTML、无 GIF、无外链、无价格、无极限词。
4. 每个模块给出亚马逊模块类型、精确宽高、headline、body、imagePrompt。
5. imagePrompt 必须含 RGB 尺寸、无水印、移动端可读、商品身份锁定。
6. 只返回 JSON，不要 Markdown。格式：
{"asin":"","competitorAsin":"","categoryId":"","marketplaceId":"","language":"","tier":"basic","disclosure":false,"painPoints":[""],"pepcf":[""],"modules":[{"id":"","typeId":"std-header","amazonName":"Standard Header Image","pepcf":"Problem","width":970,"height":600,"outputSize":"970x600","aspectRatio":"3:2","headline":"","body":"","imagePrompt":""}]}`,
		strings.TrimSpace(req.ASIN), strings.TrimSpace(req.CompetitorASIN),
		category.Label, category.ID, market.Label, market.Site, market.Language,
		tier, limit, strings.TrimSpace(req.ProductName), strings.TrimSpace(req.SellingPoints),
		strings.Join(req.SelectedModules, ", "), req.Disclosure, string(playbook))
}

func DecodePlan(raw string, req Request) (*Plan, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var plan Plan
	if err := json.Unmarshal([]byte(text[start:end+1]), &plan); err != nil {
		return nil, err
	}
	NormalizePlan(&plan, req)
	if len(plan.Modules) < 3 {
		return nil, fmt.Errorf("not enough modules")
	}
	return &plan, nil
}

func NormalizePlan(plan *Plan, req Request) {
	market := MarketplaceByID(firstNonEmpty(plan.MarketplaceID, req.MarketplaceID))
	category := CategoryByID(firstNonEmpty(plan.CategoryID, req.CategoryID))
	plan.ASIN = strings.ToUpper(strings.TrimSpace(firstNonEmpty(plan.ASIN, req.ASIN)))
	plan.CompetitorASIN = strings.ToUpper(strings.TrimSpace(firstNonEmpty(plan.CompetitorASIN, req.CompetitorASIN)))
	plan.CategoryID = category.ID
	plan.CategoryLabel = category.Label
	plan.MarketplaceID = market.ID
	plan.Language = market.Language
	plan.LanguageCode = market.LanguageCode
	plan.Tier = NormalizeTier(firstNonEmpty(plan.Tier, req.Tier))
	plan.Disclosure = plan.Disclosure || req.Disclosure
	limit := maxModules(plan.Tier)
	if len(plan.Modules) > limit {
		plan.Modules = plan.Modules[:limit]
	}
	cleaned := make([]Module, 0, len(plan.Modules))
	pepcf := make([]string, 0, len(plan.Modules))
	for i, module := range plan.Modules {
		modType, ok := ModuleTypeByID(module.TypeID)
		if !ok {
			modType, _ = ModuleTypeByID("std-header")
		}
		if plan.Tier != "premium" && modType.Premium {
			continue
		}
		module.TypeID = modType.ID
		module.AmazonName = modType.AmazonName
		if module.PEPCF == "" {
			module.PEPCF = modType.PEPCF
		}
		module.Width = modType.Width
		module.Height = modType.Height
		module.OutputSize = fmt.Sprintf("%dx%d", modType.Width, modType.Height)
		module.AspectRatio = closestRatio(modType.Width, modType.Height)
		if module.ID == "" {
			module.ID = fmt.Sprintf("%s-%d", modType.ID, i+1)
		}
		module.Headline = sanitizeCopy(module.Headline, modType.HeadlineMax)
		module.Body = sanitizeCopy(module.Body, modType.BodyMax)
		module.ImagePrompt = sanitizeCopy(module.ImagePrompt, 1200)
		if module.ImagePrompt == "" {
			module.ImagePrompt = defaultImagePrompt(modType, category, market, module.Headline, req.ProductName)
		}
		cleaned = append(cleaned, module)
		pepcf = append(pepcf, module.PEPCF)
	}
	plan.Modules = cleaned
	if len(plan.PainPoints) == 0 {
		plan.PainPoints = append([]string{}, category.PainPoints...)
	}
	plan.PEPCF = pepcf
	plan.Compliance = map[string]any{
		"languageMatched":        true,
		"noHtml":                 true,
		"noGif":                  true,
		"noPrice":                true,
		"disclosureRequired":     true,
		"disclosureAcknowledged": plan.Disclosure,
	}
}

func sanitizeCopy(value string, limit int) string {
	text := strings.TrimSpace(htmlTag.ReplaceAllString(value, ""))
	text = priceLike.ReplaceAllString(text, "")
	text = superlative.ReplaceAllString(text, "")
	text = strings.Join(strings.Fields(text), " ")
	if limit > 0 && utf8.RuneCountInString(text) > limit {
		runes := []rune(text)
		text = string(runes[:limit])
	}
	return strings.TrimSpace(text)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func ImageConstraints(module Module) string {
	return fmt.Sprintf(
		"Amazon A+ RGB still: exact %s, module %s, no watermark, no GIF, no HTML, no price, no QR, mobile-readable overlay, keep product identity.",
		module.OutputSize, module.AmazonName,
	)
}
