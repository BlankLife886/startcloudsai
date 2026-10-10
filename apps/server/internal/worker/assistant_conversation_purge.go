package worker

import (
	"context"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 每轮最多删这么多个，剩下的下一轮接着删。
const assistantArchivePurgeBatch = 200

// handlePurgeArchivedAssistantConversations 删除归档期满的 AI 助手对话。走和用户手动删除相同的路径：
// 消息一并删除，生成的图片进入对象存储清理队列。
func (w *Worker) handlePurgeArchivedAssistantConversations(ctx context.Context, _ *asynq.Task) error {
	policy := settings.ResolveAssistantConversationPolicy(ctx, w.St.Pool)
	before := time.Now().UTC().AddDate(0, 0, -policy.ArchiveDays)
	expired, err := store.ListExpiredArchivedAssistantConversations(ctx, w.St.Pool, before, assistantArchivePurgeBatch)
	if err != nil {
		return err
	}
	deleted := 0
	for _, item := range expired {
		err := w.St.Tx(ctx, func(tx pgx.Tx) error {
			// 加锁后再确认一次：期间用户可能已经恢复了这个对话。
			if err := store.LockUserAssistantConversations(ctx, tx, item.UserID); err != nil {
				return err
			}
			current, err := store.GetUserAssistantConversation(ctx, tx, item.UserID, item.ID)
			if err != nil || current == nil || current.ArchivedAt == nil || !current.ArchivedAt.Before(before) {
				return err
			}
			ok, err := store.DeleteUserAssistantConversation(ctx, tx, item.UserID, item.ID)
			if ok {
				deleted++
			}
			return err
		})
		if err != nil {
			log.Printf("purge archived assistant conversation %s failed: %v", item.ID, err)
		}
	}
	if deleted > 0 {
		log.Printf("purged %d archived assistant conversations", deleted)
	}
	return nil
}
