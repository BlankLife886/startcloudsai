package store

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

const maxObjectCleanupKeys = 1000
const objectReferenceLockNamespace = 5

// EnqueueObjectCleanup records a task/assistant object before its owning row is
// removed or its partial-output references are cleared. The worker checks live
// references again before deleting, so this operation is safe to call from
// destructive transactions and from retry paths.
func EnqueueObjectCleanup(ctx context.Context, q Q, keys []string) error {
	keys, err := normalizeObjectCleanupKeys(keys)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	_, err = q.Exec(ctx, `
		INSERT INTO object_cleanup_jobs (object_key)
		SELECT cleanup_key FROM unnest($1::text[]) AS item(cleanup_key)
		ON CONFLICT (object_key) DO NOTHING`, keys)
	return err
}

// LockObjectReferenceKeys shares an advisory lock with the cleanup worker.
// Reference writers acquire these locks before checking or recording a key, so
// cleanup can recheck after it has waited for any in-flight writer to commit.
func LockObjectReferenceKeys(ctx context.Context, q Q, keys []string) error {
	seen := make(map[string]struct{}, len(keys))
	lockKeys := make([]string, 0, len(keys))
	for _, raw := range keys {
		key := strings.TrimSpace(raw)
		if key == "" || (!strings.HasPrefix(key, "uploads/") && !strings.HasPrefix(key, "tasks/")) {
			continue
		}
		if len(key) > 512 || strings.Contains(key, "..") || strings.Contains(key, "\\") {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		lockKeys = append(lockKeys, key)
	}
	sort.Strings(lockKeys)
	for _, key := range lockKeys {
		if _, err := q.Exec(ctx,
			`SELECT pg_advisory_xact_lock(hashtextextended($1, 5))`, key); err != nil {
			return err
		}
	}
	return nil
}

// LockReadyObjectCleanupJobs locks a bounded batch for the caller's external
// storage operation. Jobs with any current database reference are deliberately
// left queued; a later run can retry after that reference is removed.
func LockReadyObjectCleanupJobs(ctx context.Context, q Q, now time.Time, limit int) ([]string, error) {
	if limit <= 0 {
		return []string{}, nil
	}
	if limit > maxObjectCleanupKeys {
		limit = maxObjectCleanupKeys
	}
	rows, err := q.Query(ctx, `
			WITH candidates AS MATERIALIZED (
				SELECT job.object_key, job.next_attempt_at, job.created_at
				FROM object_cleanup_jobs job
				WHERE job.next_attempt_at <= $1
				ORDER BY job.next_attempt_at, job.created_at, job.object_key
				LIMIT $2
				FOR UPDATE SKIP LOCKED
			), locked AS MATERIALIZED (
				SELECT candidate.object_key, candidate.next_attempt_at, candidate.created_at
				FROM candidates candidate
				CROSS JOIN LATERAL (
					SELECT pg_advisory_xact_lock(hashtextextended(candidate.object_key, 5))
				) advisory_lock
			)
			SELECT locked.object_key
			FROM locked
			WHERE NOT EXISTS (
				SELECT 1
				FROM tasks task
				WHERE EXISTS (
				SELECT 1
				FROM jsonb_array_elements_text(
					CASE WHEN jsonb_typeof(task.input_keys) = 'array'
						THEN task.input_keys ELSE '[]'::jsonb END
				) AS input_key(value)
						WHERE input_key.value = locked.object_key
			)
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements_text(
					CASE WHEN jsonb_typeof(task.output_keys) = 'array'
						THEN task.output_keys ELSE '[]'::jsonb END
				) AS output_key(value)
						WHERE output_key.value = locked.object_key
			)
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements_text(
					CASE WHEN jsonb_typeof(task.thumbnail_keys) = 'array'
						THEN task.thumbnail_keys ELSE '[]'::jsonb END
				) AS thumbnail_key(value)
						WHERE thumbnail_key.value = locked.object_key
					)
					OR task.params->>'maskKey' = locked.object_key
					OR task.params->>'maskBaseKey' = locked.object_key
				)
			  AND NOT EXISTS (
			SELECT 1
			FROM assistant_messages message
			WHERE EXISTS (
				SELECT 1
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'referenceImages') = 'array'
						THEN message.metadata->'referenceImages' ELSE '[]'::jsonb END
				) AS reference(value)
						WHERE reference.value->>'fileKey' = locked.object_key
			)
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'proposal'->'referenceImages') = 'array'
						THEN message.metadata->'proposal'->'referenceImages' ELSE '[]'::jsonb END
				) AS proposal_reference(value)
						WHERE proposal_reference.value->>'fileKey' = locked.object_key
			)
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
						THEN message.metadata->'images' ELSE '[]'::jsonb END
				) AS image(value)
						WHERE image.value->>'fileKey' = locked.object_key
			)
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
						THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END
				) AS proposal_image(value)
						WHERE proposal_image.value->>'fileKey' = locked.object_key
			)
		  )
		  AND NOT EXISTS (
			SELECT 1
			FROM assistant_runs run
			WHERE EXISTS (
				SELECT 1
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(run.params->'referenceImages') = 'array'
						THEN run.params->'referenceImages' ELSE '[]'::jsonb END
				) AS reference(value)
						WHERE reference.value->>'fileKey' = locked.object_key
			)
		  )
		  AND NOT EXISTS (
			SELECT 1
			FROM gallery_submissions submission
				WHERE submission.cover_key = locked.object_key
			   OR EXISTS (
					SELECT 1
					FROM jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(submission.media_keys) = 'array'
							THEN submission.media_keys ELSE '[]'::jsonb END
					) AS media_key(value)
						WHERE media_key.value = locked.object_key
				)
		  )
		  AND NOT EXISTS (
				SELECT 1 FROM prompt_library prompt WHERE prompt.cover_key = locked.object_key
		  )
		  AND NOT EXISTS (
				SELECT 1 FROM prompt_import_items item WHERE item.cover_key = locked.object_key
		  )
		  AND NOT EXISTS (
				SELECT 1 FROM ecommerce_tryon_catalog catalog WHERE catalog.image_key = locked.object_key
		  )
		  AND NOT EXISTS (
				SELECT 1 FROM canvas_workflow_templates template WHERE template.cover_key = locked.object_key
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM canvas_projects project
				WHERE project.document::text LIKE '%' || locked.object_key || '%'
			  )
			ORDER BY locked.next_attempt_at, locked.created_at, locked.object_key`, now, limit)
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

func RecordObjectCleanupFailure(ctx context.Context, q Q, keys []string, message string, nextAttemptAt time.Time) error {
	keys, err := normalizeObjectCleanupKeys(keys)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	if len([]rune(message)) > 2000 {
		message = string([]rune(message)[:2000])
	}
	_, err = q.Exec(ctx, `
		UPDATE object_cleanup_jobs
		SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3
		WHERE object_key = ANY($1::text[])`, keys, strings.TrimSpace(message), nextAttemptAt)
	return err
}

func DeleteObjectCleanupJobs(ctx context.Context, q Q, keys []string) (int64, error) {
	keys, err := normalizeObjectCleanupKeys(keys)
	if err != nil {
		return 0, err
	}
	if len(keys) == 0 {
		return 0, nil
	}
	tag, err := q.Exec(ctx,
		`DELETE FROM object_cleanup_jobs WHERE object_key = ANY($1::text[])`, keys)
	return tag.RowsAffected(), err
}

func normalizeObjectCleanupKeys(keys []string) ([]string, error) {
	if len(keys) > maxObjectCleanupKeys {
		return nil, fmt.Errorf("too many object cleanup keys: %d", len(keys))
	}
	out := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, raw := range keys {
		key := strings.TrimSpace(raw)
		if key == "" {
			continue
		}
		if len(key) > 512 || !strings.HasPrefix(key, "tasks/") || strings.Contains(key, "..") || strings.Contains(key, "\\") {
			return nil, fmt.Errorf("invalid object cleanup key %q", key)
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out, nil
}
