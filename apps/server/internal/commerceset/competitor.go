package commerceset

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// 照着竞品做：用户上传竞品详情页 / 主图截图，助手先拆出可执行的风格，再按这份风格给用户
// 自己的商品出一套图。竞品截图只用于分析，从不交给出图模型：出图时只带拆解出的文字，
// 商品外观仍以用户自己的商品图为准，竞品的品牌、Logo 和原文文案一律不用。

const (
	maxCompetitorSlots    = 18
	maxCompetitorListLen  = 6
	maxCompetitorTextRune = 160
)

// CompetitorColor is one colour of the competitor's palette.
type CompetitorColor struct {
	Name string `json:"name"`
	Hex  string `json:"hex"`
	Role string `json:"role,omitempty"`
}

// CompetitorSlot is one image of the competitor's listing, in page order.
type CompetitorSlot struct {
	Type        string `json:"type"`
	Purpose     string `json:"purpose"`
	Layout      string `json:"layout"`
	CopyPattern string `json:"copyPattern,omitempty"`
}

// CompetitorStyle is what the assistant read from the screenshots.
type CompetitorStyle struct {
	NotListing   bool              `json:"notListing,omitempty"`
	Reason       string            `json:"reason,omitempty"`
	Platform     string            `json:"platform,omitempty"`
	Category     string            `json:"category,omitempty"`
	Summary      string            `json:"summary"`
	Palette      []CompetitorColor `json:"palette,omitempty"`
	Lighting     string            `json:"lighting,omitempty"`
	Background   string            `json:"background,omitempty"`
	Typography   string            `json:"typography,omitempty"`
	TextDensity  string            `json:"textDensity,omitempty"`
	Props        string            `json:"props,omitempty"`
	Slots        []CompetitorSlot  `json:"slots,omitempty"`
	Strengths    []string          `json:"strengths,omitempty"`
	Improvements []string          `json:"improvements,omitempty"`
	AvoidTerms   []string          `json:"avoidTerms,omitempty"`
}

// CompetitorPrompt asks a vision model to take apart a competitor's listing.
// tiles is how many images follow; long pages arrive cut into screens.
func CompetitorPrompt(tiles int, note string) string {
	var types strings.Builder
	for index, item := range catalog.Types {
		if index > 0 {
			types.WriteString("；")
		}
		types.WriteString(item.ID + "=" + item.Label)
	}
	noteLine := ""
	if note = strings.TrimSpace(note); note != "" {
		noteLine = "用户特别关注：" + truncate(note, 300) + "\n"
	}
	return fmt.Sprintf(`你是资深电商视觉总监。下面 %d 张图是用户截取的一个竞品商品页（主图 / 详情页）。较长的页面被按从上到下的顺序切成了多屏，相邻屏之间有少量重叠，同一张图跨屏时只算一张。
%s请拆解这个竞品的视觉打法，目的是让设计师给另一个商品照着这种打法做一套图。要求：
1. 每一项都写成可以直接执行的具体描述，例如“标题在上方 1/4，粗黑体白字压在深蓝色色块上”，不要写“简约大气”“高级感”这类空话。要精炼：lighting、background、typography、textDensity、props 各不超过 50 字；slots 里 purpose 不超过 20 字，layout、copyPattern 各不超过 40 字。
2. slots 按页面顺序列出竞品的每一张图（主图和详情页的每一屏），最多 18 张。type 必须从下面的出图类型里选最接近的 id：%s。
   purpose 写这一张在讲什么（如“放大续航卖点”）；layout 写构图与版式（主体位置、景别、信息区位置、图标/标注怎么排）；copyPattern 写文案的写法和句式结构（如“数字 + 利益点的短标题，配 3 个图标小字”），不要抄写原文。
3. palette 给 3-6 个主要颜色，hex 用 #RRGGBB，role 写用途（背景、强调、文字等）。
4. lighting 光线，background 背景与场景，typography 字体与字号层级，textDensity 文字多少（如“每屏 1 个大标题 + 不超过 3 行小字”），props 道具与场景元素。
5. strengths 写 2-4 条值得借鉴的做法；improvements 写 2-4 条可以做得比它更好的地方（差异化建议）。
6. avoidTerms 列出截图里出现的竞品品牌名、店铺名、Logo 文字、标语和具体的数据宣称，出图时要避开它们。
7. summary 用一句话（最长 60 字）概括这个竞品的视觉主线。
8. 如果这些图不是商品主图或详情页（例如聊天截图、风景照），notListing 设为 true，并在 reason 里说明。
9. 除 hex 和 type 外全部用简体中文。只返回 JSON，不要 Markdown 或解释，格式：
{"notListing":false,"reason":"","platform":"","category":"","summary":"","palette":[{"name":"","hex":"#000000","role":""}],"lighting":"","background":"","typography":"","textDensity":"","props":"","slots":[{"type":"","purpose":"","layout":"","copyPattern":""}],"strengths":[""],"improvements":[""],"avoidTerms":[""]}`,
		tiles, noteLine, types.String())
}

var hexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// ParseCompetitorStyle decodes and cleans the vision model's reply. Slots of
// unknown types are dropped; a listing with no usable slot is an error.
func ParseCompetitorStyle(raw string) (*CompetitorStyle, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, errors.New("竞品分析没有返回结构化结果")
	}
	var style CompetitorStyle
	if err := json.Unmarshal([]byte(text[start:end+1]), &style); err != nil {
		return nil, fmt.Errorf("竞品分析结果格式不正确: %w", err)
	}
	clean := func(value string) string { return truncate(value, maxCompetitorTextRune) }
	style.Reason, style.Platform, style.Category = clean(style.Reason), truncate(style.Platform, 40), truncate(style.Category, 40)
	style.Summary = truncate(style.Summary, 60)
	style.Lighting, style.Background, style.Typography = clean(style.Lighting), clean(style.Background), clean(style.Typography)
	style.TextDensity, style.Props = clean(style.TextDensity), clean(style.Props)
	if style.NotListing {
		style.Slots, style.Palette = nil, nil
		return &style, nil
	}
	palette := []CompetitorColor{}
	for _, color := range style.Palette {
		if !hexColorPattern.MatchString(strings.TrimSpace(color.Hex)) || len(palette) == maxCompetitorListLen {
			continue
		}
		palette = append(palette, CompetitorColor{Name: truncate(color.Name, 20), Hex: strings.ToUpper(strings.TrimSpace(color.Hex)), Role: truncate(color.Role, 20)})
	}
	style.Palette = palette
	slots := []CompetitorSlot{}
	for _, slot := range style.Slots {
		slot.Type = strings.TrimSpace(slot.Type)
		if _, ok := TypeByID(slot.Type); !ok || len(slots) == maxCompetitorSlots {
			continue
		}
		slots = append(slots, CompetitorSlot{Type: slot.Type, Purpose: clean(slot.Purpose), Layout: clean(slot.Layout), CopyPattern: clean(slot.CopyPattern)})
	}
	if len(slots) == 0 {
		return nil, errors.New("没有从截图里识别出竞品的出图结构")
	}
	style.Slots = slots
	style.Strengths = cleanList(style.Strengths, 4, 80)
	style.Improvements = cleanList(style.Improvements, 4, 80)
	style.AvoidTerms = cleanList(style.AvoidTerms, 12, 40)
	return &style, nil
}

func cleanList(values []string, limit, runes int) []string {
	out := []string{}
	for _, value := range values {
		if value = truncate(value, runes); value != "" && len(out) < limit {
			out = append(out, value)
		}
	}
	return out
}

// factOnlyTypes show proof the user has to supply (reviews, certificates,
// test reports). Copying the competitor's slot without that proof only
// makes a picture of placeholder text, so they are left out by default; the
// user can still ask for them.
var factOnlyTypes = map[string]bool{"review": true, "cert": true, "inspection": true, "ugc": true}

// ShotsFromCompetitor follows the competitor's sequence: each type in order
// of first appearance, as many times as the competitor used it.
func ShotsFromCompetitor(style *CompetitorStyle) []ShotRequest {
	if style == nil {
		return nil
	}
	counts := map[string]int{}
	order := []string{}
	total := 0
	for _, slot := range style.Slots {
		if factOnlyTypes[slot.Type] || total == catalog.MaxShots || counts[slot.Type] == catalog.MaxPerType {
			continue
		}
		if counts[slot.Type] == 0 {
			order = append(order, slot.Type)
		}
		counts[slot.Type]++
		total++
	}
	out := make([]ShotRequest, 0, len(order))
	for _, id := range order {
		out = append(out, ShotRequest{Type: id, Count: counts[id]})
	}
	return out
}

// CompetitorStyleText is the style part every image prompt carries.
func CompetitorStyleText(style *CompetitorStyle) string {
	if style == nil {
		return ""
	}
	parts := []string{}
	add := func(label, value string) {
		if value = strings.TrimRight(strings.TrimSpace(value), "。；;. "); value != "" {
			parts = append(parts, label+"："+value)
		}
	}
	add("视觉主线", style.Summary)
	if len(style.Palette) > 0 {
		colors := make([]string, 0, len(style.Palette))
		for _, color := range style.Palette {
			label := color.Name + " " + color.Hex
			if color.Role != "" {
				label += "（" + color.Role + "）"
			}
			colors = append(colors, label)
		}
		add("配色", strings.Join(colors, "、"))
	}
	add("光线", style.Lighting)
	add("背景与场景", style.Background)
	add("字体与排版", style.Typography)
	add("文字密度", style.TextDensity)
	add("道具与元素", style.Props)
	text := "参考风格（只借鉴视觉打法，不复制竞品的商品、品牌、Logo 和原文文案）：" + strings.Join(parts, "；") + "。"
	if len(style.AvoidTerms) > 0 {
		text += "画面中禁止出现：" + strings.Join(style.AvoidTerms, "、") + "。"
	}
	return text
}

// CompetitorSequenceText lists the competitor's images for the copy planner,
// which writes each of our shots after the competitor image in the same place.
func CompetitorSequenceText(style *CompetitorStyle) string {
	if style == nil || len(style.Slots) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("竞品的图片顺序与版式（同类型的第 n 张对应竞品里该类型的第 n 张）：\n")
	for index, slot := range style.Slots {
		label := slot.Type
		if item, ok := TypeByID(slot.Type); ok {
			label = item.Label
		}
		fmt.Fprintf(&builder, "%d. %s：%s；版式：%s", index+1, label, slot.Purpose, slot.Layout)
		if slot.CopyPattern != "" {
			builder.WriteString("；文案写法：" + slot.CopyPattern)
		}
		builder.WriteString("\n")
	}
	if len(style.Improvements) > 0 {
		builder.WriteString("在竞品基础上要做得更好：" + strings.Join(style.Improvements, "；") + "\n")
	}
	return builder.String()
}

// DecodeCompetitorStyle reads a stored analysis.
func DecodeCompetitorStyle(raw []byte) (*CompetitorStyle, error) {
	var style CompetitorStyle
	if err := json.Unmarshal(raw, &style); err != nil {
		return nil, err
	}
	if style.NotListing || len(style.Slots) == 0 {
		return nil, invalid("这份竞品截图没有识别出商品图结构，请换几张竞品主图或详情页截图")
	}
	return &style, nil
}

// WithoutKeys drops the competitor's screenshots from a list of image keys.
func WithoutKeys(keys, drop []string) []string {
	skip := map[string]bool{}
	for _, key := range drop {
		skip[key] = true
	}
	out := []string{}
	for _, key := range keys {
		if !skip[key] {
			out = append(out, key)
		}
	}
	return out
}
