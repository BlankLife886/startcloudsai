package worker

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 手持套图：其余几张等第 1 张出来，再把它加为整套参考（统一背景、光线和手）。
const (
	handheldAnchorPollDelay = 8 * time.Second
	// 主图卡住太久就不再等，按原来的方式直接生成，不能让整套一直挂着
	handheldAnchorMaxWait = 15 * time.Minute
	// 与手持批次的参考图上限一致；已满时不再追加主图
	handheldAnchorMaxReferences = 6
)

const handheldAnchorPromptSuffix = "\n整套参考：最后 1 张参考图是本套已生成的第 1 张成片，只用来统一整套的背景、光线、色调和手（肤色、指甲、袖口、饰品）；商品身份仍以第 1 张商品图为准，本张的构图、机位和握法按本张职责来，不要照抄那张成片。"

// waitForHandheldAnchor 在认领任务之前调用。返回 true 表示主图还没出来，已稍后重新排队。
func (w *Worker) waitForHandheldAnchor(ctx context.Context, taskID uuid.UUID) (bool, error) {
	task, err := store.GetTask(ctx, w.St.Pool, taskID)
	if err != nil || task == nil || task.Status != "queued" {
		return false, nil
	}
	anchorRaw := taskParamString(task.Params, store.HandheldAnchorTaskParam)
	if anchorRaw == "" || taskParamBool(task.Params, store.HandheldAnchorResolvedParam) {
		return false, nil
	}
	var anchor *store.Task
	if anchorID, parseErr := uuid.Parse(anchorRaw); parseErr == nil {
		anchor, _ = store.GetTask(ctx, w.St.Pool, anchorID)
	}
	if anchor != nil && anchor.UserID != task.UserID {
		anchor = nil
	}
	if anchor != nil && (anchor.Status == "queued" || anchor.Status == "running") &&
		time.Since(task.CreatedAt) < handheldAnchorMaxWait {
		if err := w.Queue.EnqueueRunTaskRecoveryIn(ctx, taskID.String(), handheldAnchorPollDelay); err != nil {
			return false, err
		}
		return true, nil
	}
	anchorKey := ""
	if anchor != nil && anchor.Status == "succeeded" && len(anchor.OutputKeys) > 0 &&
		len(task.InputKeys) < handheldAnchorMaxReferences {
		anchorKey = anchor.OutputKeys[0]
	}
	updated, err := store.ResolveHandheldAnchorTask(ctx, w.St.Pool, taskID, anchorKey, handheldAnchorPromptSuffix)
	if err != nil {
		return false, err
	}
	if updated {
		message := "本套第 1 张未成功，按原设置直接生成"
		if anchorKey != "" {
			message = "已参照本套第 1 张统一背景、光线和手"
		}
		log.Printf("task %s handheld anchor resolved with_reference=%t", taskID, anchorKey != "")
		w.recordTimeline(ctx, taskID, "handheld_anchor", "info", message, 0, nil)
	}
	return false, nil
}
