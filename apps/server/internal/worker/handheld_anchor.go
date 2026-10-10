package worker

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 电商整套：其余几张等第 1 张出来，再把它加为整套参考。
// 手持套图统一背景、光线和手；AI 商拍等通用整套统一布景、光线、色调和镜头质感。
const (
	handheldAnchorPollDelay = 8 * time.Second
	// 主图卡住太久就不再等，按原来的方式直接生成，不能让整套一直挂着
	handheldAnchorMaxWait = 15 * time.Minute
	// 与手持批次的参考图上限一致；已满时不再追加主图
	handheldAnchorMaxReferences = 6
	// 通用整套：前端已按所选模型的参考图上限决定是否锚定，这里只兜底传输上限
	seriesAnchorMaxReferences = modelconfig.MaxReferenceImagesLimit
)

const handheldAnchorPromptSuffix = "\n整套参考：最后 1 张参考图是本套已生成的第 1 张成片，只用来统一整套的背景、光线、色调和手（肤色、指甲、袖口、饰品）；商品身份仍以第 1 张商品图为准，本张的构图、机位和握法按本张职责来，不要照抄那张成片。"

const seriesAnchorPromptSuffix = "\n整套参考：最后 1 张参考图是本套已生成的第 1 张成片，只用来统一整套的布景语言、主光方向、色温色调和镜头质感；商品身份仍以原始商品参考图为准，本张的构图、景别和场景按本张职责来，不要照抄那张成片。"

// waitForSeriesAnchor 在认领任务之前调用。返回 true 表示主图还没出来，已稍后重新排队。
func (w *Worker) waitForSeriesAnchor(ctx context.Context, taskID uuid.UUID) (bool, error) {
	task, err := store.GetTask(ctx, w.St.Pool, taskID)
	if err != nil || task == nil || task.Status != "queued" {
		return false, nil
	}
	if taskParamBool(task.Params, store.HandheldAnchorResolvedParam) {
		return false, nil
	}
	anchorRaw := taskParamString(task.Params, store.HandheldAnchorTaskParam)
	promptSuffix, maxReferences := handheldAnchorPromptSuffix, handheldAnchorMaxReferences
	anchoredMessage := "已参照本套第 1 张统一背景、光线和手"
	if anchorRaw == "" {
		anchorRaw = taskParamString(task.Params, store.SeriesAnchorTaskParam)
		promptSuffix, maxReferences = seriesAnchorPromptSuffix, seriesAnchorMaxReferences
		anchoredMessage = "已参照本套第 1 张统一布景、光线和色调"
	}
	if anchorRaw == "" {
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
		len(task.InputKeys) < maxReferences {
		anchorKey = anchor.OutputKeys[0]
	}
	updated, err := store.ResolveHandheldAnchorTask(ctx, w.St.Pool, taskID, anchorKey, promptSuffix)
	if err != nil {
		return false, err
	}
	if updated {
		message := "本套第 1 张未成功，按原设置直接生成"
		if anchorKey != "" {
			message = anchoredMessage
		}
		log.Printf("task %s series anchor resolved with_reference=%t", taskID, anchorKey != "")
		w.recordTimeline(ctx, taskID, "handheld_anchor", "info", message, 0, nil)
	}
	return false, nil
}
