package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// 识别只是上传后的辅助提示，比规划类接口轻得多，单独限流，不占 plan 配额。
const tryonGarmentClassifyPerMinute = 30

// 读取服装图的上限；前端上传前已压缩到约 2MB
const tryonGarmentClassifyMaxBytes = 12 << 20

var tryonApparelValues = map[string]bool{"上装": true, "下装": true, "全身": true}

type tryonGarmentClassifyIn struct {
	InputKey string `json:"inputKey"`
}

type tryonGarmentClassification struct {
	Apparel string `json:"apparel"`
	Label   string `json:"label"`
}

func (s *Server) classifyTryonGarment(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	// 后台“AI 电商 › AI 辅助功能”可关闭；关闭时前端静默跳过识别
	if !s.tryonGarmentClassifyEnabled(c) {
		fail(c, apperr.E("feature_disabled", "服装识别已关闭", http.StatusForbidden))
		return
	}
	if !s.enforceUsageLimit(c, "ecommerce-tryon-classify-minute", user.ID.String(), tryonGarmentClassifyPerMinute, 1, time.Minute) {
		return
	}
	if s.Storage == nil {
		fail(c, apperr.E("storage_unavailable", "图片存储服务暂不可用", http.StatusServiceUnavailable))
		return
	}
	var body tryonGarmentClassifyIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	key := strings.TrimSpace(body.InputKey)
	if key == "" {
		fail(c, apperr.E("validation_error", "请先上传服装图", 422))
		return
	}
	inspect := func(ctx context.Context, key string, maxBytes int64) (int64, error) {
		return s.inspectOwnedTaskImage(ctx, user.ID, key, maxBytes)
	}
	if err := validateTaskImageKeys(c.Request.Context(), user.ID, "inputKey", []string{key}, 1, s.Cfg.UploadMaxBytes, 24<<20, inspect, isAllowedTaskInputImageKey); err != nil {
		fail(c, err)
		return
	}
	// 直接读取图片内容，以 data URL 发给模型：预签名链接在本地环境是 127.0.0.1，
	// 远端模型服务访问不到，会导致识别必然失败（与后台素材自动命名的做法一致）
	data, err := s.Storage.GetBytesLimit(c.Request.Context(), key, tryonGarmentClassifyMaxBytes)
	if err != nil || len(data) == 0 {
		log.Printf("tryon garment classify: read %s: %v", key, err)
		fail(c, apperr.E("image_read_failed", "服装图片读取失败，请重新上传", 422))
		return
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		fail(c, apperr.E("image_read_failed", "服装图片格式无效，请重新上传", 422))
		return
	}
	imageURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
	client, err := s.ecommerceAnalysisClient(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	prompt := `你是服装电商归类助手。判断图片中的服装应以哪种方式穿到模特身上。

apparel 只能是以下之一：
- "上装"：T恤、衬衫、毛衣、外套、背心等只覆盖上半身的单品
- "下装"：裤子、半身裙、短裤等只覆盖下半身的单品
- "全身"：连衣裙、礼服、连体衣、或同一张图里已成套的上下装

label 用 2-10 个汉字描述真实可见的款式与颜色，例如"深蓝蕾丝长礼服"，不得虚构品牌。
只返回 JSON，不要 Markdown 或解释：{"apparel":"...","label":"..."}`

	if !ecommerceBriefSemaphore.TryAcquire(1) {
		fail(c, apperr.E("busy", "当前分析请求过多，请稍后再试", 429))
		return
	}
	defer ecommerceBriefSemaphore.Release(1)
	llmCtx, cancel := context.WithTimeout(c.Request.Context(), ecommerceBriefTimeout)
	defer cancel()
	reply, err := client.ChatTextWithImages(llmCtx, []sub2api.Message{{Role: "user", Content: prompt}}, []string{imageURL}, nil)
	if err != nil {
		log.Printf("tryon garment classify: upstream error: %v", err)
		fail(c, assistantUpstreamError(err))
		return
	}
	result, err := decodeTryonGarmentClassification(reply)
	if err != nil {
		log.Printf("tryon garment classify: bad reply (%v): %.300q", err, reply)
		fail(c, apperr.E("assistant_bad_response", "未能识别服装类型，请手动选择", 502))
		return
	}
	ok(c, result)
}

func decodeTryonGarmentClassification(raw string) (*tryonGarmentClassification, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("missing JSON object")
	}
	var result tryonGarmentClassification
	if err := json.Unmarshal([]byte(text[start:end+1]), &result); err != nil {
		return nil, err
	}
	result.Apparel = strings.TrimSpace(result.Apparel)
	if !tryonApparelValues[result.Apparel] {
		return nil, fmt.Errorf("unknown apparel %q", result.Apparel)
	}
	result.Label = truncateEcommerceBrief(strings.TrimSpace(result.Label), 16)
	return &result, nil
}
