package worker

import (
	"context"
	"log"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

// recordTimeline 尽力而为地追加一条任务时间线事件（后台「耗时详情」展示用）。
// durationMs < 0 表示事件没有时长。写入失败只记日志，绝不影响任务执行。
func (w *Worker) recordTimeline(ctx context.Context, taskID uuid.UUID, stage, status, message string, durationMs int64, meta map[string]any) {
	if w == nil || w.St == nil {
		return
	}
	// 失败/清理路径常带着已取消的 context，换一个短超时的独立 context 保证能落库。
	if ctx == nil || ctx.Err() != nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
	}
	if err := store.AppendTaskTimelineEvent(ctx, w.St.Pool, taskID, stage, status, message, durationMs, meta); err != nil {
		log.Printf("task %s timeline write failed stage=%s: %v", taskID, stage, err)
	}
}
