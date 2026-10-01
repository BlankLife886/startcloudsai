package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const tryonGarmentClassifySettingKey = "ecommerce_tryon_garment_classify_enabled"

// ecommerceAIAssist 描述电商里一项 AI 辅助能力“关联到哪里”：
// 谁触发、调哪个接口、用哪个模型（在哪改）、如何限流与计费、能否开关。
type ecommerceAIAssist struct {
	ID          string                  `json:"id"`
	Name        string                  `json:"name"`
	Tool        string                  `json:"tool"`
	Description string                  `json:"description"`
	Trigger     string                  `json:"trigger"`
	Endpoint    string                  `json:"endpoint"`
	ModelSource string                  `json:"modelSource"`
	Model       *ecommerceAIAssistModel `json:"model"`
	ModelError  string                  `json:"modelError,omitempty"`
	RateLimit   string                  `json:"rateLimit"`
	Billing     string                  `json:"billing"`
	Toggleable  bool                    `json:"toggleable"`
	Enabled     bool                    `json:"enabled"`
	OffBehavior string                  `json:"offBehavior,omitempty"`
}

type ecommerceAIAssistModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	UpstreamModel string `json:"upstreamModel"`
}

const ecommerceAnalysisModelSource = "模型配置 › 工作区 › AI 电商 › 商品分析模型（未指定时取该工作区第一个可用的对话模型）"

func (s *Server) tryonGarmentClassifyEnabled(c *gin.Context) bool {
	enabled, err := settings.GetBool(c.Request.Context(), s.St.Pool, tryonGarmentClassifySettingKey)
	if err != nil {
		return true
	}
	return enabled
}

func (s *Server) adminListEcommerceAIAssists(c *gin.Context, _ *store.User) {
	var model *ecommerceAIAssistModel
	modelError := ""
	cfg, err := modelconfig.Runtime(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		modelError = "模型配置读取失败"
	} else if selection, ok := selectEcommerceAnalysisModel(cfg); ok {
		model = &ecommerceAIAssistModel{
			ID:            selection.Model.ID,
			Name:          selection.Model.Name,
			Provider:      selection.Provider.Name,
			UpstreamModel: selection.Model.UpstreamModel,
		}
	} else {
		modelError = "未配置：请在模型配置中为“AI 电商”绑定商品分析模型，否则以下功能都会失败"
	}

	sharedPlanLimit := "与商品识别、套图/详情策划共用：每人每分钟 60 次；全局同时最多 6 个分析请求（与后台素材自动命名共用），超出返回 429"
	items := []ecommerceAIAssist{
		{
			ID:          "tryon-garment-classify",
			Name:        "服装品类识别",
			Tool:        "虚拟试衣",
			Description: "识别服装是上装、下装还是全身（连衣裙/礼服/连体衣），并给出简短名称，用来自动切换品类下拉。",
			Trigger:     "用户在虚拟试衣上传服装图后自动调用；内置服装素材不会触发",
			Endpoint:    "POST /api/v1/commerce/tryon/garment-classifications",
			ModelSource: ecommerceAnalysisModelSource,
			RateLimit:   "每人每分钟 30 次（独立计数）；全局同时最多 6 个分析请求（与其他电商分析共用）",
			Billing:     "不扣用户积分；每次调用消耗一次商品分析模型的上游额度",
			Toggleable:  true,
			Enabled:     s.tryonGarmentClassifyEnabled(c),
			OffBehavior: "关闭后上传服装不再识别，品类保持用户手动选择，不影响生成",
		},
		{
			ID:          "handheld-product-classify",
			Name:        "手持商品识别",
			Tool:        "手持商品",
			Description: "识别商品品类（决定默认握法），并按图中比例估计实物尺寸，用来预填品类与尺寸。",
			Trigger:     "用户在手持商品上传商品图后自动调用",
			Endpoint:    "POST /api/v1/commerce/handheld/product-classifications",
			ModelSource: ecommerceAnalysisModelSource,
			RateLimit:   "每人每分钟 30 次（独立计数）；全局同时最多 6 个分析请求（与其他电商分析共用）",
			Billing:     "不扣用户积分；每次调用消耗一次商品分析模型的上游额度",
			Toggleable:  true,
			Enabled:     s.handheldProductClassifyEnabled(c),
			OffBehavior: "关闭后上传商品不再识别，品类与尺寸保持用户手动选择，不影响生成",
		},
		{
			ID:          "product-brief",
			Name:        "AI 商品识别",
			Tool:        "商拍 / 套图 / 营销图等",
			Description: "根据商品图生成商品名称与核心卖点，用户确认后填入。",
			Trigger:     "用户点击“AI 生成商品信息”时调用",
			Endpoint:    "POST /api/v1/commerce/product-briefs",
			ModelSource: ecommerceAnalysisModelSource,
			RateLimit:   sharedPlanLimit,
			Billing:     "不扣用户积分",
		},
		{
			ID:          "listing-plan",
			Name:        "商品套图策划",
			Tool:        "商品套图",
			Description: "按选中的出图类型策划每张图的文案与构图，再逐张出图。",
			Trigger:     "用户在商品套图点击策划或生成时调用",
			Endpoint:    "POST /api/v1/commerce/listing-plans",
			ModelSource: ecommerceAnalysisModelSource,
			RateLimit:   sharedPlanLimit,
			Billing:     "不扣用户积分",
		},
		{
			ID:          "detail-plan",
			Name:        "详情页 / A+ 策划",
			Tool:        "A+ / 详情页",
			Description: "分析买家痛点，策划详情页每个版块的文案与构图。",
			Trigger:     "用户在 A+ / 详情页点击策划或生成时调用",
			Endpoint:    "POST /api/v1/commerce/detail-plans、POST /api/v1/commerce/aplus-plans",
			ModelSource: ecommerceAnalysisModelSource,
			RateLimit:   sharedPlanLimit,
			Billing:     "不扣用户积分",
		},
	}
	for index := range items {
		items[index].Model = model
		items[index].ModelError = modelError
		if !items[index].Toggleable {
			items[index].Enabled = true
		}
	}
	ok(c, gin.H{"items": items})
}

type ecommerceAIAssistUpdate struct {
	Enabled *bool `json:"enabled"`
}

func (s *Server) adminUpdateEcommerceAIAssist(c *gin.Context, _ *store.User) {
	id := strings.TrimSpace(c.Param("id"))
	settingKey := map[string]string{
		"tryon-garment-classify":    tryonGarmentClassifySettingKey,
		"handheld-product-classify": handheldProductClassifySettingKey,
	}[id]
	if settingKey == "" {
		fail(c, apperr.E("not_toggleable", "该功能暂不支持开关", http.StatusBadRequest))
		return
	}
	var body ecommerceAIAssistUpdate
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Enabled == nil {
		fail(c, apperr.E("validation_error", "缺少 enabled", 422))
		return
	}
	raw, _ := json.Marshal(*body.Enabled)
	if err := settings.Set(c.Request.Context(), s.St.Pool, settingKey, raw); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"id": id, "enabled": *body.Enabled})
}
