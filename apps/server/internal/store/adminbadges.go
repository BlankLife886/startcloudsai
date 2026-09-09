package store

import (
	"context"
)

// CountGallerySubmissionsByStatus 全站指定状态的投稿数（后台徽标用）。
func CountGallerySubmissionsByStatus(ctx context.Context, q Q, status string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM gallery_submissions WHERE status = $1`, status).Scan(&n)
	return n, err
}

// CountTasksQueuedOrRunning 全站排队中 + 运行中任务数，口径与 admin
// statistics 的 runningTasks（QueuedNow + RunningNow）一致。
func CountTasksQueuedOrRunning(ctx context.Context, q Q) (int64, error) {
	var n int64
	err := q.QueryRow(ctx,
		`SELECT count(*) FROM tasks WHERE status IN ('queued', 'running')`).Scan(&n)
	return n, err
}
