package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const assistantConversationCols = `id, user_id, title, created_at, updated_at`
const assistantMessageCols = `id, conversation_id, role, content, kind, status, metadata, created_at, updated_at`
const assistantRunCols = `id, user_id, conversation_id, user_message_id, assistant_message_id, mode, resolved_mode,
	status, stage, prompt, params, reserved_cents, cost_cents, billing_generation,
	error_code, error_message, started_at, finished_at, created_at`

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
		&item.Prompt, &item.Params, &item.ReservedCents, &item.CostCents, &item.BillingGeneration,
		&item.ErrorCode, &item.ErrorMessage, &item.StartedAt,
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
	keys, err := listAssistantOutputKeys(ctx, q, userID, "conversation.id = $2", id)
	if err != nil {
		return false, err
	}
	if err := EnqueueObjectCleanup(ctx, q, keys); err != nil {
		return false, err
	}
	if err := DeleteAssistantUploadReferencesForConversation(ctx, q, userID, id); err != nil {
		return false, err
	}
	tag, err := q.Exec(ctx, `DELETE FROM assistant_conversations WHERE id = $1 AND user_id = $2`, id, userID)
	return tag.RowsAffected() > 0, err
}

func listAssistantOutputKeys(ctx context.Context, q Q, userID uuid.UUID, condition string, args ...any) ([]string, error) {
	values := make([]any, 0, len(args)+1)
	values = append(values, userID)
	values = append(values, args...)
	return listAssistantOutputKeysWithCondition(ctx, q, "conversation.user_id = $1 AND "+condition, values...)
}

func listAssistantOutputKeysWithCondition(ctx context.Context, q Q, condition string, args ...any) ([]string, error) {
	query := `
		SELECT image.value->>'fileKey'
		FROM assistant_messages message
		JOIN assistant_conversations conversation ON conversation.id = message.conversation_id
		CROSS JOIN LATERAL jsonb_array_elements(
				(CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
					THEN message.metadata->'images' ELSE '[]'::jsonb END)
				|| (CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
					THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
		) AS image(value)
		WHERE ` + condition + `
		  AND COALESCE(image.value->>'fileKey', '') <> ''`
	rows, err := q.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]string, 0)
	seen := make(map[string]struct{})
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// EnqueueAssistantMessageOutputCleanup records generated objects before the
// message metadata is replaced or the message is removed. Callers that also
// update the message should pass a transaction so the queue entry and metadata
// change become visible together.
func EnqueueAssistantMessageOutputCleanup(ctx context.Context, q Q, userID, messageID uuid.UUID) error {
	keys, err := listAssistantOutputKeys(ctx, q, userID, "message.id = $2", messageID)
	if err != nil {
		return err
	}
	if err := LockObjectReferenceKeys(ctx, q, keys); err != nil {
		return err
	}
	return EnqueueObjectCleanup(ctx, q, keys)
}

// ClearAssistantMessageOutputMetadata queues generated objects and then
// replaces the message metadata. Keeping both operations in one transaction
// prevents the cleanup worker from deleting an object while the old metadata
// is still visible, or from losing the cleanup record after metadata removal.
func ClearAssistantMessageOutputMetadata(ctx context.Context, q Q, userID, messageID uuid.UUID, content, kind, status string, metadata map[string]any) error {
	if err := EnqueueAssistantMessageOutputCleanup(ctx, q, userID, messageID); err != nil {
		return err
	}
	return UpdateAssistantMessage(ctx, q, messageID, content, kind, status, metadata)
}

// LockAssistantOutputKeys verifies and locks assistant image messages while a
// caller records a new reference to one of their generated files. This keeps
// assistant output cleanup serialized with reference creation.
func LockAssistantOutputKeys(ctx context.Context, q Q, userID uuid.UUID, keys []string) (map[string]struct{}, error) {
	referenced := make(map[string]struct{}, len(keys))
	if len(keys) == 0 {
		return referenced, nil
	}
	rows, err := q.Query(ctx, `
		SELECT image.value->>'fileKey'
		FROM assistant_messages message
		JOIN assistant_conversations conversation ON conversation.id = message.conversation_id
		CROSS JOIN LATERAL jsonb_array_elements(
				(CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
					THEN message.metadata->'images' ELSE '[]'::jsonb END)
				|| (CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
					THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
		) AS image(value)
		WHERE conversation.user_id = $1
		  AND image.value->>'fileKey' = ANY($2::text[])
		FOR SHARE OF message`, userID, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		referenced[key] = struct{}{}
	}
	return referenced, rows.Err()
}

func assistantOutputCleanupKeysForWindow(ctx context.Context, q Q, conversationID, messageID uuid.UUID, includeSource bool) ([]string, error) {
	condition := `message.conversation_id = $1 AND message.id <> $2 AND message.created_at >= (
			SELECT source.created_at FROM assistant_messages source
			WHERE source.id = $2 AND source.conversation_id = $1
		)`
	if includeSource {
		condition = `message.conversation_id = $1 AND message.created_at >= (
			SELECT source.created_at FROM assistant_messages source
			WHERE source.id = $2 AND source.conversation_id = $1
		)`
	}
	return listAssistantOutputKeysWithCondition(ctx, q, condition, conversationID, messageID)
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
	keys, err := assistantOutputCleanupKeysForWindow(ctx, q, conversationID, messageID, false)
	if err != nil {
		return err
	}
	if err := EnqueueObjectCleanup(ctx, q, keys); err != nil {
		return err
	}
	if err := DeleteAssistantUploadReferencesAfter(ctx, q, conversationID, messageID); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `DELETE FROM assistant_messages WHERE conversation_id = $1 AND id <> $2 AND
		created_at >= (SELECT created_at FROM assistant_messages WHERE id = $2 AND conversation_id = $1)`,
		conversationID, messageID)
	return err
}

func DeleteAssistantMessagesFrom(ctx context.Context, q Q, conversationID, messageID uuid.UUID) error {
	keys, err := assistantOutputCleanupKeysForWindow(ctx, q, conversationID, messageID, true)
	if err != nil {
		return err
	}
	if err := EnqueueObjectCleanup(ctx, q, keys); err != nil {
		return err
	}
	if err := DeleteAssistantUploadReferencesFrom(ctx, q, conversationID, messageID); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `DELETE FROM assistant_messages WHERE conversation_id = $1 AND
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
	if err := EnqueueAssistantMessageOutputCleanup(ctx, q, userID, id); err != nil {
		return false, err
	}
	if err := DeleteAssistantUploadReferencesForMessage(ctx, q, userID, id); err != nil {
		return false, err
	}
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
			 mode, prompt, params, reserved_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+assistantRunCols,
		item.ID, item.UserID, item.ConversationID, item.UserMessageID, item.AssistantMessageID,
		item.Mode, item.Prompt, item.Params, item.ReservedCents))
}

func GetUserAssistantRun(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(item, err)
}

func GetAssistantRun(ctx context.Context, q Q, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = $1`, id))
	return nilOnNoRows(item, err)
}

func GetUserAssistantRunForUpdate(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+`
		FROM assistant_runs WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID))
	return nilOnNoRows(item, err)
}

func GetAssistantRunForUpdate(ctx context.Context, q Q, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+`
		FROM assistant_runs WHERE id = $1 FOR UPDATE`, id))
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

func CompleteAssistantRun(ctx context.Context, q Q, id uuid.UUID, resolvedMode string, costCents int64) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'succeeded', resolved_mode = $2,
		stage = 'complete', cost_cents = $3, finished_at = now(), error_code = NULL, error_message = NULL
		WHERE id = $1 AND status = 'running' AND $3 >= 0 AND $3 <= reserved_cents`, id, resolvedMode, costCents)
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
		cost_cents = 0, billing_generation = billing_generation + 1,
		error_code = NULL, error_message = NULL, started_at = NULL, finished_at = NULL,
		params = COALESCE(params, '{}'::jsonb) - '_crunTaskIds'
		WHERE id = $1 AND status = 'failed'`, id)
	return tag.RowsAffected() > 0, err
}

func SetAssistantRunCRUNTaskIDs(ctx context.Context, q Q, id uuid.UUID, taskIDs []string) error {
	payload, err := json.Marshal(taskIDs)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE assistant_runs SET params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_crunTaskIds}', $2::jsonb, true)
		WHERE id = $1`, id, string(payload))
	return err
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
