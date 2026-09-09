package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/aplus"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

type ecommerceAplusPlanIn struct {
	InputKeys       []string `json:"inputKeys"`
	ASIN            string   `json:"asin"`
	CompetitorASIN  string   `json:"competitorAsin"`
	CategoryID      string   `json:"categoryId"`
	MarketplaceID   string   `json:"marketplaceId"`
	Language        string   `json:"language"`
	Tier            string   `json:"tier"`
	ProductName     string   `json:"productName"`
	SellingPoints   string   `json:"sellingPoints"`
	SelectedModules []string `json:"selectedModules"`
	Disclosure      bool     `json:"disclosure"`
}

func (s *Server) ecommerceAplusCatalog(c *gin.Context) {
	if _, err := s.requireUser(c); err != nil {
		fail(c, err)
		return
	}
	ok(c, aplus.Catalog())
}

func (s *Server) generateEcommerceAplusPlan(c *gin.Context) {
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
	var body ecommerceAplusPlanIn
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
	req := aplus.Request{
		ASIN:            body.ASIN,
		CompetitorASIN:  body.CompetitorASIN,
		CategoryID:      body.CategoryID,
		MarketplaceID:   body.MarketplaceID,
		Language:        body.Language,
		Tier:            body.Tier,
		ProductName:     body.ProductName,
		SellingPoints:   body.SellingPoints,
		SelectedModules: body.SelectedModules,
		Disclosure:      body.Disclosure,
	}
	fallback := aplus.DefaultPlan(req.CategoryID, req.MarketplaceID, req.Tier, req.ProductName)
	fallback.ASIN = strings.ToUpper(strings.TrimSpace(req.ASIN))
	fallback.CompetitorASIN = strings.ToUpper(strings.TrimSpace(req.CompetitorASIN))
	fallback.Disclosure = req.Disclosure

	client, err := s.ecommerceAnalysisClient(c.Request.Context())
	if err != nil {
		ok(c, fallback)
		return
	}
	if !ecommerceBriefSemaphore.TryAcquire(1) {
		fail(c, apperr.E("busy", "当前分析请求过多，请稍后再试", 429))
		return
	}
	defer ecommerceBriefSemaphore.Release(1)
	llmCtx, cancel := context.WithTimeout(c.Request.Context(), ecommerceBriefTimeout)
	defer cancel()
	reply, err := client.ChatTextWithImages(llmCtx, []sub2api.Message{{
		Role: "user", Content: aplus.BuildPlannerPrompt(req, fallback),
	}}, imageURLs, nil)
	if err != nil {
		ok(c, fallback)
		return
	}
	plan, err := aplus.DecodePlan(reply, req)
	if err != nil {
		ok(c, fallback)
		return
	}
	ok(c, plan)
}
