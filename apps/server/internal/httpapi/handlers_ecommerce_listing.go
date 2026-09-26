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
const (
	ecommerceListingPlanMaxTypes     = 18
	ecommerceListingPlanMaxNoteRunes = 2000
)

type ecommerceListingPlanTypeIn struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Direction string `json:"direction"`
}

type ecommerceListingPlanIn struct {
	InputKeys     []string                     `json:"inputKeys"`
	Platform      string                       `json:"platform"`
	Market        string                       `json:"market"`
	Language      string                       `json:"language"`
	ProductName   string                       `json:"productName"`
	SellingPoints string                       `json:"sellingPoints"`
	Note          string                       `json:"note"`
	Types         []ecommerceListingPlanTypeIn `json:"types"`
}

type ecommerceListingPlanItem struct {
	ID        string `json:"id"`
	Headline  string `json:"headline"`
	Subline   string `json:"subline"`
	Direction string `json:"direction"`
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
	types, err := normalizeEcommerceListingPlanTypes(body.Types)
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
	imageURLs := make([]string, 0, len(body.InputKeys))
	for _, key := range body.InputKeys {
		presigned, err := s.Storage.PresignGet(c.Request.Context(), key)
		if err != nil {
			fail(c, apperr.E("image_read_failed", "商品图片读取失败，请重新上传", 422))
			return
		}
		imageURLs = append(imageURLs, presigned)
	}
	client, err := s.ecommerceAnalysisClient(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	prompt := buildEcommerceListingPlanPrompt(body, types)

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
	plan, err := decodeEcommerceListingPlan(reply, types)
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
		fmt.Fprintf(&list, "%d. id=%s，类型：%s", index+1, item.ID, label)
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
商品名称：%s
商品卖点：%s
%s
需要策划的出图类型（按顺序，id 必须原样返回）：
%s
规则：
1. headline 是画面主标题，%s，最长 24 个字符；subline 是副文案，最长 40 个字符，可为空字符串。
2. direction 用简体中文写 1-2 句具体的构图与视觉方向：主体位置、场景、光线、需要放大的细节或信息区安排，最长 120 个字符。
3. 不得虚构参考图和卖点里无法确认的参数、认证、销量、评价、折扣、价格或日期；类型本身需要这类信息而资料没有提供时，headline 写通用表述并在 direction 里说明保留占位区。
4. 各张之间文案不要重复，同一商品事实保持一致；主标题要像真实电商详情页文案，不要口号堆叠。
5. summary 用一句话（最长 60 个字符）概括整套图的视觉主线。
6. 只返回 JSON，不要 Markdown、代码围栏或解释。格式必须是：{"summary":"...","items":[{"id":"...","headline":"...","subline":"...","direction":"..."}]}，items 必须覆盖上面每一个 id。`,
		fallbackBriefContext(body.Platform, "通用电商"),
		fallbackBriefContext(body.Market, "通用市场"),
		fallbackBriefContext(body.Language, "简体中文"),
		fallbackBriefContext(body.ProductName, "根据商品图片准确识别"),
		fallbackBriefContext(truncateEcommerceBrief(strings.TrimSpace(body.SellingPoints), 1200), "未提供，只能使用图片中可确认的信息"),
		noteLine,
		list.String(),
		listingHeadlineLanguageHint(body.Language),
	)
}

func listingHeadlineLanguageHint(language string) string {
	language = strings.TrimSpace(language)
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
		if headline != "" {
			filled++
		}
		items = append(items, ecommerceListingPlanItem{
			ID:        typ.ID,
			Headline:  headline,
			Subline:   truncateEcommerceBrief(strings.TrimSpace(item.Subline), 40),
			Direction: truncateEcommerceBrief(strings.TrimSpace(item.Direction), 120),
		})
	}
	if filled == 0 {
		return nil, fmt.Errorf("empty listing plan")
	}
	plan.Items = items
	plan.Summary = truncateEcommerceBrief(strings.TrimSpace(plan.Summary), 60)
	return &plan, nil
}
