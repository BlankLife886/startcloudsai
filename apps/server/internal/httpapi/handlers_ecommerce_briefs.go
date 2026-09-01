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
}

type ecommerceProductBrief struct {
	ProductName   string `json:"productName"`
	SellingPoints string `json:"sellingPoints"`
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

	previous := ""
	if strings.TrimSpace(body.PreviousProductName) != "" || strings.TrimSpace(body.PreviousSellingPoints) != "" {
		previous = fmt.Sprintf("\n上一版名称：%s\n上一版卖点：%s\n请重新分析并换一种准确表达，不要照抄上一版。",
			strings.TrimSpace(body.PreviousProductName), strings.TrimSpace(body.PreviousSellingPoints))
	}
	prompt := fmt.Sprintf(`你是电商商品信息识别助手。请只根据参考图片中真实可见的信息识别商品，并生成可直接用于电商图片制作的商品名称和核心卖点。
目标平台：%s
目标市场：%s
输出语言：%s

规则：
1. 商品名称简洁明确，不超过 60 个字符。
2. 核心卖点写 3-6 行，每行一个具体卖点，总计不超过 600 个字符。
3. 不得虚构图片中无法确认的品牌、型号、材质、尺寸、性能参数或认证。
4. 看不清的文字不要猜测；不确定的信息使用客观通用表述或省略。
5. 只返回 JSON，不要 Markdown、代码围栏或解释。格式必须是：{"productName":"...","sellingPoints":"..."}。%s`,
		fallbackBriefContext(body.Platform, "通用电商"), fallbackBriefContext(body.Market, "通用市场"),
		fallbackBriefContext(body.Language, "简体中文"), previous)

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
	brief, err := decodeEcommerceProductBrief(reply)
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

func decodeEcommerceProductBrief(raw string) (*ecommerceProductBrief, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var brief ecommerceProductBrief
	if err := json.Unmarshal([]byte(text[start:end+1]), &brief); err != nil {
		return nil, err
	}
	brief.ProductName = strings.TrimSpace(brief.ProductName)
	brief.SellingPoints = strings.TrimSpace(brief.SellingPoints)
	if brief.ProductName == "" || brief.SellingPoints == "" {
		return nil, fmt.Errorf("empty product brief")
	}
	brief.ProductName = truncateEcommerceBrief(brief.ProductName, 60)
	brief.SellingPoints = truncateEcommerceBrief(brief.SellingPoints, 1200)
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
