package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const assistantConversationCols = `id, user_id, title, workspace, project_id, created_at, updated_at`
const assistantMessageCols = `id, conversation_id, role, content, kind, status, metadata, created_at, updated_at`
const assistantRunCols = `id, user_id, conversation_id, user_message_id, assistant_message_id,
	idempotency_key, request_fingerprint, mode, resolved_mode,
	status, stage, prompt, params, reserved_cents, cost_cents, billing_generation, attempt,
	lease_owner, lease_until, heartbeat_at,
	error_code, error_message, started_at, finished_at, created_at`

func scanAssistantConversation(row pgx.Row) (*AssistantConversation, error) {
	var item AssistantConversation
	if err := row.Scan(&item.ID, &item.UserID, &item.Title, &item.Workspace, &item.ProjectID, &item.CreatedAt, &item.UpdatedAt); err != nil {
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
		&item.AssistantMessageID, &item.IdempotencyKey, &item.RequestFingerprint,
		&item.Mode, &item.ResolvedMode, &item.Status, &item.Stage,
		&item.Prompt, &item.Params, &item.ReservedCents, &item.CostCents, &item.BillingGeneration,
		&item.Attempt, &item.LeaseOwner, &item.LeaseUntil, &item.HeartbeatAt,
		&item.ErrorCode, &item.ErrorMessage, &item.StartedAt,
		&item.FinishedAt, &item.CreatedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func InsertAssistantConversation(ctx context.Context, q Q, id, userID uuid.UUID, title string, createdAt time.Time) (*AssistantConversation, error) {
	return InsertAssistantConversationWithWorkspace(ctx, q, id, userID, title, "assistant", createdAt)
}

func InsertAssistantConversationWithWorkspace(ctx context.Context, q Q, id, userID uuid.UUID, title, workspace string, createdAt time.Time) (*AssistantConversation, error) {
	return InsertAssistantConversationBound(ctx, q, id, userID, title, workspace, nil, createdAt)
}

func InsertAssistantConversationBound(ctx context.Context, q Q, id, userID uuid.UUID, title, workspace string, projectID *uuid.UUID, createdAt time.Time) (*AssistantConversation, error) {
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	return scanAssistantConversation(q.QueryRow(ctx,
		`INSERT INTO assistant_conversations (id, user_id, title, workspace, project_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING `+assistantConversationCols,
		id, userID, title, workspace, projectID, createdAt))
}

func ListAssistantConversations(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]*AssistantConversation, error) {
	return ListAssistantConversationsByWorkspace(ctx, q, userID, "assistant", limit)
}

func ListAssistantConversationsByWorkspace(ctx context.Context, q Q, userID uuid.UUID, workspace string, limit int) ([]*AssistantConversation, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantConversationCols+`
		FROM assistant_conversations WHERE user_id = $1 AND workspace = $2
		ORDER BY updated_at DESC, id DESC LIMIT $3`, userID, workspace, limit)
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

func ListAssistantConversationsByProject(ctx context.Context, q Q, userID uuid.UUID, workspace string, projectID uuid.UUID, limit int) ([]*AssistantConversation, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantConversationCols+`
		FROM assistant_conversations WHERE user_id = $1 AND workspace = $2 AND project_id = $3
		ORDER BY updated_at DESC, id DESC LIMIT $4`, userID, workspace, projectID, limit)
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

func SetAssistantConversationProjectIfEmpty(ctx context.Context, q Q, userID, conversationID, projectID uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE assistant_conversations
		SET project_id = $3, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND project_id IS NULL`, conversationID, userID, projectID)
	return err
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
	// 该列表只用于对象清理：把约定路径下的小图/展示图变体一并带上，
	// 避免删除消息后变体成为孤儿对象。
	for _, key := range keys[:len(keys):len(keys)] {
		for _, variant := range AssistantVariantKeys(key) {
			if _, exists := seen[variant]; exists {
				continue
			}
			seen[variant] = struct{}{}
			keys = append(keys, variant)
		}
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

func MergeAssistantMessageMetadata(ctx context.Context, q Q, id uuid.UUID, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `UPDATE assistant_messages
		SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
		WHERE id = $1`, id, fields)
	return err
}

// ClaimAssistantMessagePendingTool atomically assigns one browser executor to a
// pending tool request. Replays from the same executor remain valid; other
// browsers stay observers and cannot perform the mutation.
func ClaimAssistantMessagePendingTool(ctx context.Context, q Q, id uuid.UUID, requestID, executorID string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_messages
		SET metadata = jsonb_set(
			COALESCE(metadata, '{}'::jsonb),
			'{pendingTool,claimedBy}',
			to_jsonb($3::text),
			true
		), updated_at = now()
		WHERE id = $1
			AND metadata->'pendingTool'->>'requestId' = $2
			AND COALESCE(metadata->'pendingTool'->>'claimedBy', '') IN ('', $3)`, id, requestID, executorID)
	return tag.RowsAffected() > 0, err
}

// ClearAssistantMessagePendingTool removes only the tool request identified by
// requestID. The condition prevents a late result from an earlier tool call
// from clearing a newer request that the same run has already published.
func ClearAssistantMessagePendingTool(ctx context.Context, q Q, id uuid.UUID, requestID string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_messages
		SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'pendingTool') || jsonb_build_object('statusStage', 'thinking'),
			updated_at = now()
		WHERE id = $1 AND metadata->'pendingTool'->>'requestId' = $2`, id, requestID)
	return tag.RowsAffected() > 0, err
}

func AppendAssistantMessageArtifact(ctx context.Context, q Q, id uuid.UUID, artifact map[string]any) error {
	artifactID, _ := artifact["id"].(string)
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return errors.New("assistant artifact id is required")
	}
	raw, err := json.Marshal(artifact)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE assistant_messages
		SET metadata = jsonb_set(
			COALESCE(metadata, '{}'::jsonb),
			'{artifacts}',
			CASE WHEN EXISTS (
				SELECT 1 FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(metadata->'artifacts') = 'array'
						THEN metadata->'artifacts' ELSE '[]'::jsonb END
				) item WHERE item->>'id' = $3
			) THEN CASE WHEN jsonb_typeof(metadata->'artifacts') = 'array'
				THEN metadata->'artifacts' ELSE '[]'::jsonb END
			ELSE (CASE WHEN jsonb_typeof(metadata->'artifacts') = 'array'
				THEN metadata->'artifacts' ELSE '[]'::jsonb END) || jsonb_build_array($2::jsonb)
			END,
			true
		), updated_at = now()
		WHERE id = $1`, id, string(raw), artifactID)
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
			 idempotency_key, request_fingerprint, mode, prompt, params, reserved_cents)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING `+assistantRunCols,
		item.ID, item.UserID, item.ConversationID, item.UserMessageID, item.AssistantMessageID,
		item.IdempotencyKey, item.RequestFingerprint, item.Mode, item.Prompt, item.Params, item.ReservedCents))
}

func GetUserAssistantRunByIdempotencyKey(ctx context.Context, q Q, userID uuid.UUID, key string) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+`
		FROM assistant_runs WHERE user_id = $1 AND idempotency_key = $2`, userID, key))
	return nilOnNoRows(item, err)
}

func GetUserAssistantRun(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(item, err)
}

func GetAssistantRun(ctx context.Context, q Q, id uuid.UUID) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = $1`, id))
	return nilOnNoRows(item, err)
}

func GetAssistantRunsByIDs(ctx context.Context, q Q, ids []uuid.UUID) (map[uuid.UUID]*AssistantRun, error) {
	out := make(map[uuid.UUID]*AssistantRun, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	conversationIDs := make([]uuid.UUID, 0, len(ids))
	seenConversations := make(map[uuid.UUID]struct{}, len(ids))
	for rows.Next() {
		run, err := scanAssistantRun(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out[run.ID] = run
		if _, exists := seenConversations[run.ConversationID]; exists {
			continue
		}
		seenConversations[run.ConversationID] = struct{}{}
		conversationIDs = append(conversationIDs, run.ConversationID)
	}
	scanErr := rows.Err()
	rows.Close()
	if scanErr != nil {
		return nil, scanErr
	}
	if len(conversationIDs) == 0 {
		return out, nil
	}
	convRows, err := q.Query(ctx, `SELECT id, workspace FROM assistant_conversations WHERE id = ANY($1)`, conversationIDs)
	if err != nil {
		return nil, err
	}
	defer convRows.Close()
	workspaces := make(map[uuid.UUID]string, len(conversationIDs))
	for convRows.Next() {
		var id uuid.UUID
		var workspace string
		if err := convRows.Scan(&id, &workspace); err != nil {
			return nil, err
		}
		workspaces[id] = workspace
	}
	if err := convRows.Err(); err != nil {
		return nil, err
	}
	for _, run := range out {
		applyAssistantConversationWorkspace(run, workspaces[run.ConversationID])
	}
	return out, nil
}

func applyAssistantConversationWorkspace(run *AssistantRun, workspace string) {
	if run == nil {
		return
	}
	if run.Params == nil {
		run.Params = map[string]any{}
	}
	if strings.TrimSpace(workspace) == "" {
		return
	}
	if paramText(run.Params, "workspace") == "" {
		run.Params["workspace"] = workspace
	}
	if workspace == PromptTaskTypeCanvas && paramText(run.Params, "_source", "source") == "" {
		run.Params["_source"] = CanvasTaskSource
	}
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
	return scanAssistantRuns(rows, err)
}

func ListActiveUserAssistantRunsByWorkspace(ctx context.Context, q Q, userID uuid.UUID, workspace string) ([]*AssistantRun, error) {
	rows, err := q.Query(ctx, `SELECT `+assistantRunCols+` FROM assistant_runs
		WHERE user_id = $1 AND status IN ('queued','running')
		AND conversation_id IN (
			SELECT id FROM assistant_conversations WHERE user_id = $1 AND workspace = $2
		)
		ORDER BY created_at DESC`, userID, workspace)
	return scanAssistantRuns(rows, err)
}

func RunningAssistantRunsByProvider(ctx context.Context, q Q, providerKeys []string) (map[string]int64, error) {
	out := make(map[string]int64, len(providerKeys))
	if len(providerKeys) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT COALESCE(params ->> '_chatProviderRouteKey', params ->> '_chatProviderConfigId'), count(*)
		FROM assistant_runs
		WHERE status = 'running'
		AND COALESCE(params ->> '_chatProviderRouteKey', params ->> '_chatProviderConfigId') = ANY($1)
		GROUP BY 1`, providerKeys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var count int64
		if err := rows.Scan(&key, &count); err != nil {
			return nil, err
		}
		out[key] = count
	}
	return out, rows.Err()
}

func SetQueuedAssistantRunExecutionRoute(ctx context.Context, q Q, id uuid.UUID, fields map[string]any) (bool, error) {
	raw, err := json.Marshal(fields)
	if err != nil {
		return false, err
	}
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET params = COALESCE(params, '{}'::jsonb) || $2::jsonb
		WHERE id = $1 AND status = 'queued'`, id, raw)
	return tag.RowsAffected() > 0, err
}

func scanAssistantRuns(rows pgx.Rows, err error) ([]*AssistantRun, error) {
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

func ClaimAssistantRunWithLease(ctx context.Context, q Q, id uuid.UUID, owner string, now time.Time, lease time.Duration) (*AssistantRun, error) {
	item, err := scanAssistantRun(q.QueryRow(ctx, `UPDATE assistant_runs
		SET status = 'running', stage = 'routing', started_at = COALESCE(started_at, $3),
			attempt = attempt + 1, lease_owner = $2, heartbeat_at = $3, lease_until = $4
		WHERE id = $1 AND status = 'queued'
		RETURNING `+assistantRunCols, id, owner, now, now.Add(lease)))
	return nilOnNoRows(item, err)
}

func ClaimAssistantRun(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	item, err := ClaimAssistantRunWithLease(ctx, q, id, "legacy:"+uuid.NewString(), time.Now().UTC(), 15*time.Minute)
	return item != nil, err
}

// BeginAssistantRunAttempt records only operational routing metadata. Prompts,
// message content, and model reasoning are deliberately excluded from traces.
func BeginAssistantRunAttempt(ctx context.Context, q Q, run *AssistantRun) error {
	if run == nil || run.ID == uuid.Nil || run.Attempt <= 0 {
		return errors.New("invalid assistant run attempt")
	}
	_, err := q.Exec(ctx, `WITH interrupted AS (
		UPDATE assistant_run_attempts SET status = 'interrupted', finished_at = $3,
			error_code = 'lease_expired', error_message = 'worker lease expired before completion'
		WHERE run_id = $1 AND attempt < $2 AND status = 'running'
	)
	INSERT INTO assistant_run_attempts (
		run_id, attempt, status, lease_owner, provider_route_key, provider_name, model,
		requested_mode, resolved_mode, started_at
	)
	SELECT id, attempt, 'running', lease_owner,
		NULLIF(params->>'_chatProviderRouteKey', ''),
		NULLIF(params->>'_chatProviderDisplayName', ''),
		COALESCE(NULLIF(params->>'_chatModel', ''), NULLIF(params->>'model', '')),
		mode, resolved_mode, $3
	FROM assistant_runs
	WHERE id = $1 AND attempt = $2 AND status = 'running'
	ON CONFLICT (run_id, attempt) DO UPDATE SET
		status = 'running', lease_owner = EXCLUDED.lease_owner,
		provider_route_key = EXCLUDED.provider_route_key,
		provider_name = EXCLUDED.provider_name, model = EXCLUDED.model,
		requested_mode = EXCLUDED.requested_mode, resolved_mode = EXCLUDED.resolved_mode,
		error_code = NULL, error_message = NULL, finished_at = NULL`,
		run.ID, run.Attempt, time.Now().UTC())
	return err
}

func FinishAssistantRunAttempt(
	ctx context.Context,
	q Q,
	runID uuid.UUID,
	attempt int,
	status, resolvedMode, errorCode, errorMessage string,
) (bool, error) {
	if !containsAssistantAttemptStatus(status) {
		return false, errors.New("invalid assistant run attempt status")
	}
	tag, err := q.Exec(ctx, `UPDATE assistant_run_attempts
		SET status = $3, resolved_mode = COALESCE(NULLIF($4, ''), resolved_mode),
			error_code = NULLIF($5, ''), error_message = NULLIF($6, ''), finished_at = now()
		WHERE run_id = $1 AND attempt = $2 AND status = 'running'`,
		runID, attempt, status, resolvedMode, errorCode, errorMessage)
	return tag.RowsAffected() > 0, err
}

func containsAssistantAttemptStatus(status string) bool {
	switch status {
	case "succeeded", "failed", "requeued", "canceled", "interrupted", "superseded":
		return true
	default:
		return false
	}
}

func RenewAssistantRunLease(ctx context.Context, q Q, id uuid.UUID, attempt int, owner string, now time.Time, lease time.Duration) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET heartbeat_at = $4, lease_until = $5
		WHERE id = $1 AND status = 'running' AND attempt = $2 AND lease_owner = $3 AND lease_until > $4`,
		id, attempt, owner, now, now.Add(lease))
	return tag.RowsAffected() > 0, err
}

func SetAssistantRunStage(ctx context.Context, q Q, id uuid.UUID, resolvedMode, stage string) error {
	_, err := SetAssistantRunStageAttempt(ctx, q, id, 0, resolvedMode, stage)
	return err
}

func SetAssistantRunStageAttempt(ctx context.Context, q Q, id uuid.UUID, attempt int, resolvedMode, stage string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET resolved_mode = $3, stage = $4
		WHERE id = $1 AND status = 'running'
		AND ($2 = 0 OR (attempt = $2 AND lease_until > now()))`, id, attempt, resolvedMode, stage)
	return tag.RowsAffected() > 0, err
}

func CompleteAssistantRun(ctx context.Context, q Q, id uuid.UUID, resolvedMode string, costCents int64) (bool, error) {
	return CompleteAssistantRunAttempt(ctx, q, id, 0, resolvedMode, costCents)
}

func CompleteAssistantRunAttempt(ctx context.Context, q Q, id uuid.UUID, attempt int, resolvedMode string, costCents int64) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'succeeded', resolved_mode = $2,
		stage = 'complete', cost_cents = $3, finished_at = now(), error_code = NULL, error_message = NULL,
		lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
		WHERE id = $1 AND status = 'running'
		AND ($4 = 0 OR (attempt = $4 AND lease_until > now()))
		AND $3 >= 0 AND $3 <= reserved_cents`, id, resolvedMode, costCents, attempt)
	return tag.RowsAffected() > 0, err
}

func FailAssistantRun(ctx context.Context, q Q, id uuid.UUID, code, message string) (bool, error) {
	return FailAssistantRunAttempt(ctx, q, id, 0, code, message)
}

func FailAssistantRunAttempt(ctx context.Context, q Q, id uuid.UUID, attempt int, code, message string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'failed', stage = 'failed',
		error_code = $2, error_message = $3, finished_at = now(),
		lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
		WHERE id = $1 AND (
			($4 = 0 AND status IN ('queued','running'))
			OR ($4 > 0 AND status = 'running' AND attempt = $4 AND lease_until > now())
		)`, id, code, message, attempt)
	return tag.RowsAffected() > 0, err
}

func CancelAssistantRun(ctx context.Context, q Q, userID, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'canceled', stage = 'stopped', finished_at = now(),
		lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
		WHERE id = $1 AND user_id = $2 AND status IN ('queued','running')`, id, userID)
	return tag.RowsAffected() > 0, err
}

func CancelAssistantRunWithCost(ctx context.Context, q Q, userID, id uuid.UUID, costCents int64) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'canceled', stage = 'stopped',
		cost_cents = $3, finished_at = now(), lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
		WHERE id = $1 AND user_id = $2 AND status IN ('queued','running')
		AND $3 >= 0 AND $3 <= reserved_cents`, id, userID, costCents)
	return tag.RowsAffected() > 0, err
}

func RequeueAssistantRun(ctx context.Context, q Q, id uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'queued', stage = 'queued', resolved_mode = '',
		cost_cents = 0, billing_generation = billing_generation + 1,
		error_code = NULL, error_message = NULL, started_at = NULL, finished_at = NULL,
		lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL,
		params = COALESCE(params, '{}'::jsonb) - '_crunTaskIds'
		WHERE id = $1 AND status = 'failed'`, id)
	return tag.RowsAffected() > 0, err
}

func RequeueRunningAssistantRunForRouteFailover(
	ctx context.Context,
	q Q,
	id uuid.UUID,
	attempt int,
	failedRouteKeys []string,
) (bool, error) {
	raw, err := json.Marshal(failedRouteKeys)
	if err != nil {
		return false, err
	}
	tag, err := q.Exec(ctx, `UPDATE assistant_runs SET status = 'queued', stage = 'queued', resolved_mode = '',
		started_at = NULL, lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL,
		params = jsonb_set(COALESCE(params, '{}'::jsonb), '{_failedChatProviderRouteKeys}', $3::jsonb, true)
		WHERE id = $1 AND status = 'running' AND attempt = $2 AND lease_until > now()`, id, attempt, raw)
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

func RequeueExpiredAssistantRuns(ctx context.Context, q Q, now time.Time) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `WITH expired AS (
		UPDATE assistant_runs SET status = 'queued', stage = 'queued', started_at = NULL,
			lease_owner = NULL, lease_until = NULL, heartbeat_at = NULL
		WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= $1)
		RETURNING id, attempt
	), interrupted AS (
		UPDATE assistant_run_attempts trace
		SET status = 'interrupted', finished_at = $1,
			error_code = 'lease_expired', error_message = 'worker lease expired before completion'
		FROM expired
		WHERE trace.run_id = expired.id AND trace.attempt = expired.attempt AND trace.status = 'running'
	), queued AS (
		INSERT INTO assistant_run_outbox (run_id)
		SELECT id FROM expired
		ON CONFLICT (run_id) DO UPDATE SET next_attempt_at = now(), updated_at = now()
		RETURNING run_id
	)
	SELECT run_id FROM queued`, now)
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

func InsertAssistantRunOutbox(ctx context.Context, q Q, runID uuid.UUID) error {
	_, err := q.Exec(ctx, `INSERT INTO assistant_run_outbox (run_id) VALUES ($1)
		ON CONFLICT (run_id) DO UPDATE SET next_attempt_at = now(), updated_at = now()`, runID)
	return err
}

func DeleteAssistantRunOutbox(ctx context.Context, q Q, runID uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM assistant_run_outbox WHERE run_id = $1`, runID)
	return err
}

func ListReadyAssistantRunOutboxIDs(ctx context.Context, q Q, now time.Time, limit int) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT outbox.run_id FROM assistant_run_outbox outbox
		JOIN assistant_runs run ON run.id = outbox.run_id
		WHERE outbox.next_attempt_at <= $1 AND run.status = 'queued'
		ORDER BY outbox.created_at ASC, outbox.run_id ASC LIMIT $2`, now, limit)
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

func RecordAssistantRunOutboxFailure(ctx context.Context, q Q, runID uuid.UUID, message string, retryAt time.Time) error {
	_, err := q.Exec(ctx, `UPDATE assistant_run_outbox
		SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3, updated_at = now()
		WHERE run_id = $1`, runID, message, retryAt)
	return err
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
