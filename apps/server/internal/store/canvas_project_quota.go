package store

import (
	"context"

	"github.com/google/uuid"
)

// MaxCanvasProjectBonus 是订阅可追加的画布项目数上限。
const MaxCanvasProjectBonus = 10000

// CanvasProjectQuota 是用户的画布项目配额：基础（后台设置）+ 订阅加成，及单项目大小上限。
type CanvasProjectQuota struct {
	Base      int   `json:"base"`
	PlanBonus int   `json:"planBonus"`
	Limit     int   `json:"limit"`
	Used      int   `json:"used"`
	MaxBytes  int64 `json:"maxBytes"`
	// TotalBytes / LargestBytes 是该用户全部画布项目的总大小与最大单个项目大小。
	TotalBytes   int64 `json:"totalBytes"`
	LargestBytes int64 `json:"largestBytes"`
}

// GetUserCanvasProjectQuota 汇总用户当前的画布项目配额与已用数量；base/maxBytes 由调用方按后台设置传入。
func GetUserCanvasProjectQuota(ctx context.Context, q Q, userID uuid.UUID, base int, maxBytes int64) (CanvasProjectQuota, error) {
	quota := CanvasProjectQuota{Base: base, Limit: base, MaxBytes: maxBytes}
	sub, err := ActiveBillingSubscription(ctx, q, userID, false)
	if err != nil {
		return quota, err
	}
	if sub != nil && sub.Contract != nil {
		quota.PlanBonus = max(0, min(sub.Contract.CanvasProjectBonus, MaxCanvasProjectBonus))
		quota.Limit += quota.PlanBonus
	}
	if err := q.QueryRow(ctx, `SELECT count(*), COALESCE(sum(document_bytes), 0), COALESCE(max(document_bytes), 0)
		FROM canvas_projects WHERE user_id = $1`, userID).Scan(&quota.Used, &quota.TotalBytes, &quota.LargestBytes); err != nil {
		return quota, err
	}
	return quota, nil
}

// LockUserCanvasProjectCreation 串行化同一用户的新建项目，保证"计数 + 插入"不会被并发请求突破上限。
func LockUserCanvasProjectCreation(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "canvas-project-create:"+userID.String())
	return err
}
