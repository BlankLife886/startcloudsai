package settings

import (
	"context"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// AI 助手对话的数量管理，全部可在后台调整。
const (
	DefaultAssistantConversationMaxCount    = 40
	AssistantConversationMaxCountLimit      = 10000
	DefaultAssistantConversationDailyMax    = 100
	AssistantConversationDailyMaxLimit      = 100000
	AssistantConversationMaxMessagesLimit   = 100000
	DefaultAssistantConversationArchiveDays = 7
	AssistantConversationArchiveDaysLimit   = 365
)

// AssistantConversationPolicy 是后台配置的对话规则。
// MaxCount 是每人保留的对话数（基础值，订阅可在套餐里追加）；DailyCreate 和 MaxMessages 为 0 表示不限。
type AssistantConversationPolicy struct {
	MaxCount    int
	DailyCreate int
	MaxMessages int
	ArchiveDays int
}

func ResolveAssistantConversationPolicy(ctx context.Context, q store.Q) AssistantConversationPolicy {
	policy := AssistantConversationPolicy{
		MaxCount:    DefaultAssistantConversationMaxCount,
		DailyCreate: DefaultAssistantConversationDailyMax,
		ArchiveDays: DefaultAssistantConversationArchiveDays,
	}
	if v, err := GetInt(ctx, q, "assistant_conversation_max_count"); err == nil && v >= 1 && v <= AssistantConversationMaxCountLimit {
		policy.MaxCount = int(v)
	}
	if v, err := GetInt(ctx, q, "assistant_conversation_daily_create_limit"); err == nil && v >= 0 && v <= AssistantConversationDailyMaxLimit {
		policy.DailyCreate = int(v)
	}
	if v, err := GetInt(ctx, q, "assistant_conversation_max_messages"); err == nil && v >= 0 && v <= AssistantConversationMaxMessagesLimit {
		policy.MaxMessages = int(v)
	}
	if v, err := GetInt(ctx, q, "assistant_conversation_archive_days"); err == nil && v >= 1 && v <= AssistantConversationArchiveDaysLimit {
		policy.ArchiveDays = int(v)
	}
	return policy
}
