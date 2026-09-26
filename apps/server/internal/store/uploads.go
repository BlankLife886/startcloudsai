package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	UploadReferenceTaskInput        = "task_input"
	UploadReferenceUserAsset        = "user_asset"
	UploadReferenceUserAvatar       = "user_avatar"
	UploadReferenceUserStudioFigure = "user_studio_figure"
	UploadReferenceAssistantMsg     = "assistant_message"
	UploadReferenceAssistantRun     = "assistant_run"
)

type UserUploadObject struct {
	Key       string
	UserID    uuid.UUID
	SizeBytes int64
	CreatedAt time.Time
}

type UserUploadObjectSize struct {
	Key       string
	SizeBytes int64
}

func isUserUploadObjectKey(userID uuid.UUID, key string) bool {
	parts := strings.Split(strings.TrimSpace(key), "/")
	if len(parts) != 4 || parts[0] != "uploads" || parts[1] != userID.String() {
		return false
	}
	if parts[2] != "original" && parts[2] != "thumb" && parts[2] != "display" {
		return false
	}
	return parts[3] != "" && !strings.Contains(parts[3], "..") && !strings.Contains(parts[3], "\\")
}

func normalizeUserUploadKeys(userID uuid.UUID, keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, raw := range keys {
		key := strings.TrimSpace(raw)
		if !isUserUploadObjectKey(userID, key) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func RegisterUserUploadObjects(ctx context.Context, q Q, userID uuid.UUID, keys []string) error {
	keys = normalizeUserUploadKeys(userID, keys)
	if len(keys) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO user_upload_objects (object_key, user_id)
		SELECT unnest($2::text[]), $1
		ON CONFLICT (object_key) DO NOTHING`, userID, keys)
	return err
}

func LockUserUploadQuota(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 7))`, "upload-quota:"+userID.String())
	return err
}

func UserUploadStorageBytes(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var total int64
	err := q.QueryRow(ctx, `SELECT COALESCE(SUM(size_bytes), 0) FROM user_upload_objects
		WHERE user_id = $1 AND deleted_at IS NULL`, userID).Scan(&total)
	return total, err
}

func RegisterUserUploadObjectSizes(ctx context.Context, q Q, userID uuid.UUID, objects []UserUploadObjectSize) error {
	for _, object := range objects {
		key := strings.TrimSpace(object.Key)
		if !isUserUploadObjectKey(userID, key) || object.SizeBytes < 0 {
			continue
		}
		if _, err := q.Exec(ctx, `INSERT INTO user_upload_objects (object_key, user_id, size_bytes)
			VALUES ($1, $2, $3) ON CONFLICT (object_key) DO NOTHING`, key, userID, object.SizeBytes); err != nil {
			return err
		}
	}
	return nil
}

// RegisterUserUploadObjectsAt is used by the storage reconciler for objects
// discovered in R2 after a process crashed before its database insert.
func RegisterUserUploadObjectsAt(ctx context.Context, q Q, objects []UserUploadObject) error {
	for _, object := range objects {
		if object.CreatedAt.IsZero() || !isUserUploadObjectKey(object.UserID, object.Key) {
			continue
		}
		if _, err := q.Exec(ctx, `INSERT INTO user_upload_objects (object_key, user_id, size_bytes, created_at)
				VALUES ($1, $2, $3, $4) ON CONFLICT (object_key) DO NOTHING`,
			strings.TrimSpace(object.Key), object.UserID, max(object.SizeBytes, 0), object.CreatedAt); err != nil {
			return err
		}
	}
	return nil
}

// LockExistingUserUploadOwners keeps user rows alive while the storage
// reconciler deletes objects. Objects whose owner was already deleted can be
// removed directly because the user's cascaded rows cannot reference them.
func LockExistingUserUploadOwners(ctx context.Context, q Q, userIDs []uuid.UUID) (map[uuid.UUID]struct{}, error) {
	owners := make(map[uuid.UUID]struct{}, len(userIDs))
	if len(userIDs) == 0 {
		return owners, nil
	}
	rows, err := q.Query(ctx, `SELECT id FROM users WHERE id = ANY($1::uuid[]) FOR SHARE`, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		owners[id] = struct{}{}
	}
	return owners, rows.Err()
}

func HasLiveUserUploadObject(ctx context.Context, q Q, userID uuid.UUID, key string) (bool, error) {
	key = strings.TrimSpace(key)
	if !isUserUploadObjectKey(userID, key) {
		return false, nil
	}
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM user_upload_objects
		WHERE object_key = $1 AND user_id = $2 AND deleted_at IS NULL)`, key, userID).Scan(&exists)
	return exists, err
}

func lockLiveUserUploadObjects(ctx context.Context, q Q, keys []string) error {
	rows, err := q.Query(ctx, `SELECT object_key FROM user_upload_objects
		WHERE object_key = ANY($1::text[]) AND deleted_at IS NULL FOR UPDATE`, keys)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := make(map[string]struct{}, len(keys))
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return err
		}
		found[key] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(found) != len(keys) {
		return fmt.Errorf("one or more upload objects are unavailable")
	}
	return nil
}

func AddUserUploadReferences(ctx context.Context, q Q, userID uuid.UUID, referenceType string, referenceID uuid.UUID, keys []string) error {
	if !validUploadReferenceType(referenceType) {
		return fmt.Errorf("invalid upload reference type %q", referenceType)
	}
	keys = normalizeUserUploadKeys(userID, keys)
	if len(keys) == 0 {
		return nil
	}
	if err := LockObjectReferenceKeys(ctx, q, keys); err != nil {
		return err
	}
	if err := RegisterUserUploadObjects(ctx, q, userID, keys); err != nil {
		return err
	}
	if err := lockLiveUserUploadObjects(ctx, q, keys); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `INSERT INTO user_upload_references
		(object_key, reference_type, reference_id)
		SELECT unnest($1::text[]), $2, $3
		ON CONFLICT (object_key, reference_type, reference_id) DO NOTHING`, keys, referenceType, referenceID)
	return err
}

func ReplaceUserUploadReferences(ctx context.Context, q Q, userID uuid.UUID, referenceType string, referenceID uuid.UUID, keys []string) error {
	if err := DeleteUserUploadReferences(ctx, q, referenceType, referenceID); err != nil {
		return err
	}
	return AddUserUploadReferences(ctx, q, userID, referenceType, referenceID, keys)
}

func DeleteUserUploadReferences(ctx context.Context, q Q, referenceType string, referenceID uuid.UUID) error {
	if !validUploadReferenceType(referenceType) {
		return fmt.Errorf("invalid upload reference type %q", referenceType)
	}
	_, err := q.Exec(ctx, `DELETE FROM user_upload_references
		WHERE reference_type = $1 AND reference_id = $2`, referenceType, referenceID)
	return err
}

// IsUserAvatarKey key 是否被某个用户的头像引用。头像会展示给其他登录用户
// （画廊作者、拼团成员等），文件服务据此放开非属主读取。
func IsUserAvatarKey(ctx context.Context, q Q, key string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM user_upload_references
		WHERE object_key = $1 AND reference_type = $2)`,
		strings.TrimSpace(key), UploadReferenceUserAvatar).Scan(&exists)
	return exists, err
}

func validUploadReferenceType(value string) bool {
	switch value {
	case UploadReferenceTaskInput, UploadReferenceUserAsset, UploadReferenceUserAvatar,
		UploadReferenceUserStudioFigure, UploadReferenceAssistantMsg, UploadReferenceAssistantRun,
		UploadReferenceAssistantFile:
		return true
	default:
		return false
	}
}

func DeleteAssistantUploadReferencesForConversation(ctx context.Context, q Q, userID, conversationID uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM user_upload_references r
		WHERE (r.reference_type = $1 AND r.reference_id IN (
			SELECT m.id FROM assistant_messages m
			JOIN assistant_conversations c ON c.id = m.conversation_id
			WHERE m.conversation_id = $2 AND c.user_id = $3
		)) OR (r.reference_type = $4 AND r.reference_id IN (
			SELECT run.id FROM assistant_runs run
			WHERE run.conversation_id = $2 AND run.user_id = $3
		))`, UploadReferenceAssistantMsg, conversationID, userID, UploadReferenceAssistantRun)
	return err
}

func DeleteAssistantUploadReferencesForMessage(ctx context.Context, q Q, userID, messageID uuid.UUID) error {
	_, err := q.Exec(ctx, `DELETE FROM user_upload_references r
		WHERE (r.reference_type = $1 AND r.reference_id = $2 AND EXISTS (
			SELECT 1 FROM assistant_messages message
			JOIN assistant_conversations conversation ON conversation.id = message.conversation_id
			WHERE message.id = $2 AND conversation.user_id = $3
		))
		   OR (r.reference_type = $4 AND r.reference_id IN (
			SELECT run.id FROM assistant_runs run
			WHERE run.user_id = $3 AND (run.user_message_id = $2 OR run.assistant_message_id = $2)
		))`, UploadReferenceAssistantMsg, messageID, userID, UploadReferenceAssistantRun)
	return err
}

func deleteAssistantUploadReferencesInWindow(ctx context.Context, q Q, conversationID, messageID uuid.UUID, includeSource bool) error {
	condition := `m.created_at >= (
			SELECT source.created_at FROM assistant_messages source
			WHERE source.id = $2 AND source.conversation_id = $1
		)`
	if !includeSource {
		condition = `m.id <> $2 AND ` + condition
	}
	_, err := q.Exec(ctx, `WITH doomed_messages AS (
			SELECT m.id FROM assistant_messages m
			WHERE m.conversation_id = $1 AND `+condition+`
		), doomed_runs AS (
			SELECT run.id FROM assistant_runs run
			WHERE run.conversation_id = $1 AND (
				run.user_message_id IN (SELECT id FROM doomed_messages)
				OR run.assistant_message_id IN (SELECT id FROM doomed_messages)
			)
		)
		DELETE FROM user_upload_references r
		WHERE (r.reference_type = $3 AND r.reference_id IN (SELECT id FROM doomed_messages))
		   OR (r.reference_type = $4 AND r.reference_id IN (SELECT id FROM doomed_runs))`,
		conversationID, messageID, UploadReferenceAssistantMsg, UploadReferenceAssistantRun)
	return err
}

func DeleteAssistantUploadReferencesAfter(ctx context.Context, q Q, conversationID, messageID uuid.UUID) error {
	return deleteAssistantUploadReferencesInWindow(ctx, q, conversationID, messageID, false)
}

func DeleteAssistantUploadReferencesFrom(ctx context.Context, q Q, conversationID, messageID uuid.UUID) error {
	return deleteAssistantUploadReferencesInWindow(ctx, q, conversationID, messageID, true)
}

func GetUserUploadCleanupCursor(ctx context.Context, q Q) (string, error) {
	var cursor string
	err := q.QueryRow(ctx, `SELECT cursor FROM user_upload_cleanup_state WHERE id = true FOR UPDATE`).Scan(&cursor)
	return cursor, err
}

func SetUserUploadCleanupCursor(ctx context.Context, q Q, cursor string) error {
	_, err := q.Exec(ctx, `UPDATE user_upload_cleanup_state
		SET cursor = $1, updated_at = now() WHERE id = true`, cursor)
	return err
}

func ListUnreferencedUserUploadObjects(ctx context.Context, q Q, before time.Time, limit int) ([]string, error) {
	if limit <= 0 {
		return []string{}, nil
	}
	rows, err := q.Query(ctx, `SELECT object_key FROM user_upload_objects object
		WHERE object.created_at < $1
		  AND object.deleted_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM user_upload_references reference
			WHERE reference.object_key = object.object_key
		  )
		ORDER BY object.created_at ASC
		LIMIT $2`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]string, 0, limit)
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func ClaimUnreferencedUserUploadObjects(ctx context.Context, q Q, keys []string, before time.Time) ([]string, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT object_key FROM user_upload_objects object
		WHERE object.object_key = ANY($1::text[])
		  AND object.created_at < $2
		  AND object.deleted_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM user_upload_references reference
			WHERE reference.object_key = object.object_key
		  )
		ORDER BY object.created_at ASC
		FOR UPDATE SKIP LOCKED`, keys, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	claimed := make([]string, 0, len(keys))
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		claimed = append(claimed, key)
	}
	return claimed, rows.Err()
}

func MarkUserUploadObjectsDeleted(ctx context.Context, q Q, keys []string) (int64, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	tag, err := q.Exec(ctx, `UPDATE user_upload_objects object SET deleted_at = now()
		WHERE object.object_key = ANY($1::text[])
		  AND object.deleted_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM user_upload_references reference
			WHERE reference.object_key = object.object_key
		  )`, keys)
	return tag.RowsAffected(), err
}
