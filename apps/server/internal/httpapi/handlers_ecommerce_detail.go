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

// AI 详情页“先策划再生成”：文本模型基于商品图（可附模特 / 细节 / 证书 / 配件参考）
// 诊断买家痛点，并为每个出图方向写出主标题、副文案与构图方向。
// 平台为 Amazon 时额外带入站点 / 档位 / ASIN 语境，让文案服从 A+ 合规。
const (
	ecommerceDetailPlanMaxTypes      = 20
	ecommerceDetailPlanMaxExtraKeys  = 3
	ecommerceDetailPlanMaxPainPoints = 6
)

type ecommerceDetailPlanAmazonIn struct {
	MarketplaceID  string `json:"marketplaceId"`
	Tier           string `json:"tier"`
	ASIN           string `json:"asin"`
	CompetitorASIN string `json:"competitorAsin"`
}

type ecommerceDetailPlanIn struct {
	InputKeys     []string                     `json:"inputKeys"`
	ExtraKeys     []string                     `json:"extraKeys"`
	Platform      string                       `json:"platform"`
	Market        string                       `json:"market"`
	Language      string                       `json:"language"`
	Style         string                       `json:"style"`
	Category      string                       `json:"category"`
	ProductName   string                       `json:"productName"`
	SellingPoints string                       `json:"sellingPoints"`
	Note          string                       `json:"note"`
	Types         []ecommerceListingPlanTypeIn `json:"types"`
	Amazon        *ecommerceDetailPlanAmazonIn `json:"amazon"`
}

type ecommerceDetailPlan struct {
	Summary    string                     `json:"summary"`
	PainPoints []string                   `json:"painPoints"`
	Items      []ecommerceListingPlanItem `json:"items"`
}

func (s *Server) generateEcommerceDetailPlan(c *gin.Context) {
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
	var body ecommerceDetailPlanIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.InputKeys) == 0 {
		fail(c, apperr.E("validation_error", "请先上传商品参考图", 422))
		return
	}
	if len(body.ExtraKeys) > ecommerceDetailPlanMaxExtraKeys {
		fail(c, apperr.E("validation_error", fmt.Sprintf("补充参考图最多 %d 张", ecommerceDetailPlanMaxExtraKeys), 422))
		return
	}
	types, err := normalizeEcommercePlanTypes(body.Types, ecommerceDetailPlanMaxTypes, "出图方向")
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
	if len(body.ExtraKeys) > 0 {
		if err := validateTaskImageKeys(c.Request.Context(), user.ID, "extraKeys", body.ExtraKeys, ecommerceDetailPlanMaxExtraKeys, s.Cfg.UploadMaxBytes, 24<<20, inspect, isAllowedTaskInputImageKey); err != nil {
			fail(c, err)
			return
		}
	}
	allKeys := append(append([]string{}, body.InputKeys...), body.ExtraKeys...)
	imageURLs := make([]string, 0, len(allKeys))
	for _, key := range allKeys {
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
	prompt := buildEcommerceDetailPlanPrompt(body, types)

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
	plan, err := decodeEcommerceDetailPlan(reply, types)
	if err != nil {
		fail(c, apperr.E("assistant_bad_response", "AI 未能完成详情页策划，请重试", 502))
		return
	}
	ok(c, plan)
}

func buildEcommerceDetailPlanPrompt(body ecommerceDetailPlanIn, types []ecommerceListingPlanTypeIn) string {
	var list strings.Builder
	for index, item := range types {
		label := item.Label
		if label == "" {
			label = item.ID
		}
		fmt.Fprintf(&list, "%d. id=%s，版块：%s", index+1, item.ID, label)
		if item.Direction != "" {
			fmt.Fprintf(&list, "，职责：%s", item.Direction)
		}
		list.WriteString("\n")
	}
	var extra strings.Builder
	if len(body.ExtraKeys) > 0 {
		fmt.Fprintf(&extra, "前 %d 张是商品图，其后 %d 张是用户补充的参考图（模特 / 细节 / 证书 / 配件等），只作为对应版块的事实依据。\n", len(body.InputKeys), len(body.ExtraKeys))
	}
	if note := truncateEcommerceBrief(strings.TrimSpace(body.Note), ecommerceListingPlanMaxNoteRunes); note != "" {
		extra.WriteString("用户补充描述：" + note + "\n")
	}
	if category := truncateEcommerceBrief(strings.TrimSpace(body.Category), 40); category != "" {
		extra.WriteString("商品品类：" + category + "\n")
	}
	if style := truncateEcommerceBrief(strings.TrimSpace(body.Style), 40); style != "" {
		extra.WriteString("视觉风格：" + style + "\n")
	}
	if body.Amazon != nil {
		asin := strings.ToUpper(strings.TrimSpace(body.Amazon.ASIN))
		competitor := strings.ToUpper(strings.TrimSpace(body.Amazon.CompetitorASIN))
		fmt.Fprintf(&extra, "Amazon A+ 语境：站点 %s，档位 %s",
			fallbackBriefContext(truncateEcommerceBrief(body.Amazon.MarketplaceID, 8), "US"),
			fallbackBriefContext(truncateEcommerceBrief(body.Amazon.Tier, 12), "basic"))
		if asin != "" {
			fmt.Fprintf(&extra, "，ASIN %s", truncateEcommerceBrief(asin, 12))
		}
		if competitor != "" {
			fmt.Fprintf(&extra, "，竞品 ASIN %s（只借鉴版块结构，禁止抄品牌与文案）", truncateEcommerceBrief(competitor, 12))
		}
		extra.WriteString("。文案须服从 A+ 规范：无价格、无极限词、无外链、无未证实的认证。\n")
	}
	return fmt.Sprintf(`你是电商详情页策划。请只根据商品参考图中真实可见的信息和下面的商品资料，先诊断买家在下单前最关心的痛点，再为每个出图方向策划一张版块图的文案与构图。
目标平台：%s
目标市场：%s
文案语言：%s
商品名称：%s
商品卖点与参数：%s
%s
需要策划的出图方向（按顺序，id 必须原样返回）：
%s
规则：
1. painPoints 列出 3-6 条买家痛点，每条最长 12 个字符，%s，必须能从商品品类与参考图推断，不写空话。
2. headline 是版块主标题，%s，最长 24 个字符；subline 是副文案，最长 40 个字符，可为空字符串。
3. direction 用简体中文写 1-2 句具体的构图与视觉方向：主体位置、场景、光线、需要放大的细节或信息区安排，最长 120 个字符。
4. 不得虚构参考图和资料里无法确认的参数、认证、销量、评价、折扣、价格或日期；版块本身需要这类信息而资料没有提供时，headline 写通用表述并在 direction 里说明保留占位区。
5. 各版块文案不重复、事实一致，整页按“先回应痛点，再给证明，最后收束信任”的顺序推进；主标题要像真实详情页文案，不要口号堆叠。
6. summary 用一句话（最长 60 个字符）概括整页的视觉主线。
7. 只返回 JSON，不要 Markdown、代码围栏或解释。格式必须是：{"summary":"...","painPoints":["..."],"items":[{"id":"...","headline":"...","subline":"...","direction":"..."}]}，items 必须覆盖上面每一个 id。`,
		fallbackBriefContext(body.Platform, "通用电商"),
		fallbackBriefContext(body.Market, "通用市场"),
		fallbackBriefContext(body.Language, "简体中文"),
		fallbackBriefContext(body.ProductName, "根据商品图片准确识别"),
		fallbackBriefContext(truncateEcommerceBrief(strings.TrimSpace(body.SellingPoints), 1200), "未提供，只能使用图片中可确认的信息"),
		extra.String(),
		list.String(),
		listingHeadlineLanguageHint(body.Language),
		listingHeadlineLanguageHint(body.Language),
	)
}

func decodeEcommerceDetailPlan(raw string, types []ecommerceListingPlanTypeIn) (*ecommerceDetailPlan, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var plan ecommerceDetailPlan
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
		return nil, fmt.Errorf("empty detail plan")
	}
	plan.Items = items
	plan.Summary = truncateEcommerceBrief(strings.TrimSpace(plan.Summary), 60)
	points := make([]string, 0, ecommerceDetailPlanMaxPainPoints)
	seen := make(map[string]struct{}, ecommerceDetailPlanMaxPainPoints)
	for _, point := range plan.PainPoints {
		value := truncateEcommerceBrief(strings.TrimSpace(point), 12)
		if value == "" {
			continue
		}
		if _, dup := seen[value]; dup {
			continue
		}
		seen[value] = struct{}{}
		points = append(points, value)
		if len(points) >= ecommerceDetailPlanMaxPainPoints {
			break
		}
	}
	plan.PainPoints = points
	return &plan, nil
}
