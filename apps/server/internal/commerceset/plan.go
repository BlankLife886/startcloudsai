package commerceset

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// ErrInvalid marks a request the caller should fix.
var ErrInvalid = errors.New("invalid commerce set request")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

const (
	maxProductInfoRunes = 1000
	maxNoteRunes        = 2000
	maxNameRunes        = 60
	maxFieldRunes       = 40
)

// ShotRequest asks for Count images of one shot type.
type ShotRequest struct {
	Type  string `json:"type"`
	Count int    `json:"count,omitempty"`
}

// Brief is what the user wants: the product, where it sells, and which
// shots. Empty fields fall back to the workbench defaults.
type Brief struct {
	ProductName   string        `json:"productName,omitempty"`
	SellingPoints string        `json:"sellingPoints,omitempty"`
	Platform      string        `json:"platform,omitempty"`
	Market        string        `json:"market,omitempty"`
	Language      string        `json:"language,omitempty"`
	Style         string        `json:"style,omitempty"`
	Note          string        `json:"note,omitempty"`
	Shots         []ShotRequest `json:"shots,omitempty"`
	MainRatio     string        `json:"mainRatio,omitempty"`
	DetailRatio   string        `json:"detailRatio,omitempty"`
	// CompetitorRefID names a competitor analysis to follow (照着竞品做).
	CompetitorRefID string `json:"competitorRefId,omitempty"`
	// Reference and ReferenceSequence are filled by the service from that
	// analysis and kept with the set, so redos and edits keep the style.
	Reference         string `json:"reference,omitempty"`
	ReferenceSequence string `json:"referenceSequence,omitempty"`
}

// Shot is one planned image.
type Shot struct {
	ID          string `json:"id"`
	TypeID      string `json:"typeId"`
	Role        string `json:"role"`
	Label       string `json:"label"`
	AspectRatio string `json:"aspectRatio"`
	Headline    string `json:"headline,omitempty"`
	Subline     string `json:"subline,omitempty"`
	// Direction is the planner's composition note shown to the user.
	Direction string `json:"direction,omitempty"`
	// typeDirection is the catalog direction (plus a variation hint for
	// repeated types); it goes into the prompt, not the card.
	typeDirection string
}

func truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

// Normalize trims the brief, applies defaults and validates it.
func Normalize(brief Brief) (Brief, error) {
	brief.ProductName = truncate(brief.ProductName, maxNameRunes)
	brief.SellingPoints = truncate(brief.SellingPoints, maxProductInfoRunes)
	brief.Platform = truncate(brief.Platform, maxFieldRunes)
	brief.Market = truncate(brief.Market, maxFieldRunes)
	brief.Language = truncate(brief.Language, maxFieldRunes)
	brief.Style = truncate(brief.Style, maxFieldRunes)
	brief.Note = truncate(brief.Note, maxNoteRunes)
	if brief.Platform == "" && len(catalog.Platforms) > 0 {
		brief.Platform = catalog.Platforms[0]
	}
	if brief.Market == "" && len(catalog.Markets) > 0 {
		brief.Market = catalog.Markets[0]
	}
	if brief.Language == "" && len(catalog.Languages) > 0 {
		brief.Language = catalog.Languages[0]
	}
	if brief.MainRatio == "" {
		brief.MainRatio = catalog.DefaultMainRatio
	}
	if brief.DetailRatio == "" {
		brief.DetailRatio = catalog.DefaultDetailRatio
	}
	if !validRatio(brief.MainRatio) || !validRatio(brief.DetailRatio) {
		return brief, invalid("不支持的画幅，可选：%s", strings.Join(catalog.Ratios, "、"))
	}
	if len(brief.Shots) == 0 {
		for _, item := range catalog.DefaultItems {
			brief.Shots = append(brief.Shots, ShotRequest{Type: item.ID, Count: item.Count})
		}
	}
	return brief, nil
}

// Expand turns the brief's shot requests into one Shot per image, like the
// workbench's listingBaseShots in free mode.
func Expand(brief Brief) ([]Shot, error) {
	shots := []Shot{}
	seen := map[string]bool{}
	for _, request := range brief.Shots {
		shotType, ok := TypeByID(request.Type)
		if !ok {
			return nil, invalid("不支持的出图类型：%s", request.Type)
		}
		if seen[shotType.ID] {
			continue
		}
		seen[shotType.ID] = true
		count := min(max(request.Count, 1), catalog.MaxPerType)
		for index := 0; index < count; index++ {
			id, label, direction := shotType.ID, shotType.Label, shotType.Direction
			if count > 1 {
				label = fmt.Sprintf("%s %d", shotType.Label, index+1)
			}
			if index > 0 {
				id = fmt.Sprintf("%s~%d", shotType.ID, index+1)
				direction += " 与同类型的其他张使用明显不同的构图、角度或场景。"
			}
			ratio := brief.DetailRatio
			if shotType.Role == "main" {
				ratio = brief.MainRatio
			}
			shots = append(shots, Shot{ID: id, TypeID: shotType.ID, Role: shotType.Role, Label: label,
				AspectRatio: ratio, typeDirection: direction})
		}
	}
	if len(shots) == 0 {
		return nil, invalid("至少需要一种出图类型")
	}
	if len(shots) > catalog.MaxShots {
		return nil, invalid("一套最多 %d 张，当前 %d 张", catalog.MaxShots, len(shots))
	}
	return shots, nil
}

func fallback(value, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return value
}

func roleLabel(role string) string {
	if role == "main" {
		return "主图"
	}
	return "详情页"
}

var noCopyPattern = regexp.MustCompile(`无需|无文字|不需要文案`)

func headlineLanguageHint(language string) string {
	language = strings.TrimSpace(language)
	if noCopyPattern.MatchString(language) {
		return "本套图不放任何文字，headline 与 subline 必须为空字符串，只写 direction"
	}
	if language == "" || strings.Contains(language, "中") {
		return "使用简体中文"
	}
	return "使用「" + language + "」书写"
}

// CopyPrompt asks the planning model for each shot's headline, subline and
// composition, following the workbench's listing plan prompt.
func CopyPrompt(brief Brief, shots []Shot) string {
	var list strings.Builder
	for index, shot := range shots {
		fmt.Fprintf(&list, "%d. id=%s，%s，类型：%s，职责：%s\n", index+1, shot.ID, roleLabel(shot.Role), shot.Label, shot.typeDirection)
	}
	noteLine := ""
	if brief.Note != "" {
		noteLine = "用户补充要求：" + brief.Note + "\n"
	}
	if brief.Reference != "" {
		noteLine += brief.Reference + "\n" + brief.ReferenceSequence +
			"按竞品的打法策划：每张的 direction 照对应竞品图的构图与版式来写，headline 照它的文案写法写，但内容只能来自本商品，不得出现竞品的品牌、商品名和原文文案。\n"
	}
	return fmt.Sprintf(`你是电商详情页视觉策划。请只根据商品参考图中真实可见的信息和下面的商品资料，为每一种出图类型策划一张图的文案与构图方向。
目标平台：%s
目标市场：%s
文案语言：%s
视觉风格：%s
商品名称：%s
商品卖点：%s
%s
需要策划的出图类型（按顺序，id 必须原样返回）：
%s
规则：
0. 「主图」用于搜索列表与首屏曝光，文案更短更醒目，白底 / 平台合规类主图 headline 可为空字符串；「详情页」负责说服转化，按类型职责展开信息。
1. headline 是画面主标题，%s，最长 24 个字符；subline 是副文案，最长 40 个字符，可为空字符串。
2. direction 用简体中文写 1-2 句具体的构图与视觉方向：主体位置、场景、光线、需要放大的细节或信息区安排，最长 120 个字符。
3. 不得虚构参考图和卖点里无法确认的参数、认证、销量、评价、折扣、价格或日期；类型本身需要这类信息而资料没有提供时，headline 写通用表述并在 direction 里说明保留占位区。
4. 各张之间文案不要重复，同一商品事实保持一致；主标题要像真实电商详情页文案，不要口号堆叠。
5. summary 用一句话（最长 60 个字符）概括整套图的视觉主线。
6. 只返回 JSON，不要 Markdown、代码围栏或解释。格式必须是：{"summary":"...","items":[{"id":"...","headline":"...","subline":"...","direction":"..."}]}，items 必须覆盖上面每一个 id。`,
		brief.Platform, brief.Market, brief.Language,
		fallback(brief.Style, "按商品调性自动匹配，整套保持统一"),
		fallback(brief.ProductName, "根据商品图片准确识别"),
		fallback(brief.SellingPoints, "未提供，只能使用图片中可确认的信息"),
		noteLine, list.String(), headlineLanguageHint(brief.Language))
}

type copyItem struct {
	ID        string `json:"id"`
	Headline  string `json:"headline"`
	Subline   string `json:"subline"`
	Direction string `json:"direction"`
}

// ApplyCopy decodes the planning model's reply into the shots. Shots the
// reply misses keep their catalog direction; a reply with nothing usable is
// an error so the caller can retry or fall back.
func ApplyCopy(raw string, shots []Shot) (string, []Shot, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return "", shots, errors.New("planning reply has no JSON object")
	}
	var reply struct {
		Summary string     `json:"summary"`
		Items   []copyItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(text[start:end+1]), &reply); err != nil {
		return "", shots, err
	}
	byID := map[string]copyItem{}
	for _, item := range reply.Items {
		byID[strings.TrimSpace(item.ID)] = item
	}
	matched := 0
	out := make([]Shot, len(shots))
	for index, shot := range shots {
		if item, ok := byID[shot.ID]; ok {
			matched++
			shot.Headline = truncate(item.Headline, 24)
			shot.Subline = truncate(item.Subline, 40)
			shot.Direction = truncate(item.Direction, 120)
		}
		out[index] = shot
	}
	if matched == 0 {
		return "", shots, errors.New("planning reply matched no shot")
	}
	return truncate(reply.Summary, 60), out, nil
}

const (
	modeLabel  = "商品套图"
	modePrompt = "生成一套风格统一但构图各有侧重的商品 Listing 图片，按用户勾选的出图类型逐张产出，适合连续上架使用。"
	// identityLock and seriesLock are the workbench's product consistency
	// profile for listing (ecommerceConsistencyProfile).
	identityLock = "商品身份锁：参考商品是唯一商品事实来源。锁定整体几何轮廓、长宽厚比例、部件数量与位置、Logo、包装文字、颜色、纹理、接口、装饰和真实尺度；不可补造、删减、镜像或换成相似商品。"
	seriesLock   = "系列连续性锁：所有图片并行生成，每张都必须直接继承相同的原始身份参考、布景语言、主光方向、色温、镜头质感、品牌色和版式节奏；不得假设可以读取另一张成品。原始身份参考始终拥有更高优先级。"
	singleLock   = "准确执行本张图片职责，原始身份参考和其中可见细节优先级最高。"
)

func basePrompt(brief Brief, summary string) string {
	noCopy := noCopyPattern.MatchString(brief.Language)
	lines := []string{
		"任务：" + modeLabel + "。" + modePrompt,
		"商品名称：" + fallback(brief.ProductName, "根据商品图片准确识别") + "。",
	}
	if brief.SellingPoints != "" {
		lines = append(lines, "商品卖点与要求："+brief.SellingPoints+"。")
	}
	lines = append(lines, "适配平台："+brief.Platform+"。", "目标市场："+brief.Market+"。", "页面文案语言："+brief.Language+"。")
	if style := stylePrompt(brief.Style); style != "" {
		lines = append(lines, "整套视觉风格："+style)
	}
	if brief.Reference != "" {
		lines = append(lines, brief.Reference)
	}
	if noCopy {
		lines = append(lines, "整套图不出现任何标题、文案、标签或水印，只用画面表达。")
	} else {
		lines = append(lines, "文字必须准确清晰，无法可靠生成时留白，不得输出乱码。")
	}
	if brief.Note != "" {
		lines = append(lines, "用户细节补充："+brief.Note)
	}
	if summary != "" {
		lines = append(lines, "整套图视觉主线："+summary+"。")
	}
	lines = append(lines, "严格保持参考商品造型、颜色、比例、Logo、包装文字和材质细节一致。")
	return strings.Join(lines, "\n")
}

// Prompts builds every shot's generation prompt the way the workbench's
// buildEcommerceGenerationPlan does for listing, given how many product
// reference images are attached.
func Prompts(brief Brief, summary string, shots []Shot, referenceCount int) []string {
	base := basePrompt(brief, summary)
	roles := make([]string, 0, referenceCount)
	for index := 0; index < referenceCount; index++ {
		roles = append(roles, fmt.Sprintf("商品身份角度 %d", index+1))
	}
	lock := singleLock
	if len(shots) > 1 {
		lock = seriesLock
	}
	out := make([]string, len(shots))
	for index, shot := range shots {
		direction := shot.typeDirection
		if shot.Direction != "" {
			direction += " 策划方向：" + shot.Direction
		}
		if shot.Headline != "" {
			copyLine := "画面标题文案：「" + shot.Headline + "」"
			if shot.Subline != "" {
				copyLine += "；副文案：「" + shot.Subline + "」"
			}
			direction += " " + copyLine + "。文案必须准确清晰，无法可靠生成时留白。"
		}
		lines := []string{base, identityLock}
		if len(roles) > 0 {
			lines = append(lines, "参考图角色："+strings.Join(roles, "；")+"。")
		}
		lines = append(lines, "本张输出职责："+shot.Label+"。"+direction)
		if len(shots) > 1 {
			lines = append(lines, fmt.Sprintf("这是整套输出的第 %d/%d 张。", index+1, len(shots)))
		}
		lines = append(lines, lock)
		out[index] = strings.Join(lines, "\n")
	}
	return out
}

// RestoreDirections re-attaches catalog directions to shots loaded from
// storage, where only the public fields were kept.
func RestoreDirections(shots []Shot) []Shot {
	counts := map[string]int{}
	out := make([]Shot, len(shots))
	for index, shot := range shots {
		if shotType, ok := TypeByID(shot.TypeID); ok {
			shot.typeDirection = shotType.Direction
			if counts[shot.TypeID] > 0 {
				shot.typeDirection += " 与同类型的其他张使用明显不同的构图、角度或场景。"
			}
		}
		counts[shot.TypeID]++
		out[index] = shot
	}
	return out
}

// ViewLabel is the label the workbench shows for a listing image.
func ViewLabel(shot Shot) string { return modeLabel + " · " + shot.Label }
