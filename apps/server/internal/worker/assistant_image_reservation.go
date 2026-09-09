package worker

import (
	"context"
	"errors"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Every image adapter uses the same units as admission. A batch owns all of
// its image slots until completion, including providers requiring one job per
// image. Chat runs cannot enter an image adapter using their lighter quota.
func (w *Worker) assistantReservedImageCount(ctx context.Context, run *store.AssistantRun) (int, error) {
	if !store.AssistantRunIsImage(run) {
		return 0, errors.New("当前任务未获得生图执行名额")
	}
	count := store.AssistantRunWorkUnits(run)
	if count < 1 || count >= 1000000000 {
		return 0, errors.New("生图任务数量无效")
	}
	current, err := store.GetAssistantRun(ctx, w.St.Pool, run.ID)
	if err != nil {
		return 0, err
	}
	if current == nil || current.Status != "running" || current.Attempt != run.Attempt ||
		current.LeaseOwner == nil || run.LeaseOwner == nil || *current.LeaseOwner != *run.LeaseOwner ||
		current.LeaseUntil == nil || !current.LeaseUntil.After(time.Now()) {
		return 0, context.Canceled
	}
	if !store.AssistantRunIsImage(current) || store.AssistantRunWorkUnits(current) != count {
		return 0, errors.New("生图数量与已分配执行名额不一致")
	}
	return int(count), nil
}
