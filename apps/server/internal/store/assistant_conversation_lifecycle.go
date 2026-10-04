package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MaxAssistantConversationBonus 是订阅可追加的 AI 助手对话数上限。
const MaxAssistantConversationBonus = 10000

// AssistantConversationQuota 是用户在某个工作区的对话额度：保留数 = 基础（后台设置）+ 订阅加成。
// Used 只算没归档的对话；置顶的也算在内，但不会被自动归档。
type AssistantConversationQuota struct {
	Base         int `json:"base"`
	PlanBonus    int `json:"planBonus"`
	Limit        int `json:"limit"`
	Used         int `json:"used"`
	Pinned       int `json:"pinned"`
	Archived     int `json:"archived"`
	DailyLimit   int `json:"dailyLimit"`
	CreatedToday int `json:"createdToday"`
	ArchiveDays  int `json:"archiveDays"`
	MaxMessages  int `json:"maxMessages"`
}

// AssistantConversationQuotaInput 是后台配置的规则，由调用方按设置传入。
type AssistantConversationQuotaInput struct {
	Base        int
	DailyLimit  int
	ArchiveDays int
	MaxMessages int
	Day         time.Time
}

func GetUserAssistantConversationQuota(ctx context.Context, q Q, userID uuid.UUID, workspace string, in AssistantConversationQuotaInput) (AssistantConversationQuota, error) {
	quota := AssistantConversationQuota{
		Base: in.Base, Limit: in.Base, DailyLimit: in.DailyLimit, ArchiveDays: in.ArchiveDays, MaxMessages: in.MaxMessages,
	}
	sub, err := ActiveBillingSubscription(ctx, q, userID, false)
	if err != nil {
		return quota, err
	}
	if sub != nil && sub.Contract != nil {
		quota.PlanBonus = max(0, min(sub.Contract.AssistantConversationBonus, MaxAssistantConversationBonus))
		quota.Limit += quota.PlanBonus
	}
	if err := q.QueryRow(ctx, `SELECT
			count(*) FILTER (WHERE archived_at IS NULL),
			count(*) FILTER (WHERE archived_at IS NULL AND pinned_at IS NOT NULL),
			count(*) FILTER (WHERE archived_at IS NOT NULL)
		FROM assistant_conversations WHERE user_id = $1 AND workspace = $2`, userID, workspace).
		Scan(&quota.Used, &quota.Pinned, &quota.Archived); err != nil {
		return quota, err
	}
	if err := q.QueryRow(ctx, `SELECT COALESCE((SELECT count FROM assistant_conversation_daily_creations
		WHERE user_id = $1 AND day = $2::date), 0)`, userID, in.Day.Format("2006-01-02")).Scan(&quota.CreatedToday); err != nil {
		return quota, err
	}
	return quota, nil
}

// LockUserAssistantConversations 串行化同一用户的新建、恢复和自动归档，避免并发请求突破上限。
func LockUserAssistantConversations(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "assistant-conversations:"+userID.String())
	return err
}

// RecordAssistantConversationCreation 记一次新建；删掉对话不会退回次数。
func RecordAssistantConversationCreation(ctx context.Context, q Q, userID uuid.UUID, day time.Time) error {
	_, err := q.Exec(ctx, `INSERT INTO assistant_conversation_daily_creations (user_id, day, count)
		VALUES ($1, $2::date, 1)
		ON CONFLICT (user_id, day) DO UPDATE SET count = assistant_conversation_daily_creations.count + 1`,
		userID, day.Format("2006-01-02"))
	return err
}

// ArchiveOverflowAssistantConversations 超出保留数时，把最久没更新的对话归档。
// 置顶的、正在运行任务的、以及 keep 这一个都不会被归档；返回这次归档的对话。
func ArchiveOverflowAssistantConversations(ctx context.Context, q Q, userID uuid.UUID, workspace string, limit int, keep uuid.UUID, at time.Time) ([]*AssistantConversation, error) {
	var active int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM assistant_conversations
		WHERE user_id = $1 AND workspace = $2 AND archived_at IS NULL`, userID, workspace).Scan(&active); err != nil {
		return nil, err
	}
	overflow := active - limit
	if overflow <= 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, `UPDATE assistant_conversations SET archived_at = $5
		WHERE id IN (
			SELECT conversation.id FROM assistant_conversations conversation
			WHERE conversation.user_id = $1 AND conversation.workspace = $2
			  AND conversation.archived_at IS NULL AND conversation.pinned_at IS NULL AND conversation.id <> $3
			  AND NOT EXISTS (
				SELECT 1 FROM assistant_runs run
				WHERE run.conversation_id = conversation.id AND run.status IN ('queued', 'running')
			  )
			ORDER BY conversation.updated_at ASC, conversation.id ASC
			LIMIT $4
		)
		RETURNING `+assistantConversationCols, userID, workspace, keep, overflow, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AssistantConversation, 0, overflow)
	for rows.Next() {
		item, err := scanAssistantConversation(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// SetAssistantConversationArchived 归档或恢复一个对话。恢复的对话算作刚用过（更新时间改为现在），
// 否则它是最旧的那个，满额时会马上又被自动归档。
func SetAssistantConversationArchived(ctx context.Context, q Q, userID, id uuid.UUID, archived bool, at time.Time) (*AssistantConversation, error) {
	query := `UPDATE assistant_conversations SET archived_at = $3 WHERE id = $1 AND user_id = $2 RETURNING ` + assistantConversationCols
	args := []any{id, userID, at}
	if !archived {
		query = `UPDATE assistant_conversations SET archived_at = NULL, updated_at = $3 WHERE id = $1 AND user_id = $2 RETURNING ` + assistantConversationCols
	}
	item, err := scanAssistantConversation(q.QueryRow(ctx, query, args...))
	return nilOnNoRows(item, err)
}

func SetAssistantConversationPinned(ctx context.Context, q Q, userID, id uuid.UUID, pinned bool, at time.Time) (*AssistantConversation, error) {
	var pinnedAt *time.Time
	if pinned {
		pinnedAt = &at
	}
	item, err := scanAssistantConversation(q.QueryRow(ctx, `UPDATE assistant_conversations
		SET pinned_at = $3 WHERE id = $1 AND user_id = $2 RETURNING `+assistantConversationCols, id, userID, pinnedAt))
	return nilOnNoRows(item, err)
}

func ListArchivedAssistantConversations(ctx context.Context, q Q, userID uuid.UUID, workspace string, limit int) ([]*AssistantConversation, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantConversationCols+`
		FROM assistant_conversations WHERE user_id = $1 AND workspace = $2 AND archived_at IS NOT NULL
		ORDER BY archived_at DESC, id DESC LIMIT $3`, userID, workspace, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AssistantConversation, 0)
	for rows.Next() {
		item, err := scanAssistantConversation(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ExpiredAssistantConversation 是归档期满、要删除的对话。
type ExpiredAssistantConversation struct {
	UserID uuid.UUID
	ID     uuid.UUID
}

func ListExpiredArchivedAssistantConversations(ctx context.Context, q Q, archivedBefore time.Time, limit int) ([]ExpiredAssistantConversation, error) {
	rows, err := q.Query(ctx, `SELECT user_id, id FROM assistant_conversations
		WHERE archived_at IS NOT NULL AND archived_at < $1
		ORDER BY archived_at ASC LIMIT $2`, archivedBefore, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ExpiredAssistantConversation, 0)
	for rows.Next() {
		var item ExpiredAssistantConversation
		if err := rows.Scan(&item.UserID, &item.ID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CountAssistantConversationMessages(ctx context.Context, q Q, conversationID uuid.UUID) (int, error) {
	var count int
	err := q.QueryRow(ctx, `SELECT count(*) FROM assistant_messages WHERE conversation_id = $1`, conversationID).Scan(&count)
	return count, err
}
