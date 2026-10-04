package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// 商品套图“先策划再生成”：让文本模型基于商品图 + 卖点，为用户勾选的每种出图类型
// 写出画面标题、副文案与构图方向。结果只用于拼进出图 prompt，不单独计费。
// 智能组图（smart）时由模型从候选类型里自行挑选：主图 N 张 + 详情页 M 张。
const (
	ecommerceListingPlanMaxTypes      = 18
	ecommerceListingPlanMaxNoteRunes  = 2000
	ecommerceListingPlanMaxCandidates = 60
	ecommerceListingSmartMaxMain      = 6
	ecommerceListingSmartMaxDetail    = 15
)

type ecommerceListingPlanTypeIn struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Direction string `json:"direction"`
	// main = 主图（点击与曝光），detail = 详情页（转化与说服）；空值按详情页处理
	Role string `json:"role,omitempty"`
}

type ecommerceListingSmartIn struct {
	MainCount   int `json:"mainCount"`
	DetailCount int `json:"detailCount"`
}

type ecommerceListingPlanIn struct {
	InputKeys     []string                     `json:"inputKeys"`
	Platform      string                       `json:"platform"`
	Market        string                       `json:"market"`
	Language      string                       `json:"language"`
	ProductName   string                       `json:"productName"`
	SellingPoints string                       `json:"sellingPoints"`
	Note          string                       `json:"note"`
	Style         string                       `json:"style"`
	Types         []ecommerceListingPlanTypeIn `json:"types"`
	// 智能组图：Types 留空，由模型从 Candidates 里为每个槽位挑选类型
	Smart      *ecommerceListingSmartIn     `json:"smart"`
	Candidates []ecommerceListingPlanTypeIn `json:"candidates"`
}

type ecommerceListingPlanItem struct {
	ID        string `json:"id"`
	Headline  string `json:"headline"`
	Subline   string `json:"subline"`
	Direction string `json:"direction"`
	// 仅智能组图返回：模型为该槽位挑选的出图类型 id 与角色
	Type string `json:"type,omitempty"`
	Role string `json:"role,omitempty"`
}

type ecommerceListingPlan struct {
	Summary string                     `json:"summary"`
	Items   []ecommerceListingPlanItem `json:"items"`
}

func (s *Server) generateEcommerceListingPlan(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	if !s.enforceUsageLimit(c, "ecommerce-plan-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}
	if s.Storage == nil {
		fail(c, apperr.E("storage_unavailable", "图片存储服务暂不可用", http.StatusServiceUnavailable))
		return
	}
	var body ecommerceListingPlanIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.InputKeys) == 0 {
		fail(c, apperr.E("validation_error", "请先上传商品参考图", 422))
		return
	}
	var (
		types      []ecommerceListingPlanTypeIn
		candidates []ecommerceListingPlanTypeIn
	)
	if body.Smart != nil {
		types, candidates, err = normalizeEcommerceListingSmart(body.Smart, body.Candidates)
	} else {
		types, err = normalizeEcommerceListingPlanTypes(body.Types)
	}
	if err != nil {
		fail(c, err)
		return
	}
	inspect := func(ctx context.Context, key string, maxBytes int64) (int64, error) {
		return s.inspectOwnedTaskImage(ctx, user.ID, key, maxBytes)
	}
	if err := validateTaskImageKeys(c.Request.Context(), user.ID, "inputKeys", body.InputKeys, 6, s.Cfg.UploadMaxBytes, 24<<20, inspect, isAllowedTaskInputImageKey); err != nil {
		fail(c, err)
		return
	}
	imageURLs, err := s.ecommerceAnalysisImageURLs(c.Request.Context(), body.InputKeys)
	if err != nil {
		fail(c, err)
		return
	}
	client, err := s.ecommerceAnalysisClient(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	prompt := buildEcommerceListingPlanPrompt(body, types)
	if body.Smart != nil {
		prompt = buildEcommerceListingSmartPrompt(body, types, candidates)
	}

	if !ecommerceBriefSemaphore.TryAcquire(1) {
		fail(c, apperr.E("busy", "当前分析请求过多，请稍后再试", 429))
		return
	}
	defer ecommerceBriefSemaphore.Release(1)
	llmCtx, cancel := context.WithTimeout(c.Request.Context(), ecommerceBriefTimeout)
	defer cancel()
	reply, err := client.ChatTextWithImages(llmCtx, []sub2api.Message{{Role: "user", Content: prompt}}, imageURLs, nil)
	if err != nil {
		fail(c, assistantUpstreamError(err))
		return
	}
	var plan *ecommerceListingPlan
	if body.Smart != nil {
		plan, err = decodeEcommerceListingSmartPlan(reply, types, candidates)
	} else {
		plan, err = decodeEcommerceListingPlan(reply, types)
	}
	if err != nil {
		fail(c, apperr.E("assistant_bad_response", "AI 未能完成套图策划，请重试", 502))
		return
	}
	ok(c, plan)
}

func normalizeEcommerceListingPlanTypes(in []ecommerceListingPlanTypeIn) ([]ecommerceListingPlanTypeIn, error) {
	return normalizeEcommercePlanTypes(in, ecommerceListingPlanMaxTypes, "出图类型")
}

func normalizeEcommercePlanTypes(in []ecommerceListingPlanTypeIn, maxTypes int, noun string) ([]ecommerceListingPlanTypeIn, error) {
	if len(in) == 0 {
		return nil, apperr.E("validation_error", "请至少勾选一种"+noun, 422)
	}
	if len(in) > maxTypes {
		return nil, apperr.E("validation_error", fmt.Sprintf("%s最多 %d 种", noun, maxTypes), 422)
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]ecommerceListingPlanTypeIn, 0, len(in))
	for _, item := range in {
		id := strings.TrimSpace(item.ID)
		if id == "" || len(id) > 32 {
			return nil, apperr.E("validation_error", noun+"无效", 422)
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, ecommerceListingPlanTypeIn{
			ID:        id,
			Label:     truncateEcommerceBrief(strings.TrimSpace(item.Label), 40),
			Direction: truncateEcommerceBrief(strings.TrimSpace(item.Direction), 400),
			Role:      normalizeEcommerceListingRole(item.Role),
		})
	}
	return out, nil
}

func buildEcommerceListingPlanPrompt(body ecommerceListingPlanIn, types []ecommerceListingPlanTypeIn) string {
	var list strings.Builder
	for index, item := range types {
		label := item.Label
		if label == "" {
			label = item.ID
		}
		fmt.Fprintf(&list, "%d. id=%s，%s，类型：%s", index+1, item.ID, ecommerceListingRoleLabel(item.Role), label)
		if item.Direction != "" {
			fmt.Fprintf(&list, "，职责：%s", item.Direction)
		}
		list.WriteString("\n")
	}
	note := truncateEcommerceBrief(strings.TrimSpace(body.Note), ecommerceListingPlanMaxNoteRunes)
	noteLine := ""
	if note != "" {
		noteLine = "用户补充要求：" + note + "\n"
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
		fallbackBriefContext(body.Platform, "通用电商"),
		fallbackBriefContext(body.Market, "通用市场"),
		fallbackBriefContext(body.Language, "简体中文"),
		listingStyleContext(body.Style),
		fallbackBriefContext(body.ProductName, "根据商品图片准确识别"),
		fallbackBriefContext(truncateEcommerceBrief(strings.TrimSpace(body.SellingPoints), 1200), "未提供，只能使用图片中可确认的信息"),
		noteLine,
		list.String(),
		listingHeadlineLanguageHint(body.Language),
	)
}

func normalizeEcommerceListingRole(role string) string {
	if strings.TrimSpace(strings.ToLower(role)) == "main" {
		return "main"
	}
	return "detail"
}

func ecommerceListingRoleLabel(role string) string {
	if role == "main" {
		return "主图"
	}
	return "详情页"
}

func listingStyleContext(style string) string {
	return fallbackBriefContext(truncateEcommerceBrief(strings.TrimSpace(style), 40), "按商品调性自动匹配，整套保持统一")
}

// 智能组图：校验槽位数量与候选类型，返回按「主图在前、详情页在后」排好的槽位。
// 槽位 id 固定为 main-1..N / detail-1..M，模型必须原样返回。
func normalizeEcommerceListingSmart(smart *ecommerceListingSmartIn, in []ecommerceListingPlanTypeIn) ([]ecommerceListingPlanTypeIn, []ecommerceListingPlanTypeIn, error) {
	mainCount, detailCount := smart.MainCount, smart.DetailCount
	if mainCount < 0 || mainCount > ecommerceListingSmartMaxMain {
		return nil, nil, apperr.E("validation_error", fmt.Sprintf("主图数量需在 0-%d 张之间", ecommerceListingSmartMaxMain), 422)
	}
	if detailCount < 0 || detailCount > ecommerceListingSmartMaxDetail {
		return nil, nil, apperr.E("validation_error", fmt.Sprintf("详情页数量需在 0-%d 张之间", ecommerceListingSmartMaxDetail), 422)
	}
	total := mainCount + detailCount
	if total < 1 {
		return nil, nil, apperr.E("validation_error", "请至少规划 1 张图", 422)
	}
	if total > ecommerceListingPlanMaxTypes {
		return nil, nil, apperr.E("validation_error", fmt.Sprintf("一套最多 %d 张图", ecommerceListingPlanMaxTypes), 422)
	}
	candidates, err := normalizeEcommercePlanTypes(in, ecommerceListingPlanMaxCandidates, "候选出图类型")
	if err != nil {
		return nil, nil, err
	}
	hasRole := map[string]bool{}
	for _, item := range candidates {
		hasRole[item.Role] = true
	}
	if mainCount > 0 && !hasRole["main"] {
		return nil, nil, apperr.E("validation_error", "缺少主图候选类型", 422)
	}
	if detailCount > 0 && !hasRole["detail"] {
		return nil, nil, apperr.E("validation_error", "缺少详情页候选类型", 422)
	}
	slots := make([]ecommerceListingPlanTypeIn, 0, total)
	for i := 1; i <= mainCount; i++ {
		slots = append(slots, ecommerceListingPlanTypeIn{ID: fmt.Sprintf("main-%d", i), Role: "main"})
	}
	for i := 1; i <= detailCount; i++ {
		slots = append(slots, ecommerceListingPlanTypeIn{ID: fmt.Sprintf("detail-%d", i), Role: "detail"})
	}
	return slots, candidates, nil
}

func buildEcommerceListingSmartPrompt(body ecommerceListingPlanIn, slots, candidates []ecommerceListingPlanTypeIn) string {
	var mainList, detailList, slotList strings.Builder
	for _, item := range candidates {
		target := &detailList
		if item.Role == "main" {
			target = &mainList
		}
		fmt.Fprintf(target, "- type=%s：%s", item.ID, fallbackBriefContext(item.Label, item.ID))
		if item.Direction != "" {
			fmt.Fprintf(target, "（%s）", truncateEcommerceBrief(item.Direction, 60))
		}
		target.WriteString("\n")
	}
	mainCount := 0
	for _, slot := range slots {
		if slot.Role == "main" {
			mainCount++
		}
	}
	fmt.Fprintf(&slotList, "主图 %d 张（id 依次为 main-1…），详情页 %d 张（id 依次为 detail-1…）", mainCount, len(slots)-mainCount)
	note := truncateEcommerceBrief(strings.TrimSpace(body.Note), ecommerceListingPlanMaxNoteRunes)
	noteLine := ""
	if note != "" {
		noteLine = "用户补充要求：" + note + "\n"
	}
	return fmt.Sprintf(`你是资深电商视觉策划。请根据商品参考图中真实可见的信息和下面的商品资料，先推导商品的核心卖点、目标人群与使用场景，再为这套电商图挑选最能提升点击与转化的出图类型，并为每张图写文案与构图方向。
目标平台：%s
目标市场：%s
文案语言：%s
视觉风格：%s
商品名称：%s
商品卖点：%s
%s
本次需要：%s。
主图可选类型：
%s
详情页可选类型：
%s
规则：
1. 每个槽位的 type 必须从对应角色的可选类型中原样选取；主图第 1 张优先选平台合规的白底或首图类型；详情页按「首屏吸引 → 卖点说服 → 场景代入 → 细节与参数 → 信任保障」的转化顺序排列。
2. 同一套里尽量不重复选择同一 type；数量多于可选类型时才允许重复，重复时构图方向必须不同。
3. 按商品品类挑选合理的类型：非服饰不要选试穿类，没有人物需求的商品谨慎选择模特类。
4. headline 是画面主标题，%s，最长 24 个字符，白底 / 平台合规类主图可为空字符串；subline 是副文案，最长 40 个字符，可为空字符串。
5. direction 用简体中文写 1-2 句具体的构图与视觉方向，最长 120 个字符。
6. 不得虚构参考图和卖点里无法确认的参数、认证、销量、评价、折扣、价格或日期；类型需要这类信息而资料没有提供时写通用表述，并在 direction 里说明保留占位区。
7. summary 用一句话（最长 60 个字符）概括整套图的视觉主线。
8. 只返回 JSON，不要 Markdown、代码围栏或解释。格式：{"summary":"...","items":[{"id":"main-1","type":"...","headline":"...","subline":"...","direction":"..."}]}，items 必须覆盖每一个槽位 id。`,
		fallbackBriefContext(body.Platform, "通用电商"),
		fallbackBriefContext(body.Market, "通用市场"),
		fallbackBriefContext(body.Language, "简体中文"),
		listingStyleContext(body.Style),
		fallbackBriefContext(body.ProductName, "根据商品图片准确识别"),
		fallbackBriefContext(truncateEcommerceBrief(strings.TrimSpace(body.SellingPoints), 1200), "未提供，只能使用图片中可确认的信息"),
		noteLine,
		slotList.String(),
		fallbackBriefContext(mainList.String(), "（本次不需要主图）\n"),
		fallbackBriefContext(detailList.String(), "（本次不需要详情页）\n"),
		listingHeadlineLanguageHint(body.Language),
	)
}

// 解析智能组图结果：槽位按请求顺序对齐；模型漏掉或选错角色的槽位，
// 按候选顺序补一个本套还没用过的同角色类型，保证每个槽位都有可出图的类型。
func decodeEcommerceListingSmartPlan(raw string, slots, candidates []ecommerceListingPlanTypeIn) (*ecommerceListingPlan, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var plan ecommerceListingPlan
	if err := json.Unmarshal([]byte(text[start:end+1]), &plan); err != nil {
		return nil, err
	}
	roleOf := make(map[string]string, len(candidates))
	for _, item := range candidates {
		roleOf[item.ID] = item.Role
	}
	byID := make(map[string]ecommerceListingPlanItem, len(plan.Items))
	for _, item := range plan.Items {
		id := strings.TrimSpace(item.ID)
		if _, dup := byID[id]; id == "" || dup {
			continue
		}
		byID[id] = item
	}
	used := map[string]int{}
	fallbackType := func(role string) string {
		best, bestUses := "", -1
		for _, item := range candidates {
			if item.Role != role {
				continue
			}
			if uses := used[item.ID]; bestUses < 0 || uses < bestUses {
				best, bestUses = item.ID, uses
			}
		}
		return best
	}
	items := make([]ecommerceListingPlanItem, 0, len(slots))
	filled := 0
	for _, slot := range slots {
		item := byID[slot.ID]
		typeID := strings.TrimSpace(item.Type)
		if roleOf[typeID] != slot.Role {
			typeID = fallbackType(slot.Role)
		}
		used[typeID]++
		headline := truncateEcommerceBrief(strings.TrimSpace(item.Headline), 24)
		direction := truncateEcommerceBrief(strings.TrimSpace(item.Direction), 120)
		if headline != "" || direction != "" {
			filled++
		}
		items = append(items, ecommerceListingPlanItem{
			ID:        slot.ID,
			Type:      typeID,
			Role:      slot.Role,
			Headline:  headline,
			Subline:   truncateEcommerceBrief(strings.TrimSpace(item.Subline), 40),
			Direction: direction,
		})
	}
	if filled == 0 {
		return nil, fmt.Errorf("empty listing plan")
	}
	plan.Items = items
	plan.Summary = truncateEcommerceBrief(strings.TrimSpace(plan.Summary), 60)
	return &plan, nil
}

// 「无需文案 / 无文字」：整套图不放标题文案，headline / subline 一律留空
func listingWithoutCopy(language string) bool {
	language = strings.TrimSpace(language)
	return strings.Contains(language, "无需") || strings.Contains(language, "无文字") || strings.Contains(language, "不需要文案")
}

func listingHeadlineLanguageHint(language string) string {
	language = strings.TrimSpace(language)
	if listingWithoutCopy(language) {
		return "本套图不放任何文字，headline 与 subline 必须为空字符串，只写 direction"
	}
	if language == "" || strings.Contains(language, "中") {
		return "使用简体中文"
	}
	return "使用「" + language + "」书写"
}

func decodeEcommerceListingPlan(raw string, types []ecommerceListingPlanTypeIn) (*ecommerceListingPlan, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var plan ecommerceListingPlan
	if err := json.Unmarshal([]byte(text[start:end+1]), &plan); err != nil {
		return nil, err
	}
	byID := make(map[string]ecommerceListingPlanItem, len(plan.Items))
	for _, item := range plan.Items {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		if _, dup := byID[id]; dup {
			continue
		}
		byID[id] = item
	}
	items := make([]ecommerceListingPlanItem, 0, len(types))
	filled := 0
	for _, typ := range types {
		item := byID[typ.ID]
		headline := truncateEcommerceBrief(strings.TrimSpace(item.Headline), 24)
		direction := truncateEcommerceBrief(strings.TrimSpace(item.Direction), 120)
		// 无文案套图只有构图方向，同样算有效策划
		if headline != "" || direction != "" {
			filled++
		}
		items = append(items, ecommerceListingPlanItem{
			ID:        typ.ID,
			Headline:  headline,
			Subline:   truncateEcommerceBrief(strings.TrimSpace(item.Subline), 40),
			Direction: direction,
		})
	}
	if filled == 0 {
		return nil, fmt.Errorf("empty listing plan")
	}
	plan.Items = items
	plan.Summary = truncateEcommerceBrief(strings.TrimSpace(plan.Summary), 60)
	return &plan, nil
}
