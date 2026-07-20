// Package httpapi 注册 Gin 路由与 handler（auth, me, tasks, uploads, files,
// plans, orders, gallery, meta, admin），并挂载统一响应/错误中间件。
package httpapi

import (
	"log"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

var writeMethods = map[string]bool{"POST": true, "PATCH": true, "DELETE": true, "PUT": true}

type Server struct {
	Cfg          *config.Config
	St           *store.Store
	Storage      *storage.Storage
	C2A          *c2a.Client
	Queue        *taskflow.Queue
	LoginLimiter *auth.LoginLimiter
}

func New(cfg *config.Config, st *store.Store, stg *storage.Storage, c2aClient *c2a.Client, queue *taskflow.Queue) *Server {
	return &Server{
		Cfg:          cfg,
		St:           st,
		Storage:      stg,
		C2A:          c2aClient,
		Queue:        queue,
		LoginLimiter: auth.NewLoginLimiter(),
	}
}

func (s *Server) Router() *gin.Engine {
	if s.Cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.Use(gin.Logger())
	r.Use(gin.CustomRecovery(func(c *gin.Context, err any) {
		log.Printf("panic on %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
		c.AbortWithStatusJSON(500, gin.H{"success": false, "code": "internal_error", "error": "服务器内部错误"})
	}))
	r.Use(s.originGuard)

	r.NoRoute(func(c *gin.Context) {
		c.JSON(404, gin.H{"success": false, "code": "not_found", "error": "Not Found"})
	})
	r.NoMethod(func(c *gin.Context) {
		c.JSON(405, gin.H{"success": false, "code": "bad_request", "error": "Method Not Allowed"})
	})

	api := r.Group("/api")

	// auth
	api.POST("/auth/register", s.register)
	api.POST("/auth/login", s.login)
	api.POST("/auth/logout", s.logout)
	api.GET("/auth/me", s.authMe)

	// me
	api.PATCH("/me/profile", s.patchProfile)
	api.GET("/me/overview", s.overview)
	api.GET("/me/wallet", s.myWallet)
	api.GET("/me/wallet/ledger", s.myLedger)
	api.GET("/me/notifications", s.myNotifications)
	api.POST("/me/notifications/read", s.markNotificationsRead)
	api.GET("/me/gallery/submissions", s.mySubmissions)
	api.DELETE("/me/gallery/submissions/:id", s.deleteSubmission)

	// tasks
	api.POST("/tasks", s.createTask)
	api.GET("/tasks", s.listTasks)
	api.GET("/tasks/:id", s.getTask)
	api.POST("/tasks/:id/cancel", s.cancelTask)
	api.DELETE("/tasks/:id", s.deleteTask)

	// uploads & files
	api.POST("/uploads", s.upload)
	api.GET("/files/*key", s.getFile)

	// plans & orders
	api.GET("/plans", s.listPlans)
	api.POST("/orders", s.createOrder)
	api.GET("/orders", s.listOrders)
	api.GET("/orders/:id", s.getOrder)
	api.POST("/payments/webhook/:provider", s.paymentWebhook)

	// gallery
	api.GET("/gallery", s.publicGallery)
	api.GET("/gallery/categories", s.publicGalleryCategories)
	api.POST("/gallery/submissions", s.submitGallery)

	// prompts（提示词库，公开）
	api.GET("/prompts", s.publicPrompts)

	// meta
	api.GET("/meta/pricing", s.pricing)
	api.GET("/meta/changelog", s.metaChangelog)
	api.GET("/meta/announcements", s.metaAnnouncements)
	api.GET("/health", s.health)

	// admin
	admin := api.Group("/admin")
	admin.Use(s.adminAudit)
	admin.GET("/stats", s.adminOnly(s.adminStats))
	admin.GET("/users", s.adminOnly(s.adminListUsers))
	admin.GET("/users/:id", s.adminOnly(s.adminGetUser))
	admin.PATCH("/users/:id", s.adminOnly(s.adminPatchUser))
	admin.GET("/users/:id/ledger", s.adminOnly(s.adminUserLedger))
	admin.POST("/users/:id/reset-password", s.adminOnly(s.adminResetPassword))
	admin.POST("/users/:id/wallet-adjust", s.adminOnly(s.adminWalletAdjust))
	admin.GET("/ledger", s.adminOnly(s.adminSiteLedger))
	admin.GET("/finance/summary", s.adminOnly(s.adminFinanceSummary))
	admin.GET("/orders", s.adminOnly(s.adminListOrders))
	admin.POST("/orders/:id/complete", s.adminOnly(s.adminCompleteOrder))
	admin.GET("/plans", s.adminOnly(s.adminListPlans))
	admin.POST("/plans", s.adminOnly(s.adminCreatePlan))
	admin.PATCH("/plans/:id", s.adminOnly(s.adminPatchPlan))
	admin.DELETE("/plans/:id", s.adminOnly(s.adminDeletePlan))
	admin.GET("/tasks", s.adminOnly(s.adminListTasks))
	admin.POST("/tasks/:id/requeue", s.adminOnly(s.adminRequeueTask))
	admin.POST("/tasks/:id/cancel", s.adminOnly(s.adminCancelTask))
	admin.POST("/tasks/:id/force-fail", s.adminOnly(s.adminForceFailTask))
	admin.GET("/audit-logs", s.adminOnly(s.adminAuditLogs))
	admin.GET("/gallery/submissions", s.adminOnly(s.adminSubmissions))
	admin.POST("/gallery/submissions/:id/review", s.adminOnly(s.adminReviewSubmission))
	admin.POST("/gallery/submissions/:id/curate", s.adminOnly(s.adminCurateSubmission))
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
