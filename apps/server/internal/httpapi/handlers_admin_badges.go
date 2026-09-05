package httpapi

import (
	"github.com/gin-gonic/gin"
	"golang.org/x/sync/errgroup"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// adminBadgeCounts 一次返回后台侧边栏所有徽标数，替代前端对
// gallery/submissions、statistics、trial-access-applications、feedback
// 四个端点的分别轮询。各字段口径与原端点一致。
func (s *Server) adminBadgeCounts(c *gin.Context, _ *store.User) {
	ctx := c.Request.Context()
	var (
		pendingSubmissions       int64
		runningTasks             int64
		pendingTrialApplications int64
		pendingFeedback          int64
	)
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		n, err := store.CountGallerySubmissionsByStatus(groupCtx, s.St.Pool, "pending")
		pendingSubmissions = n
		return err
	})
	group.Go(func() error {
		n, err := store.CountTasksQueuedOrRunning(groupCtx, s.St.Pool)
		runningTasks = n
		return err
	})
	group.Go(func() error {
		// 与 GET /admin/trial-access-applications 相同：取当前活动（或最新）
		// 活动的待审申请数；无活动则为 0。徽标是只读轮询，不在这里做
		// CloseExpiredTrialCampaigns 的维护性写入。
		campaign, err := resolveAdminTrialCampaign(groupCtx, s.St.Pool, "")
		if err != nil || campaign == nil {
			return err
		}
		n, err := store.CountTrialAccessApplications(groupCtx, s.St.Pool, campaign.ID, "pending", "")
		pendingTrialApplications = n
		return err
	})
	group.Go(func() error {
		n, err := store.CountAdminFeedback(groupCtx, s.St.Pool, "open", "", "")
		pendingFeedback = n
		return err
	})
	if err := group.Wait(); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{
		"pendingSubmissions":       pendingSubmissions,       // 画廊投稿待审核（status=pending）
		"runningTasks":             runningTasks,             // 排队中 + 运行中任务
		"pendingTrialApplications": pendingTrialApplications, // 体验资格申请待审核（当前活动）
		"pendingFeedback":          pendingFeedback,          // 用户反馈待处理（status=open）
	})
}
