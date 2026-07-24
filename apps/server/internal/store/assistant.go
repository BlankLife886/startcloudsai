package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const assistantConversationCols = `id, user_id, title, created_at, updated_at`
const assistantMessageCols = `id, conversation_id, role, content, kind, status, metadata, created_at, updated_at`
const assistantRunCols = `id, user_id, conversation_id, user_message_id, assistant_message_id, mode, resolved_mode,
	status, stage, prompt, params, error_code, error_message, started_at, finished_at, created_at`

func scanAssistantConversation(row pgx.Row) (*AssistantConversation, error) {
	var item AssistantConversation
	if err := row.Scan(&item.ID, &item.UserID, &item.Title, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func scanAssistantMessage(row pgx.Row) (*AssistantMessage, error) {
	var item AssistantMessage
	if err := row.Scan(&item.ID, &item.ConversationID, &item.Role, &item.Content, &item.Kind,
		&item.Status, &item.Metadata, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func scanAssistantRun(row pgx.Row) (*AssistantRun, error) {
	var item AssistantRun
	if err := row.Scan(&item.ID, &item.UserID, &item.ConversationID, &item.UserMessageID,
		&item.AssistantMessageID, &item.Mode, &item.ResolvedMode, &item.Status, &item.Stage,
		&item.Prompt, &item.Params, &item.ErrorCode, &item.ErrorMessage, &item.StartedAt,
		&item.FinishedAt, &item.CreatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func InsertAssistantConversation(ctx context.Context, q Q, id, userID uuid.UUID, title string, createdAt time.Time) (*AssistantConversation, error) {
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	return scanAssistantConversation(q.QueryRow(ctx,
		`INSERT INTO assistant_conversations (id, user_id, title, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4) RETURNING `+assistantConversationCols,
		id, userID, title, createdAt))
}

func ListAssistantConversations(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]*AssistantConversation, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantConversationCols+`
		FROM assistant_conversations WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`, userID, limit)
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

func GetUserAssistantConversation(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantConversation, error) {
	item, err := scanAssistantConversation(q.QueryRow(ctx, `SELECT `+assistantConversationCols+
		` FROM assistant_conversations WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(item, err)
}

func TouchAssistantConversation(ctx context.Context, q Q, userID, id uuid.UUID, title *string, updatedAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE assistant_conversations
		SET title = COALESCE($3, title), updated_at = $4 WHERE id = $1 AND user_id = $2`, id, userID, title, updatedAt)
	return err
}

func DeleteUserAssistantConversation(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2`, id, userID)
	return tag.RowsAffected() > 0, err
}

func InsertAssistantMessage(ctx context.Context, q Q, item AssistantMessage) (*AssistantMessage, error) {
	if item.Metadata == nil {
		item.Metadata = map[string]any{}
	}
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now().UTC()
	}
	if item.Status == "" {
		item.Status = "complete"
	}
	return scanAssistantMessage(q.QueryRow(ctx,
		`INSERT INTO assistant_messages (id, conversation_id, role, content, kind, status, metadata, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING `+assistantMessageCols,
		item.ID, item.ConversationID, item.Role, item.Content, item.Kind, item.Status, item.Metadata, item.CreatedAt))
}

func ListAssistantMessages(ctx context.Context, q Q, conversationID uuid.UUID, limit int) ([]*AssistantMessage, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantMessageCols+` FROM (
		SELECT `+assistantMessageCols+` FROM assistant_messages WHERE conversation_id = $1
		ORDER BY created_at DESC, id DESC LIMIT $2
	) recent ORDER BY created_at ASC, id ASC`, conversationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AssistantMessage, 0)
	for rows.Next() {
		item, err := scanAssistantMessage(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetAssistantMessage(ctx context.Context, q Q, id uuid.UUID) (*AssistantMessage, error) {
	item, err := scanAssistantMessage(q.QueryRow(ctx, `SELECT `+assistantMessageCols+` FROM assistant_messages WHERE id = $1`, id))
	return nilOnNoRows(item, err)
}

func UpdateAssistantMessage(ctx context.Context, q Q, id uuid.UUID, content, kind, status string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err := q.Exec(ctx, `UPDATE assistant_messages SET content = $2, kind = $3, status = $4,
		metadata = $5, updated_at = now() WHERE id = $1`, id, content, kind, status, metadata)
	return err
}

func DeleteAssistantMessagesAfter(ctx context.Context, q Q, conversationID, messageID uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM assistant_messages WHERE conversation_id = $1 AND id <> $2 AND
		created_at >= (SELECT created_at FROM assistant_messages WHERE id = $2 AND conversation_id = $1)`,
		conversationID, messageID)
	return err
}

func UpdateAssistantUserMessage(ctx context.Context, q Q, id uuid.UUID, content string, metadata map[string]any) error {
	_, err := q.Exec(ctx, `UPDATE assistant_messages SET content = $2, metadata = $3, updated_at = now()
		WHERE id = $1 AND role = 'user'`, id, content, metadata)
	return err
}

func DeleteUserAssistantMessage(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM assistant_messages message USING assistant_conversations conversation
		WHERE message.id = $1 AND message.conversation_id = conversation.id AND conversation.user_id = $2`, id, userID)
	return tag.RowsAffected() > 0, err
}

func InsertAssistantRun(ctx context.Context, q Q, item AssistantRun) (*AssistantRun, error) {
	if item.Params == nil {
		item.Params = map[string]any{}
	}
	return scanAssistantRun(q.QueryRow(ctx,
		`INSERT INTO assistant_runs (id, user_id, conversation_id, user_message_id, assistant_message_id,
		 mode, prompt, params) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+assistantRunCols,
		item.ID, item.UserID, item.ConversationID, item.UserMessageID, item.AssistantMessageID,
		item.Mode, item.Prompt, item.Params))
}

func GetUserAssistantRun(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(item, err)
}

func GetAssistantRun(ctx context.Context, q Q, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = $1`, id))
	return nilOnNoRows(item, err)
}

func ListActiveUserAssistantRuns(ctx context.Context, q Q, userID uuid.UUID) ([]*AssistantRun, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs
		WHERE user_id = $1 AND status IN ('queued','running') ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AssistantRun, 0)
	for rows.Next() {
		item, err := scanAssistantRun(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// LockAssistantRunsForUser serializes task-capacity checks and conversation deletion for one user.
func LockAssistantRunsForUser(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, userID.String())
	return err
}

func ClaimAssistantRun(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'running', stage = 'routing', started_at = now()
		WHERE id = $1 AND status = 'queued'`, id)
	return tag.RowsAffected() > 0, err
}

func SetAssistantRunStage(ctx context.Context, q Q, id uuid.UUID, resolvedMode, stage string) error {
	_, err := q.Exec(ctx, `UPDATE assistant_runs SET resolved_mode = $2, stage = $3 WHERE id = $1 AND status = 'running'`,
		id, resolvedMode, stage)
	return err
}

func CompleteAssistantRun(ctx context.Context, q Q, id uuid.UUID, resolvedMode string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'succeeded', resolved_mode = $2,
		stage = 'complete', finished_at = now(), error_code = NULL, error_message = NULL
		WHERE id = $1 AND status = 'running'`, id, resolvedMode)
	return tag.RowsAffected() > 0, err
}

func FailAssistantRun(ctx context.Context, q Q, id uuid.UUID, code, message string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'failed', stage = 'failed',
		error_code = $2, error_message = $3, finished_at = now()
		WHERE id = $1 AND status IN ('queued','running')`, id, code, message)
	return tag.RowsAffected() > 0, err
}

func CancelAssistantRun(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'canceled', stage = 'stopped', finished_at = now()
		WHERE id = $1 AND user_id = $2 AND status IN ('queued','running')`, id, userID)
	return tag.RowsAffected() > 0, err
}

func RequeueAssistantRun(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'queued', stage = 'queued', resolved_mode = '',
		error_code = NULL, error_message = NULL, started_at = NULL, finished_at = NULL
		WHERE id = $1 AND status = 'failed'`, id)
	return tag.RowsAffected() > 0, err
}

func AdminCancelAssistantRun(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'canceled', stage = 'stopped', finished_at = now()
		WHERE id = $1 AND status = 'queued'`, id)
	return tag.RowsAffected() > 0, err
}

func AdminForceFailAssistantRun(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'failed', stage = 'failed',
		error_code = 'admin_force_failed', error_message = '管理员强制终止任务', finished_at = now()
		WHERE id = $1 AND status = 'running'`, id)
	return tag.RowsAffected() > 0, err
}

func RequeueRunningAssistantRuns(ctx context.Context, q Q) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `UPDATE assistant_runs SET status = 'queued', stage = 'queued', started_at = NULL
		WHERE status = 'running' RETURNING id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func ListQueuedAssistantRunIDs(ctx context.Context, q Q, limit int) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT id FROM assistant_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
