// Package httpapi 注册 Gin 路由与 handler（auth, me, tasks, uploads, files,
// plans, orders, gallery, meta, admin），并挂载统一响应/错误中间件。
package httpapi

import (
	"log"
	"net/http"
	"strings"

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
	r.Use(gin.CustomRecovery(func(c *gin.Context, err any) {
		log.Printf("panic on %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
		c.AbortWithStatusJSON(500, gin.H{"success": false, "code": "internal_error", "error": "服务器内部错误"})
	}))
	r.Use(func(c *gin.Context) {
		limit := int64(1 << 20)
		if c.Request.URL.Path == "/api/uploads" {
			limit = s.Cfg.UploadMaxBytes + (1 << 20)
		}
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

	api := r.Group("/api")

	// auth
	api.GET("/auth/providers", s.authProviders)
	api.POST("/auth/email/code", s.requestEmailLoginCode)
	api.POST("/auth/register", s.register)
	api.POST("/auth/login", s.login)
	api.POST("/auth/password/reset", s.resetUserPassword)
	api.GET("/auth/oauth/github", s.oauthStart)
	api.GET("/auth/oauth/github/callback", s.oauthCallback)
	api.POST("/auth/logout", s.logout)
	api.GET("/auth/me", s.authMe)

	// me
	api.PATCH("/me/profile", s.patchProfile)
	api.GET("/me/overview", s.overview)
	api.GET("/me/wallet", s.myWallet)
	api.GET("/me/wallet/ledger", s.myLedger)
	api.POST("/me/wallet/redeem", s.redeemCode)
	api.GET("/me/notifications", s.myNotifications)
	api.POST("/me/notifications/read", s.markNotificationsRead)
	api.GET("/me/gallery/submissions", s.mySubmissions)
	api.DELETE("/me/gallery/submissions/:id", s.deleteSubmission)
	api.GET("/me/assets", s.myAssets)
	api.POST("/me/assets", s.createUserAsset)
	api.DELETE("/me/assets/:id", s.deleteUserAsset)

	// tasks
	api.POST("/tasks", s.createTask)
	api.GET("/tasks", s.listTasks)
	api.GET("/tasks/:id", s.getTask)
	api.POST("/tasks/:id/cancel", s.cancelTask)
	api.DELETE("/tasks/:id", s.deleteTask)

	// uploads & files
	api.POST("/uploads", s.upload)
	api.GET("/files/*key", s.getFile)

	// gallery
	api.GET("/gallery", s.publicGallery)
	api.GET("/gallery/categories", s.publicGalleryCategories)
	api.POST("/gallery/submissions", s.submitGallery)

	// prompts（提示词库，公开）
	api.GET("/prompts", s.publicPrompts)

	// plans（只读）。支付、订单创建和 webhook 仍未注册。
	api.GET("/plans", s.listPlans)

	// meta
	api.GET("/meta/pricing", s.pricing)
	api.GET("/meta/changelog", s.metaChangelog)
	api.GET("/meta/announcements", s.metaAnnouncements)
	api.GET("/health", s.health)

	// admin auth（独立账号、会话与 Cookie）
	api.POST("/admin/auth/login", s.adminLogin)
	api.POST("/admin/auth/logout", s.adminLogout)
	api.GET("/admin/auth/me", s.adminAuthMe)
	api.PATCH("/admin/auth/password", s.adminChangePassword)

	// admin protected
	admin := api.Group("/admin")
	admin.Use(s.adminAudit)
	admin.GET("/stats", s.adminOnly(s.adminStats))
	admin.GET("/users", s.adminOnly(s.adminListUsers))
	admin.GET("/users/:id", s.adminOnly(s.adminGetUser))
	admin.PATCH("/users/:id", s.adminOnly(s.adminPatchUser))
	admin.GET("/users/:id/ledger", s.adminOnly(s.adminUserLedger))
	admin.POST("/users/:id/wallet-adjust", s.adminOnly(s.adminWalletAdjust))
	admin.GET("/ledger", s.adminOnly(s.adminSiteLedger))
	admin.GET("/tasks", s.adminOnly(s.adminListTasks))
	admin.POST("/tasks/:id/requeue", s.adminOnly(s.adminRequeueTask))
	admin.POST("/tasks/:id/cancel", s.adminOnly(s.adminCancelTask))
	admin.POST("/tasks/:id/force-fail", s.adminOnly(s.adminForceFailTask))
	admin.GET("/audit-logs", s.adminOnly(s.adminAuditLogs))
	admin.POST("/redemption-codes/generate", s.adminOnly(s.adminGenerateRedemptionCodes))
	admin.GET("/redemption-codes", s.adminOnly(s.adminListRedemptionCodes))
	admin.POST("/redemption-codes/:id/disable", s.adminOnly(s.adminDisableRedemptionCode))
	admin.GET("/redemption-codes/batches", s.adminOnly(s.adminRedemptionBatches))
	admin.GET("/gallery/submissions", s.adminOnly(s.adminSubmissions))
	admin.POST("/gallery/submissions/:id/review", s.adminOnly(s.adminReviewSubmission))
	admin.POST("/gallery/submissions/:id/curate", s.adminOnly(s.adminCurateSubmission))
	admin.POST("/gallery/submissions/batch-curate", s.adminOnly(s.adminBatchCurateSubmissions))
	admin.POST("/gallery/submissions/reorder", s.adminOnly(s.adminReorderSubmissions))
	admin.POST("/gallery/submissions/:id/violation", s.adminOnly(s.adminSubmissionViolation))
	admin.POST("/gallery/users/:id/unban", s.adminOnly(s.adminUnbanGalleryUser))
	admin.GET("/gallery/categories", s.adminOnly(s.adminGalleryCategories))
	admin.POST("/gallery/categories", s.adminOnly(s.adminCreateGalleryCategory))
	admin.PATCH("/gallery/categories/:id", s.adminOnly(s.adminPatchGalleryCategory))
	admin.DELETE("/gallery/categories/:id", s.adminOnly(s.adminDeleteGalleryCategory))
	admin.GET("/gallery/settings", s.adminOnly(s.adminGetGallerySettings))
	admin.PUT("/gallery/settings", s.adminOnly(s.adminPutGallerySettings))
	admin.GET("/gallery/authors", s.adminOnly(s.adminGalleryAuthors))
	admin.GET("/prompt-library", s.adminOnly(s.adminListPrompts))
	admin.POST("/prompt-library", s.adminOnly(s.adminCreatePrompt))
	admin.PATCH("/prompt-library/:id", s.adminOnly(s.adminPatchPrompt))
	admin.DELETE("/prompt-library/:id", s.adminOnly(s.adminDeletePrompt))
	admin.POST("/prompt-library/:id/cover", s.adminOnly(s.adminUploadPromptCover))
	admin.GET("/prompt-sources", s.adminOnly(s.adminListPromptSources))
	admin.POST("/prompt-sources", s.adminOnly(s.adminCreatePromptSource))
	admin.PATCH("/prompt-sources/:id", s.adminOnly(s.adminPatchPromptSource))
	admin.DELETE("/prompt-sources/:id", s.adminOnly(s.adminDeletePromptSource))
	admin.POST("/prompt-sources/:id/sync", s.adminOnly(s.adminSyncPromptSource))
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
	admin.POST("/settings/test-c2a", s.adminOnly(s.adminTestC2A))

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
				c.AbortWithStatusJSON(403, gin.H{"success": false, "code": "admin_required", "error": "Origin 不在白名单内"})
				return
			}
		}
	}
	c.Next()
}
