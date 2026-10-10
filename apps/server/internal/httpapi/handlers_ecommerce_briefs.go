package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/sync/semaphore"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// briefs 在 API 进程内同步调用 LLM。慢上游会长时间占住 API 连接，这里用
// 进程内信号量限制并发，超限直接 429，避免拖垮其他接口；单次调用另设独立
// 超时，不跟随上游 provider 配置的（可能长达数百秒的）超时。
const ecommerceBriefTimeout = 60 * time.Second

var ecommerceBriefSemaphore = semaphore.NewWeighted(6)

type ecommerceProductBriefIn struct {
	InputKeys             []string `json:"inputKeys"`
	Platform              string   `json:"platform"`
	Market                string   `json:"market"`
	Language              string   `json:"language"`
	PreviousProductName   string   `json:"previousProductName"`
	PreviousSellingPoints string   `json:"previousSellingPoints"`
	// 商品套图「AI 帮写」：按 产品名称 / 核心卖点 / 适用人群 / 期望场景 / 具体参数 写完整产品信息，
	// 并以用户已填写的 CurrentInfo 为事实依据补全，而不是推翻重写
	Detailed    bool   `json:"detailed"`
	CurrentInfo string `json:"currentInfo"`
}

type ecommerceProductBrief struct {
	ProductName   string `json:"productName"`
	SellingPoints string `json:"sellingPoints"`
}

// 模型偶尔把卖点 / 人群等字段返回成数组，这里统一折叠成多行文本
type ecommerceBriefText string

func (t *ecommerceBriefText) UnmarshalJSON(raw []byte) error {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		*t = ecommerceBriefText(text)
		return nil
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err == nil {
		lines := make([]string, 0, len(list))
		for _, item := range list {
			if item = strings.TrimSpace(item); item != "" {
				lines = append(lines, item)
			}
		}
		*t = ecommerceBriefText(strings.Join(lines, "\n"))
		return nil
	}
	*t = ""
	return nil
}

type ecommerceProductBriefReply struct {
	ProductName   ecommerceBriefText `json:"productName"`
	SellingPoints ecommerceBriefText `json:"sellingPoints"`
	Audience      ecommerceBriefText `json:"audience"`
	Scenes        ecommerceBriefText `json:"scenes"`
	Specs         ecommerceBriefText `json:"specs"`
}

type ecommerceCatalogTitle struct {
	Title string `json:"title"`
}

func (s *Server) adminAnalyzeEcommerceCatalogImage(c *gin.Context, _ *store.User) {
	data, _, contentType, err := s.readTryonCatalogImage(c)
	if err != nil {
		fail(c, err)
		return
	}
	kind, err := parseTryonCatalogKind(c.PostForm("kind"), false)
	if err != nil {
		fail(c, err)
		return
	}
	client, err := s.adminImageAnalysisClient(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}

	kindLabel := map[string]string{
		"model": "人物模特", "scene": "拍摄场景", "garment": "服装商品", "hand": "手部姿态",
	}[kind]
	prompt := fmt.Sprintf(`你是电商素材归档助手。请识别图片中的主体，为这张%s素材生成一个便于运营人员检索和选择的简体中文标题。

规则：
1. 标题必须准确描述图片中真实可见的主体和关键特征，不得虚构品牌、材质、身份或用途。
2. 标题简洁自然，建议 4-12 个汉字，最长不超过 32 个字符。
3. 不使用“图片”“素材”“照片”等无信息量词语，不添加序号、引号或标点结尾。
4. 只返回 JSON，不要 Markdown、代码围栏或解释。格式必须是：{"title":"..."}。`, fallbackBriefContext(kindLabel, "电商"))

	if !ecommerceBriefSemaphore.TryAcquire(1) {
		fail(c, apperr.E("busy", "当前分析请求过多，请稍后再试", 429))
		return
	}
	defer ecommerceBriefSemaphore.Release(1)
	llmCtx, cancel := context.WithTimeout(c.Request.Context(), ecommerceBriefTimeout)
	defer cancel()
	imageURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
	reply, err := client.ChatTextWithImages(llmCtx, []sub2api.Message{{Role: "user", Content: prompt}}, []string{imageURL}, nil)
	if err != nil {
		fail(c, assistantUpstreamError(err))
		return
	}
	title, err := decodeEcommerceCatalogTitle(reply)
	if err != nil {
		fail(c, apperr.E("assistant_bad_response", "AI 未能生成有效素材标题，请重试", 502))
		return
	}
	ok(c, title)
}

func (s *Server) generateEcommerceProductBrief(c *gin.Context) {
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
	var body ecommerceProductBriefIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.InputKeys) == 0 {
		fail(c, apperr.E("validation_error", "请先上传商品参考图", 422))
		return
	}
	inspect := func(ctx context.Context, key string, maxBytes int64) (int64, error) {
		return s.inspectOwnedTaskImage(ctx, user.ID, key, maxBytes)
	}
	if err := validateTaskImageKeys(c.Request.Context(), user.ID, "inputKeys", body.InputKeys, 4, s.Cfg.UploadMaxBytes, 24<<20, inspect, isAllowedTaskInputImageKey); err != nil {
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

	previous := ""
	if strings.TrimSpace(body.PreviousProductName) != "" || strings.TrimSpace(body.PreviousSellingPoints) != "" {
		previous = fmt.Sprintf("\n上一版名称：%s\n上一版卖点：%s\n请重新分析并换一种准确表达，不要照抄上一版。",
			strings.TrimSpace(body.PreviousProductName), strings.TrimSpace(body.PreviousSellingPoints))
	}
	prompt := buildEcommerceProductBriefPrompt(body, previous)

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
	brief, err := decodeEcommerceProductBrief(reply, body.Detailed)
	if err != nil {
		fail(c, apperr.E("assistant_bad_response", "AI 未能整理出有效商品信息，请重新生成", 502))
		return
	}
	ok(c, brief)
}

func selectEcommerceAnalysisModel(cfg modelconfig.Config) (*modelconfig.Selection, bool) {
	return modelconfig.SelectPublicForWorkspace(
		cfg, modelconfig.WorkspaceEcommerce, modelconfig.ModelKindChat, "",
	)
}

func (s *Server) ecommerceAnalysisClient(ctx context.Context) (*sub2api.Client, error) {
	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	selection, ok := selectEcommerceAnalysisModel(cfg)
	if !ok {
		return nil, apperr.E("assistant_unavailable", "AI 电商商品分析模型尚未配置", http.StatusServiceUnavailable)
	}
	return s.analysisClientForSelection(selection)
}

func fallbackBriefContext(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}

// 「无需文案」只说明图上不放字，商品信息仍按简体中文整理
func ecommerceBriefLanguage(language string) string {
	if listingWithoutCopy(language) {
		return "简体中文"
	}
	return fallbackBriefContext(language, "简体中文")
}

func buildEcommerceProductBriefPrompt(body ecommerceProductBriefIn, previous string) string {
	context := fmt.Sprintf("目标平台：%s\n目标市场：%s\n输出语言：%s",
		fallbackBriefContext(body.Platform, "通用电商"), fallbackBriefContext(body.Market, "通用市场"),
		ecommerceBriefLanguage(body.Language))
	if !body.Detailed {
		return fmt.Sprintf(`你是电商商品信息识别助手。请只根据参考图片中真实可见的信息识别商品，并生成可直接用于电商图片制作的商品名称和核心卖点。
%s

规则：
1. 商品名称简洁明确，不超过 60 个字符。
2. 核心卖点写 3-6 行，每行一个具体卖点，总计不超过 600 个字符。
3. 不得虚构图片中无法确认的品牌、型号、材质、尺寸、性能参数或认证。
4. 看不清的文字不要猜测；不确定的信息使用客观通用表述或省略。
5. 只返回 JSON，不要 Markdown、代码围栏或解释。格式必须是：{"productName":"...","sellingPoints":"..."}。%s`, context, previous)
	}
	current := truncateEcommerceBrief(strings.TrimSpace(body.CurrentInfo), 1000)
	currentLine := "用户尚未填写产品信息。"
	if current != "" {
		currentLine = "用户已填写的产品信息（视为确定事实，必须保留其中的名称、参数和卖点，只做补全与润色，不得改写数值）：\n" + current
	}
	return fmt.Sprintf(`你是资深电商运营。请根据商品参考图片和用户已填写的信息，整理一份用于生成电商套图的完整产品信息。
%s
%s

规则：
1. productName：商品名称，简洁明确，不超过 40 个字符。
2. sellingPoints：3-5 条核心卖点，每条一行、一句话，突出差异化优势。
3. audience：适用人群，1-2 句。
4. scenes：期望的使用 / 拍摄场景，2-4 个，用顿号分隔。
5. specs：具体参数（尺寸、容量、材质、颜色、配件等），只写图片或用户信息里能确认的；无法确认时写空字符串，不得编造数值、品牌、型号或认证。
6. 看不清的文字不要猜测。全部字段合计不超过 700 个字符。
7. 只返回 JSON，不要 Markdown、代码围栏或解释。格式：{"productName":"...","sellingPoints":"...","audience":"...","scenes":"...","specs":"..."}。%s`, context, currentLine, previous)
}

func decodeEcommerceProductBrief(raw string, detailed bool) (*ecommerceProductBrief, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var reply ecommerceProductBriefReply
	if err := json.Unmarshal([]byte(text[start:end+1]), &reply); err != nil {
		return nil, err
	}
	brief := ecommerceProductBrief{
		ProductName:   strings.TrimSpace(string(reply.ProductName)),
		SellingPoints: strings.TrimSpace(string(reply.SellingPoints)),
	}
	if brief.ProductName == "" || brief.SellingPoints == "" {
		return nil, fmt.Errorf("empty product brief")
	}
	brief.ProductName = truncateEcommerceBrief(brief.ProductName, 60)
	if detailed {
		// 套图「产品信息」框：按参考格式拼成分段文本，用户确认后直接填入
		sections := []string{"产品名称：" + brief.ProductName, "核心卖点：\n" + brief.SellingPoints}
		for _, part := range []struct{ label, value string }{
			{"适用人群", string(reply.Audience)},
			{"期望场景", string(reply.Scenes)},
			{"具体参数", string(reply.Specs)},
		} {
			if value := strings.TrimSpace(part.value); value != "" {
				sections = append(sections, part.label+"："+value)
			}
		}
		brief.SellingPoints = strings.Join(sections, "\n")
	}
	limit := 1200
	if detailed {
		limit = 1000 // 套图产品信息框上限
	}
	brief.SellingPoints = truncateEcommerceBrief(brief.SellingPoints, limit)
	return &brief, nil
}

func decodeEcommerceCatalogTitle(raw string) (*ecommerceCatalogTitle, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var result ecommerceCatalogTitle
	if err := json.Unmarshal([]byte(text[start:end+1]), &result); err != nil {
		return nil, err
	}
	result.Title = strings.TrimSpace(result.Title)
	if result.Title == "" {
		return nil, fmt.Errorf("empty catalog title")
	}
	result.Title = truncateEcommerceBrief(result.Title, 32)
	return &result, nil
}

func truncateEcommerceBrief(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
