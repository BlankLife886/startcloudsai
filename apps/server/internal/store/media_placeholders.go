package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
)

const DeletedMediaPlaceholderMessage = "该图片已被删除"

var deletedMediaValueFields = map[string]struct{}{
	"content":      {},
	"dataUrl":      {},
	"displayUrl":   {},
	"fileKey":      {},
	"sourceUrl":    {},
	"storageKey":   {},
	"thumbnailKey": {},
	"thumbnailUrl": {},
	"thumbUrl":     {},
	"url":          {},
}

func mediaValueReferencesKey(value any, keys map[string]struct{}) bool {
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return false
	}
	for key := range keys {
		if text == key || strings.Contains(text, key) {
			return true
		}
	}
	return false
}

func replaceDeletedMediaReferences(value any, keys map[string]struct{}, deletedAt string) (any, bool) {
	switch current := value.(type) {
	case []any:
		changed := false
		for index, item := range current {
			next, itemChanged := replaceDeletedMediaReferences(item, keys, deletedAt)
			if itemChanged {
				current[index] = next
				changed = true
			}
		}
		return current, changed
	case map[string]any:
		changed := false
		directReference := false
		for field, item := range current {
			if _, mediaField := deletedMediaValueFields[field]; mediaField && mediaValueReferencesKey(item, keys) {
				directReference = true
			}
			next, itemChanged := replaceDeletedMediaReferences(item, keys, deletedAt)
			if itemChanged {
				current[field] = next
				changed = true
			}
		}
		if !directReference {
			return current, changed
		}
		for field := range deletedMediaValueFields {
			delete(current, field)
		}
		current["deleted"] = true
		current["deletedByHistory"] = true
		current["deletedAt"] = deletedAt
		current["deletionMessage"] = DeletedMediaPlaceholderMessage
		current["errorDetails"] = DeletedMediaPlaceholderMessage
		current["status"] = "error"
		return current, true
	default:
		return value, false
	}
}

type deletedMediaJSONRow struct {
	id  uuid.UUID
	raw json.RawMessage
}

func loadDeletedMediaJSONRows(ctx context.Context, q Q, query string, userID uuid.UUID, keys []string) ([]deletedMediaJSONRow, error) {
	rows, err := q.Query(ctx, query, userID, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]deletedMediaJSONRow, 0)
	for rows.Next() {
		var item deletedMediaJSONRow
		if err := rows.Scan(&item.id, &item.raw); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func deletedMediaKeySet(keys []string) map[string]struct{} {
	set := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if key = strings.TrimSpace(key); key != "" {
			set[key] = struct{}{}
		}
	}
	return set
}

func replacedDeletedMediaJSON(raw json.RawMessage, keys map[string]struct{}, deletedAt string) (json.RawMessage, bool, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false, err
	}
	value, changed := replaceDeletedMediaReferences(value, keys, deletedAt)
	if !changed {
		return raw, false, nil
	}
	next, err := json.Marshal(value)
	return next, true, err
}

// ReplaceUserMediaReferencesWithDeletedPlaceholders detaches user-owned media
// references before forced object removal while preserving message and canvas
// structure. Every updated canvas revision invalidates stale browser snapshots.
func ReplaceUserMediaReferencesWithDeletedPlaceholders(ctx context.Context, q Q, userID uuid.UUID, keys []string, deletedAt time.Time) error {
	keySet := deletedMediaKeySet(keys)
	if len(keySet) == 0 {
		return nil
	}
	keys = keys[:0]
	for key := range keySet {
		keys = append(keys, key)
	}
	stamp := deletedAt.UTC().Format(time.RFC3339Nano)

	messages, err := loadDeletedMediaJSONRows(ctx, q, `
		SELECT message.id, message.metadata
		FROM assistant_messages message
		JOIN assistant_conversations conversation ON conversation.id = message.conversation_id
		WHERE conversation.user_id = $1
		  AND EXISTS (SELECT 1 FROM unnest($2::text[]) key WHERE strpos(message.metadata::text, key) > 0)
		FOR UPDATE OF message`, userID, keys)
	if err != nil {
		return err
	}
	for _, item := range messages {
		next, changed, err := replacedDeletedMediaJSON(item.raw, keySet, stamp)
		if err != nil {
			return err
		}
		if changed {
			if _, err := q.Exec(ctx, `UPDATE assistant_messages SET metadata = $2, updated_at = now() WHERE id = $1`, item.id, next); err != nil {
				return err
			}
		}
	}

	runs, err := loadDeletedMediaJSONRows(ctx, q, `
		SELECT id, params FROM assistant_runs
		WHERE user_id = $1
		  AND EXISTS (SELECT 1 FROM unnest($2::text[]) key WHERE strpos(params::text, key) > 0)
		FOR UPDATE`, userID, keys)
	if err != nil {
		return err
	}
	for _, item := range runs {
		next, changed, err := replacedDeletedMediaJSON(item.raw, keySet, stamp)
		if err != nil {
			return err
		}
		if changed {
			if _, err := q.Exec(ctx, `UPDATE assistant_runs SET params = $2 WHERE id = $1`, item.id, next); err != nil {
				return err
			}
		}
	}

	projects, err := loadDeletedMediaJSONRows(ctx, q, `
		SELECT id, document FROM canvas_projects
		WHERE user_id = $1
		  AND EXISTS (SELECT 1 FROM unnest($2::text[]) key WHERE strpos(document::text, key) > 0)
		FOR UPDATE`, userID, keys)
	if err != nil {
		return err
	}
	for _, item := range projects {
		next, changed, err := replacedDeletedMediaJSON(item.raw, keySet, stamp)
		if err != nil {
			return err
		}
		if changed {
			if _, err := q.Exec(ctx, `UPDATE canvas_projects SET document = $2, revision = revision + 1, updated_at = now() WHERE id = $1`, item.id, next); err != nil {
				return err
			}
		}
	}
	return nil
}
