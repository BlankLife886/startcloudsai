package store

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
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
//
// Every reference table is read once for the whole batch, never once per key:
// the per-key form rescanned tasks, assistant history and every canvas document
// for each job and, with a hundred jobs, held the database at full CPU for many
// minutes while generation tasks waited behind it.
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
		), batch AS MATERIALIZED (
			-- Built from locked, so every reference below is read after the
			-- advisory locks are held.
			SELECT COALESCE(array_agg(object_key), '{}'::text[]) AS keys FROM locked
		), task_refs AS MATERIALIZED (
			SELECT task.input_keys, task.output_keys, task.thumbnail_keys,
				task.params->>'maskKey' AS mask_key, task.params->>'maskBaseKey' AS mask_base_key
			FROM tasks task, batch
			WHERE task.input_keys ?| batch.keys
			   OR task.output_keys ?| batch.keys
			   OR task.thumbnail_keys ?| batch.keys
			   OR task.params->>'maskKey' = ANY(batch.keys)
			   OR task.params->>'maskBaseKey' = ANY(batch.keys)
		), gallery_refs AS MATERIALIZED (
			SELECT submission.cover_key, submission.media_keys
			FROM gallery_submissions submission, batch
			WHERE submission.cover_key = ANY(batch.keys)
			   OR submission.media_keys ?| batch.keys
		), assistant_ref_keys AS MATERIALIZED (
			SELECT image.value->>'fileKey' AS object_key
			FROM assistant_messages message
			CROSS JOIN LATERAL (
				SELECT value FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'referenceImages') = 'array'
						THEN message.metadata->'referenceImages' ELSE '[]'::jsonb END)
				UNION ALL
				SELECT value FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'proposal'->'referenceImages') = 'array'
						THEN message.metadata->'proposal'->'referenceImages' ELSE '[]'::jsonb END)
				UNION ALL
				SELECT value FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'images') = 'array'
						THEN message.metadata->'images' ELSE '[]'::jsonb END)
				UNION ALL
				SELECT value FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(message.metadata->'proposal'->'images') = 'array'
						THEN message.metadata->'proposal'->'images' ELSE '[]'::jsonb END)
			) image
			WHERE message.metadata ?| ARRAY['referenceImages', 'images', 'proposal']
			  AND image.value->>'fileKey' = ANY((SELECT keys FROM batch)::text[])
			UNION
			SELECT reference.value->>'fileKey'
			FROM assistant_runs run
			CROSS JOIN LATERAL jsonb_array_elements(
				CASE WHEN jsonb_typeof(run.params->'referenceImages') = 'array'
					THEN run.params->'referenceImages' ELSE '[]'::jsonb END) AS reference(value)
			WHERE run.params ? 'referenceImages'
			  AND reference.value->>'fileKey' = ANY((SELECT keys FROM batch)::text[])
		), column_ref_keys AS MATERIALIZED (
			SELECT reference.object_key FROM user_upload_references reference, batch
			WHERE reference.object_key = ANY(batch.keys)
			UNION
			SELECT prompt.cover_key FROM prompt_library prompt, batch
			WHERE prompt.cover_key = ANY(batch.keys)
			UNION
			SELECT item.cover_key FROM prompt_import_items item, batch
			WHERE item.cover_key = ANY(batch.keys)
			UNION
			SELECT catalog.image_key FROM ecommerce_tryon_catalog catalog, batch
			WHERE catalog.image_key = ANY(batch.keys)
			UNION
			SELECT template.cover_key FROM canvas_workflow_templates template, batch
			WHERE template.cover_key = ANY(batch.keys)
		), canvas_ref_keys AS MATERIALIZED (
			-- OFFSET 0 keeps the document rendered to text once per project;
			-- the keys are then matched against that single copy.
			SELECT DISTINCT hit.object_key
			FROM canvas_projects project
			CROSS JOIN LATERAL (SELECT project.document::text AS document OFFSET 0) rendered
			CROSS JOIN LATERAL unnest((SELECT keys FROM batch)) AS hit(object_key)
			WHERE strpos(rendered.document, hit.object_key) > 0
		)
		SELECT locked.object_key
		FROM locked
		WHERE NOT EXISTS (
			SELECT 1 FROM task_refs task
			WHERE (jsonb_typeof(task.input_keys) = 'array' AND task.input_keys ? locked.object_key)
			   OR (jsonb_typeof(task.output_keys) = 'array' AND task.output_keys ? locked.object_key)
			   OR (jsonb_typeof(task.thumbnail_keys) = 'array' AND task.thumbnail_keys ? locked.object_key)
			   OR task.mask_key = locked.object_key
			   OR task.mask_base_key = locked.object_key
		)
		  AND NOT EXISTS (
			SELECT 1 FROM gallery_refs submission
			WHERE submission.cover_key = locked.object_key
			   OR (jsonb_typeof(submission.media_keys) = 'array' AND submission.media_keys ? locked.object_key)
		)
		  AND NOT EXISTS (SELECT 1 FROM assistant_ref_keys ref WHERE ref.object_key = locked.object_key)
		  AND NOT EXISTS (SELECT 1 FROM column_ref_keys ref WHERE ref.object_key = locked.object_key)
		  AND NOT EXISTS (SELECT 1 FROM canvas_ref_keys ref WHERE ref.object_key = locked.object_key)
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
		if !validObjectCleanupKey(key) {
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

func validObjectCleanupKey(key string) bool {
	if len(key) == 0 || len(key) > 512 || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return false
	}
	if strings.HasPrefix(key, "tasks/") {
		return len(strings.TrimPrefix(key, "tasks/")) > 0
	}
	parts := strings.Split(key, "/")
	if len(parts) != 4 || parts[0] != "uploads" || parts[3] == "" {
		return false
	}
	if parts[2] != "original" && parts[2] != "thumb" && parts[2] != "display" {
		return false
	}
	_, err := uuid.Parse(parts[1])
	return err == nil
}
