package httpapi

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// 每天新建次数按北京时间的自然日算。
var assistantConversationDayZone = time.FixedZone("Asia/Shanghai", 8*3600)

// 对话数量规则只管 AI 助手页面；画布、UI 设计的会话跟着各自的项目走。
func assistantConversationLimited(workspace string) bool {
	return workspace == modelconfig.WorkspaceAssistant
}

func (s *Server) assistantConversationQuota(ctx context.Context, q store.Q, userID uuid.UUID, workspace string, now time.Time) (store.AssistantConversationQuota, error) {
	policy := settings.ResolveAssistantConversationPolicy(ctx, q)
	return store.GetUserAssistantConversationQuota(ctx, q, userID, workspace, store.AssistantConversationQuotaInput{
		Base: policy.MaxCount, DailyLimit: policy.DailyCreate, ArchiveDays: policy.ArchiveDays, MaxMessages: policy.MaxMessages,
		Day: now.In(assistantConversationDayZone),
	})
}

// createLimitedAssistantConversation 在一个事务里：检查今天的新建次数、建对话、记次数，
// 超出保留数时把最久没用的对话归档（置顶和正在运行的不动）。归档不出空位就整体回滚。
func (s *Server) createLimitedAssistantConversation(ctx context.Context, userID uuid.UUID, title, workspace string, projectID *uuid.UUID, now time.Time) (*store.AssistantConversation, []*store.AssistantConversation, error) {
	var item *store.AssistantConversation
	var archived []*store.AssistantConversation
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserAssistantConversations(ctx, tx, userID); err != nil {
			return err
		}
		quota, err := s.assistantConversationQuota(ctx, tx, userID, workspace, now)
		if err != nil {
			return err
		}
		if quota.DailyLimit > 0 && quota.CreatedToday >= quota.DailyLimit {
			return apperr.E("assistant_conversation_daily_limit",
				fmt.Sprintf("今天新建的对话已达 %d 个上限，可以继续使用已有对话，明天再新建", quota.DailyLimit), 429)
		}
		item, err = store.InsertAssistantConversationBound(ctx, tx, uuid.New(), userID, title, workspace, projectID, now)
		if err != nil {
			return err
		}
		if err := store.RecordAssistantConversationCreation(ctx, tx, userID, now.In(assistantConversationDayZone)); err != nil {
			return err
		}
		archived, err = store.ArchiveOverflowAssistantConversations(ctx, tx, userID, workspace, quota.Limit, item.ID, now)
		if err != nil {
			return err
		}
		if quota.Used+1-len(archived) > quota.Limit {
			return apperr.E("assistant_conversation_limit",
				fmt.Sprintf("对话已达 %d 个上限，置顶或正在运行的对话不会被自动归档，请取消置顶或归档部分对话后再新建", quota.Limit), 409)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return item, archived, nil
}

func assistantArchivedConversationDict(item *store.AssistantConversation, archiveDays int) gin.H {
	out := assistantConversationDict(item, nil)
	delete(out, "messages")
	if item.ArchivedAt != nil {
		out["deleteAt"] = isoValue(item.ArchivedAt.AddDate(0, 0, archiveDays))
	}
	return out
}

func assistantArchivedSummaries(items []*store.AssistantConversation, archiveDays int) []gin.H {
	out := make([]gin.H, 0, len(items))
	for _, item := range items {
		out = append(out, assistantArchivedConversationDict(item, archiveDays))
	}
	return out
}

func (s *Server) assistantConversationQuotaEndpoint(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	workspace, err := assistantConversationWorkspace(c.Query("workspace"))
	if err != nil {
		fail(c, err)
		return
	}
	quota, err := s.assistantConversationQuota(c.Request.Context(), s.St.Pool, user.ID, workspace, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"quota": quota})
}

func (s *Server) archivedAssistantConversations(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	workspace, err := assistantConversationWorkspace(c.Query("workspace"))
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	items, err := store.ListArchivedAssistantConversations(ctx, s.St.Pool, user.ID, workspace, assistantConversationListMax)
	if err != nil {
		fail(c, err)
		return
	}
	policy := settings.ResolveAssistantConversationPolicy(ctx, s.St.Pool)
	ok(c, gin.H{"conversations": assistantArchivedSummaries(items, policy.ArchiveDays), "archiveDays": policy.ArchiveDays})
}

func (s *Server) archiveAssistantConversation(c *gin.Context) {
	s.setAssistantConversationArchived(c, true)
}

func (s *Server) restoreAssistantConversation(c *gin.Context) {
	s.setAssistantConversationArchived(c, false)
}

// 归档：不再出现在列表里，到期自动删除。恢复：回到列表顶部；满额时照常把最旧的归档。
func (s *Server) setAssistantConversationArchived(c *gin.Context, archived bool) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	now := time.Now().UTC()
	var item *store.AssistantConversation
	var overflow []*store.AssistantConversation
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserAssistantConversations(ctx, tx, user.ID); err != nil {
			return err
		}
		current, err := store.GetUserAssistantConversation(ctx, tx, user.ID, id)
		if err != nil {
			return err
		}
		if current == nil {
			return apperr.E("not_found", "对话不存在", 404)
		}
		if archived && current.ArchivedAt == nil {
			active, err := store.ListActiveUserAssistantRuns(ctx, tx, user.ID)
			if err != nil {
				return err
			}
			for _, run := range active {
				if run.ConversationID == id {
					return apperr.E("assistant_conversation_busy", "该对话仍有任务正在运行，完成或停止后再归档", 409)
				}
			}
		}
		item, err = store.SetAssistantConversationArchived(ctx, tx, user.ID, id, archived, now)
		if err != nil || item == nil {
			return err
		}
		if !archived && assistantConversationLimited(item.Workspace) {
			quota, err := s.assistantConversationQuota(ctx, tx, user.ID, item.Workspace, now)
			if err != nil {
				return err
			}
			overflow, err = store.ArchiveOverflowAssistantConversations(ctx, tx, user.ID, item.Workspace, quota.Limit, item.ID, now)
			if err != nil {
				return err
			}
			if quota.Used-len(overflow) > quota.Limit {
				return apperr.E("assistant_conversation_limit",
					fmt.Sprintf("对话已达 %d 个上限，置顶或正在运行的对话不会被自动归档，请先取消置顶或归档其他对话", quota.Limit), 409)
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	policy := settings.ResolveAssistantConversationPolicy(ctx, s.St.Pool)
	quota, err := s.assistantConversationQuota(ctx, s.St.Pool, user.ID, item.Workspace, now)
	if err != nil {
		fail(c, err)
		return
	}
	out := gin.H{"conversation": assistantArchivedConversationDict(item, policy.ArchiveDays), "quota": quota,
		"archived": assistantArchivedSummaries(overflow, policy.ArchiveDays)}
	if !archived {
		messages, err := store.ListAssistantMessages(ctx, s.St.Pool, item.ID, assistantMessagePreviewLimit+1)
		if err != nil {
			fail(c, err)
			return
		}
		hasMore := len(messages) > assistantMessagePreviewLimit
		if hasMore {
			messages = messages[len(messages)-assistantMessagePreviewLimit:]
		}
		conversation := assistantConversationDict(item, messages)
		conversation["hasMoreMessages"] = hasMore
		out["conversation"] = conversation
	}
	ok(c, out)
}

type pinAssistantConversationIn struct {
	Pinned bool `json:"pinned"`
}

func (s *Server) pinAssistantConversation(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var body pinAssistantConversationIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	item, err := store.SetAssistantConversationPinned(c.Request.Context(), s.St.Pool, user.ID, id, body.Pinned, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "对话不存在", 404))
		return
	}
	ok(c, gin.H{"id": item.ID.String(), "pinned": item.PinnedAt != nil, "pinnedAt": iso(item.PinnedAt)})
}

// assistantConversationRunBlocked 检查能不能在这个对话里继续发消息：归档的要先恢复，长度到了上限要开新对话。
func (s *Server) assistantConversationRunBlocked(ctx context.Context, conversation *store.AssistantConversation) error {
	if conversation.ArchivedAt != nil {
		return apperr.E("assistant_conversation_archived", "这个对话已归档，恢复后才能继续对话", 409)
	}
	policy := settings.ResolveAssistantConversationPolicy(ctx, s.St.Pool)
	if policy.MaxMessages <= 0 {
		return nil
	}
	count, err := store.CountAssistantConversationMessages(ctx, s.St.Pool, conversation.ID)
	if err != nil {
		return err
	}
	if count >= policy.MaxMessages {
		return apperr.E("assistant_conversation_too_long",
			fmt.Sprintf("这个对话已达到 %d 条消息的上限，请开启新对话继续", policy.MaxMessages), 409)
	}
	return nil
}
