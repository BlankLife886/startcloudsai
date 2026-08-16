// Package httpapi 注册 Gin 路由与 handler（auth, me, tasks, uploads, files,
// plans, orders, gallery, meta, admin），并挂载统一响应/错误中间件。
package httpapi

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/promptsync"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

var writeMethods = map[string]bool{"POST": true, "PATCH": true, "DELETE": true, "PUT": true}

func requestBodyLimit(path string, uploadMaxBytes int64) int64 {
	limit := int64(1 << 20)
	switch {
	case path == "/api/v1/uploads":
		return uploadMaxBytes + (1 << 20)
	case strings.HasPrefix(path, "/api/v1/assistant/"):
		return 20 << 20
	case strings.HasPrefix(path, "/api/v1/canvas-projects"):
		return 5 << 20
	case strings.HasPrefix(path, "/api/v1/admin/prompts/") && strings.HasSuffix(path, "/cover"):
		// multipart 边界和字段会产生少量额外开销，不能直接使用图片净大小。
		return promptCoverMaxBytes + (1 << 20)
	case strings.HasPrefix(path, "/api/v1/admin/prompt-import-batches/") && strings.HasSuffix(path, "/cover"):
		return promptCoverMaxBytes + (1 << 20)
	case strings.HasPrefix(path, "/api/v1/admin/ecommerce/catalog"),
		strings.HasPrefix(path, "/api/v1/admin/ecommerce/tryon-catalog"):
		return tryonCatalogMaxBytes + (1 << 20)
	case path == "/api/v1/admin/prompt-import-batches/upload":
		return promptTransferMaxBytes + (1 << 20)
	default:
		return limit
	}
}

type Server struct {
	Cfg               *config.Config
	St                *store.Store
	Storage           *storage.Storage
	C2A               *c2a.Client
	Queue             *taskflow.Queue
	LoginLimiter      auth.AttemptLimiter
	AdminLoginLimiter auth.AttemptLimiter
	RedeemLimiter     auth.AttemptLimiter
	PromptSync        *promptsync.Engine
	Metrics           *systemMetrics
	limiterClosers    []func() error
}

func New(cfg *config.Config, st *store.Store, stg *storage.Storage, c2aClient *c2a.Client, queue *taskflow.Queue) (*Server, error) {
	s := &Server{
		Cfg:               cfg,
		St:                st,
		Storage:           stg,
		C2A:               c2aClient,
		Queue:             queue,
		LoginLimiter:      auth.NewLoginLimiter(),
		AdminLoginLimiter: auth.NewLoginLimiter(),
		RedeemLimiter:     auth.NewRedeemLimiter(),
		PromptSync:        promptsync.New(st, cfg.AppEnv == "development"),
		Metrics:           newSystemMetrics(time.Now()),
	}
	if cfg.AppEnv == "production" {
		login, err := auth.NewRedisLoginLimiter(cfg.RedisURL, "user-login", false)
		if err != nil {
			return nil, err
		}
		admin, err := auth.NewRedisLoginLimiter(cfg.RedisURL, "admin-login", false)
		if err != nil {
			_ = login.Close()
			return nil, err
		}
		redeem, err := auth.NewRedisLoginLimiter(cfg.RedisURL, "redeem", true)
		if err != nil {
			_ = login.Close()
			_ = admin.Close()
			return nil, err
		}
		s.LoginLimiter, s.AdminLoginLimiter, s.RedeemLimiter = login, admin, redeem
		s.limiterClosers = []func() error{login.Close, admin.Close, redeem.Close}
	}
	return s, nil
}

func (s *Server) Close() {
	for _, closeLimiter := range s.limiterClosers {
		_ = closeLimiter()
	}
}

func (s *Server) Router() *gin.Engine {
	if s.Metrics == nil {
		s.Metrics = newSystemMetrics(time.Now())
	}
	if s.Cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	// C3：只信任 TRUSTED_PROXIES（默认 compose 内网网段）设置的 X-Forwarded-For，
	// 防止公网伪造来源 IP 绕过限流/污染审计日志
	if err := r.SetTrustedProxies(s.Cfg.TrustedProxiesList()); err != nil {
		log.Printf("invalid TRUSTED_PROXIES %q: %v", s.Cfg.TrustedProxies, err)
	}
	r.HandleMethodNotAllowed = true
	r.Use(gin.Logger())
	r.Use(s.requestMetricsMiddleware)
	r.Use(gin.CustomRecovery(func(c *gin.Context, err any) {
		log.Printf("panic on %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
		c.AbortWithStatusJSON(500, gin.H{"success": false, "code": "internal_error", "error": "服务器内部错误"})
	}))
	r.Use(func(c *gin.Context) {
		limit := requestBodyLimit(c.Request.URL.Path, s.Cfg.UploadMaxBytes)
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	})
	r.Use(s.originGuard)

	r.NoRoute(func(c *gin.Context) {
		c.JSON(404, gin.H{"success": false, "code": "not_found", "error": "Not Found"})
	})
	r.NoMethod(func(c *gin.Context) {
		c.JSON(405, gin.H{"success": false, "code": "bad_request", "error": "Method Not Allowed"})
	})

	api := r.Group("/api/v1")

	// auth
	api.GET("/auth/providers", s.authProviders)
	api.POST("/auth/email-verification-codes", s.requestEmailLoginCode)
	api.POST("/auth/session", s.verifyEmailCode)
	api.GET("/auth/session", s.authMe)
	api.DELETE("/auth/session", s.logout)
	api.GET("/trial-access-campaign", s.trialAccessCampaign)

	// assistant workspace (Sub2API server-side bridge)
	api.GET("/assistant/config", s.assistantConfig)
	// 遗留直连端点已下线：免费且无限额,前端零引用（生图/对话统一走 /assistant/runs）
	// api.POST("/assistant/chat", s.assistantChat)
	// api.POST("/assistant/images", s.assistantImages)
	api.GET("/assistant/conversations", s.assistantConversations)
	api.POST("/assistant/conversations", s.createAssistantConversation)
	api.DELETE("/assistant/conversations/:id", s.deleteAssistantConversation)
	api.POST("/assistant/conversations/:id/context-boundaries", s.createAssistantContextBoundary)
	api.DELETE("/assistant/messages/:id", s.deleteAssistantMessage)
	api.POST("/assistant/conversation-imports", s.importAssistantConversations)
	api.GET("/assistant/runs", s.assistantRuns)
	api.POST("/assistant/runs", s.createAssistantRun)
	api.GET("/assistant/runs/:id", s.assistantRun)
	api.GET("/assistant/runs/:id/events", s.assistantRunStream)
	api.PATCH("/assistant/runs/:id", s.patchAssistantRun)

	// me
	api.PATCH("/me/profile", s.patchProfile)
	api.GET("/me/overview", s.overview)
	api.GET("/me/wallet", s.myWallet)
	api.GET("/me/subscription", s.mySubscription)
	api.GET("/me/wallet/entries", s.myLedger)
	api.POST("/me/wallet/redemptions", s.redeemCode)
	api.GET("/me/trial-access-application", s.myTrialAccessApplication)
	api.POST("/me/trial-access-applications", s.submitTrialAccessApplication)
	api.POST("/me/trial-access-application/reward", s.redeemTrialAccessReward)
	api.GET("/me/notifications", s.myNotifications)
	api.PATCH("/me/notifications", s.markNotificationsRead)
	api.DELETE("/me/notifications", s.clearNotifications)
	api.GET("/me/tasks/events", s.userTaskStream)
	api.GET("/me/gallery/submissions", s.mySubmissions)
	api.DELETE("/me/gallery/submissions/:id", s.deleteSubmission)
	api.GET("/me/assets", s.myAssets)
	api.POST("/me/assets", s.createUserAsset)
	api.PATCH("/me/assets/:id", s.updateUserAsset)
	api.DELETE("/me/assets/:id", s.deleteUserAsset)
	api.GET("/me/asset-groups", s.myAssetGroups)
	api.POST("/me/asset-groups", s.createUserAssetGroup)
	api.PATCH("/me/asset-groups/:id", s.updateUserAssetGroup)
	api.DELETE("/me/asset-groups/:id", s.deleteUserAssetGroup)
	api.GET("/me/feedback", s.myFeedback)
	api.POST("/me/feedback", s.submitUserFeedback)
	api.GET("/me/checkin", s.myCheckinState)
	api.POST("/me/checkin", s.claimDailyCheckin)
	api.GET("/me/growth", s.myGrowthPrograms)
	api.POST("/me/growth/groups", s.createGrowthGroup)
	api.POST("/me/growth/groups/join", s.joinGrowthGroup)

	// tasks
	api.POST("/tasks", s.createTask)
	api.GET("/tasks", s.listTasks)
	api.GET("/tasks/:id", s.getTask)
	api.GET("/tasks/:id/events", s.taskStream)
	api.PATCH("/tasks/:id", s.patchTask)
	api.DELETE("/tasks/:id", s.deleteTask)

	// AI ecommerce product workspace
	api.GET("/commerce/products", s.listEcommerceProducts)
	api.POST("/commerce/products", s.createEcommerceProduct)
	api.GET("/commerce/products/:id", s.getEcommerceProduct)
	api.PATCH("/commerce/products/:id", s.updateEcommerceProduct)
	api.DELETE("/commerce/products/:id", s.deleteEcommerceProduct)
	api.POST("/commerce/product-briefs", s.generateEcommerceProductBrief)
	api.GET("/commerce/reviews", s.listEcommerceAssetReviews)
	api.PUT("/commerce/reviews/:taskId", s.upsertEcommerceAssetReview)
	api.GET("/commerce/catalog", s.publicEcommerceCatalog)
	api.GET("/commerce/tryon-catalog", s.publicTryonCatalog)
	api.GET("/commerce/handheld/catalog", s.publicHandheldCatalog)
	api.POST("/commerce/handheld/quotes", s.quoteHandheldJob)
	api.GET("/commerce/handheld/projects", s.listHandheldProjects)
	api.POST("/commerce/handheld/projects", s.createHandheldProject)
	api.GET("/commerce/handheld/projects/:id", s.getHandheldProject)
	api.PUT("/commerce/handheld/projects/:id/draft", s.updateHandheldProjectDraft)
	api.POST("/commerce/handheld/jobs", s.createHandheldJob)
	api.GET("/commerce/handheld/jobs/:id", s.getHandheldJob)
	api.POST("/commerce/handheld/jobs/:id/cancel", s.cancelHandheldJob)
	api.POST("/commerce/handheld/items/:id/retry", s.retryHandheldItem)
	api.POST("/commerce/handheld/items/:id/save-asset", s.saveHandheldItemAsset)

	// canvas projects
	api.GET("/canvas-projects", s.listCanvasProjects)
	api.POST("/canvas-projects", s.createCanvasProject)
	api.GET("/canvas-projects/:id", s.getCanvasProject)
	api.PATCH("/canvas-projects/:id", s.patchCanvasProject)
	api.DELETE("/canvas-projects/:id", s.deleteCanvasProject)

	// uploads & files
	api.POST("/uploads", s.upload)
	api.GET("/files/*key", s.getFile)

	// gallery
	api.GET("/gallery/submissions", s.publicGallery)
	api.GET("/gallery/categories", s.publicGalleryCategories)
	api.POST("/gallery/submissions", s.submitGallery)

	// prompts（提示词库，公开）
	api.GET("/prompts/categories", s.publicPromptCategories)
	api.GET("/prompts", s.publicPrompts)
	api.POST("/prompts/:id/engagements", s.promptEngagement)

	// plans（只读）。支付、订单创建和 webhook 仍未注册。
	api.GET("/plans", s.listPlans)

	// meta
	api.GET("/pricing", s.pricing)
	api.GET("/runtime-config", s.runtimeConfig)
	api.GET("/changelog", s.metaChangelog)
	api.GET("/announcements", s.metaAnnouncements)
	api.GET("/health", s.health)

	// admin auth（独立账号、会话与 Cookie）
	api.POST("/admin/auth/session", s.adminLogin)
	api.GET("/admin/auth/session", s.adminAuthMe)
	api.DELETE("/admin/auth/session", s.adminLogout)
	api.PATCH("/admin/auth/password", s.adminChangePassword)

	// admin protected
	admin := api.Group("/admin")
	admin.Use(s.adminAudit)
	admin.GET("/statistics", s.adminOnly(s.adminStats))
	admin.GET("/system/metrics", s.adminOnly(s.adminSystemMetrics))
	admin.GET("/users", s.adminOnly(s.adminListUsers))
	admin.GET("/users/:id", s.adminOnly(s.adminGetUser))
	admin.PATCH("/users/:id", s.adminOnly(s.adminPatchUser))
	admin.GET("/users/:id/wallet/entries", s.adminOnly(s.adminUserLedger))
	admin.POST("/users/:id/wallet/entries", s.adminOnly(s.adminWalletAdjust))
	admin.GET("/wallet/entries", s.adminOnly(s.adminSiteLedger))
	admin.GET("/plans", s.adminOnly(s.adminListPlans))
	admin.POST("/plans", s.adminOnly(s.adminCreatePlan))
	admin.PATCH("/plans/:id", s.adminOnly(s.adminPatchPlan))
	admin.DELETE("/plans/:id", s.adminOnly(s.adminDeletePlan))
	admin.GET("/tasks", s.adminOnly(s.adminListTasks))
	admin.PATCH("/tasks/:id", s.adminOnly(s.adminPatchTask))
	admin.GET("/audit-logs", s.adminOnly(s.adminAuditLogs))
	admin.POST("/redemption-code-batches", s.adminOnly(s.adminGenerateRedemptionCodes))
	admin.GET("/redemption-codes", s.adminOnly(s.adminListRedemptionCodes))
	admin.PATCH("/redemption-codes/:id", s.adminOnly(s.adminDisableRedemptionCode))
	admin.GET("/redemption-code-batches", s.adminOnly(s.adminRedemptionBatches))
	admin.GET("/trial-access-applications", s.adminOnly(s.adminTrialAccessApplications))
	admin.PATCH("/trial-access-applications/:id", s.adminOnly(s.adminReviewTrialAccessApplication))
	admin.POST("/trial-access-applications/:id/reward-reissues", s.adminOnly(s.adminReissueTrialAccessReward))
	admin.GET("/trial-campaigns", s.adminOnly(s.adminTrialCampaigns))
	admin.POST("/trial-campaigns", s.adminOnly(s.adminCreateTrialCampaign))
	admin.PATCH("/trial-campaigns/:id", s.adminOnly(s.adminUpdateTrialCampaign))
	admin.DELETE("/trial-campaigns/:id", s.adminOnly(s.adminDeleteTrialCampaign))
	admin.POST("/trial-campaigns/:id/activation", s.adminOnly(s.adminActivateTrialCampaign))
	admin.POST("/trial-campaigns/:id/closure", s.adminOnly(s.adminCloseTrialCampaign))
	admin.GET("/feedback", s.adminOnly(s.adminFeedback))
	admin.PATCH("/feedback/:id", s.adminOnly(s.adminReviewFeedback))
	admin.GET("/gallery/submissions", s.adminOnly(s.adminSubmissions))
	admin.POST("/gallery/submissions/:id/reviews", s.adminOnly(s.adminReviewSubmission))
	admin.PUT("/gallery/submissions/:id/curation", s.adminOnly(s.adminCurateSubmission))
	admin.PATCH("/gallery/submissions", s.adminOnly(s.adminBatchCurateSubmissions))
	admin.PATCH("/gallery/submissions/order", s.adminOnly(s.adminReorderSubmissions))
	admin.POST("/gallery/submissions/:id/violations", s.adminOnly(s.adminSubmissionViolation))
	admin.DELETE("/gallery/users/:id/ban", s.adminOnly(s.adminUnbanGalleryUser))
	admin.GET("/gallery/categories", s.adminOnly(s.adminGalleryCategories))
	admin.POST("/gallery/categories", s.adminOnly(s.adminCreateGalleryCategory))
	admin.PATCH("/gallery/categories/:id", s.adminOnly(s.adminPatchGalleryCategory))
	admin.DELETE("/gallery/categories/:id", s.adminOnly(s.adminDeleteGalleryCategory))
	admin.GET("/gallery/settings", s.adminOnly(s.adminGetGallerySettings))
	admin.PUT("/gallery/settings", s.adminOnly(s.adminPutGallerySettings))
	admin.GET("/gallery/authors", s.adminOnly(s.adminGalleryAuthors))
	admin.GET("/prompt-categories", s.adminOnly(s.adminPromptCategories))
	admin.POST("/prompt-categories", s.adminOnly(s.adminCreatePromptCategory))
	admin.PATCH("/prompt-categories/:id", s.adminOnly(s.adminPatchPromptCategory))
	admin.DELETE("/prompt-categories/:id", s.adminOnly(s.adminDeletePromptCategory))
	admin.GET("/prompts", s.adminOnly(s.adminListPrompts))
	admin.GET("/prompts/export", s.adminOnly(s.adminExportPrompts))
	admin.POST("/prompts", s.adminOnly(s.adminCreatePrompt))
	admin.PATCH("/prompts/order", s.adminOnly(s.adminReorderPrompts))
	admin.GET("/prompts/:id/position", s.adminOnly(s.adminPromptPosition))
	admin.PATCH("/prompts/:id/position", s.adminOnly(s.adminMovePrompt))
	admin.PATCH("/prompts/:id", s.adminOnly(s.adminPatchPrompt))
	admin.DELETE("/prompts/:id", s.adminOnly(s.adminDeletePrompt))
	admin.PUT("/prompts/:id/cover", s.adminOnly(s.adminUploadPromptCover))
	admin.POST("/gallery/submissions/:id/prompts", s.adminOnly(s.adminCreatePromptFromSubmission))
	admin.GET("/prompt-sources", s.adminOnly(s.adminListPromptSources))
	admin.POST("/prompt-sources", s.adminOnly(s.adminCreatePromptSource))
	admin.PATCH("/prompt-sources/:id", s.adminOnly(s.adminPatchPromptSource))
	admin.DELETE("/prompt-sources/:id", s.adminOnly(s.adminDeletePromptSource))
	admin.POST("/prompt-sources/:id/synchronizations", s.adminOnly(s.adminSyncPromptSource))
	admin.GET("/prompt-import-batches", s.adminOnly(s.adminListPromptImportBatches))
	admin.POST("/prompt-import-batches", s.adminOnly(s.adminCreatePromptImportBatch))
	admin.POST("/prompt-import-batches/upload", s.adminOnly(s.adminUploadPromptImport))
	admin.GET("/prompt-import-batches/:id", s.adminOnly(s.adminGetPromptImportBatch))
	admin.GET("/prompt-import-batches/:id/items", s.adminOnly(s.adminListPromptImportItems))
	admin.GET("/prompt-import-batches/:id/items/:itemId/cover", s.adminOnly(s.adminPromptImportItemCover))
	admin.PUT("/prompt-import-batches/:id/items/:itemId/cover", s.adminOnly(s.adminUploadPromptImportItemCover))
	admin.PATCH("/prompt-import-batches/:id/items/:itemId", s.adminOnly(s.adminPatchPromptImportItem))
	admin.POST("/prompt-import-batches/:id/analyze", s.adminOnly(s.adminAnalyzePromptImportBatch))
	admin.POST("/prompt-import-batches/:id/bulk-review", s.adminOnly(s.adminBulkReviewPromptImportBatch))
	admin.POST("/prompt-import-batches/:id/publish", s.adminOnly(s.adminPublishPromptImportBatch))
	admin.GET("/announcements", s.adminOnly(s.adminAnnouncements))
	admin.POST("/announcements", s.adminOnly(s.adminCreateAnnouncement))
	admin.PATCH("/announcements/:id", s.adminOnly(s.adminPatchAnnouncement))
	admin.DELETE("/announcements/:id", s.adminOnly(s.adminDeleteAnnouncement))
	admin.GET("/changelog", s.adminOnly(s.adminChangelog))
	admin.POST("/changelog", s.adminOnly(s.adminCreateChangelog))
	admin.PATCH("/changelog/:id", s.adminOnly(s.adminPatchChangelog))
	admin.DELETE("/changelog/:id", s.adminOnly(s.adminDeleteChangelog))
	admin.GET("/settings", s.adminOnly(s.adminGetSettings))
	admin.PUT("/settings", s.adminOnly(s.adminPutSettings))
	admin.GET("/growth/groups", s.adminOnly(s.adminGrowthGroups))
	admin.POST("/providers/c2a/tests", s.adminOnly(s.adminTestC2A))
	admin.POST("/providers/sub2api/tests", s.adminOnly(s.adminTestSub2API))
	admin.POST("/providers/crun/tests", s.adminOnly(s.adminTestCRUN))
	admin.GET("/model-config", s.adminOnly(s.adminGetModelConfig))
	admin.PUT("/model-config", s.adminOnly(s.adminPutModelConfig))
	admin.POST("/model-config/discoveries", s.adminOnly(s.adminDiscoverProviderModels))
	admin.GET("/ecommerce/catalog", s.adminOnly(s.adminListTryonCatalog))
	admin.POST("/ecommerce/catalog", s.adminOnly(s.adminCreateTryonCatalog))
	admin.PATCH("/ecommerce/catalog/order", s.adminOnly(s.adminReorderTryonCatalog))
	admin.PATCH("/ecommerce/catalog/:id", s.adminOnly(s.adminPatchTryonCatalog))
	admin.PUT("/ecommerce/catalog/:id/image", s.adminOnly(s.adminUploadTryonCatalogImage))
	admin.DELETE("/ecommerce/catalog/:id", s.adminOnly(s.adminDeleteTryonCatalog))
	admin.GET("/ecommerce/tryon-catalog", s.adminOnly(s.adminListTryonCatalog))
	admin.POST("/ecommerce/tryon-catalog", s.adminOnly(s.adminCreateTryonCatalog))
	admin.PATCH("/ecommerce/tryon-catalog/order", s.adminOnly(s.adminReorderTryonCatalog))
	admin.PATCH("/ecommerce/tryon-catalog/:id", s.adminOnly(s.adminPatchTryonCatalog))
	admin.PUT("/ecommerce/tryon-catalog/:id/image", s.adminOnly(s.adminUploadTryonCatalogImage))
	admin.DELETE("/ecommerce/tryon-catalog/:id", s.adminOnly(s.adminDeleteTryonCatalog))

	return r
}

// originGuard 写请求校验 Origin 白名单；无 Origin 头的非浏览器请求放行。
func (s *Server) originGuard(c *gin.Context) {
	if writeMethods[c.Request.Method] {
		origin := c.GetHeader("Origin")
		if origin != "" {
			trimmed := strings.TrimRight(origin, "/")
			allowed := false
			for _, o := range s.Cfg.AllowedOriginsList() {
				if o == trimmed {
					allowed = true
					break
				}
			}
			if !allowed {
				c.AbortWithStatusJSON(403, gin.H{"success": false, "code": "origin_not_allowed", "error": "当前访问地址不在服务端允许列表"})
				return
			}
		}
	}
	c.Next()
}
