package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type PromptImportBatch struct {
	ID                uuid.UUID
	Status            string
	AnalysisMode      string
	SourceCount       int
	FetchedCount      int
	UniqueCount       int
	DuplicateCount    int
	ApprovedCount     int
	RejectedCount     int
	ImportedCount     int
	UpdatedCount      int
	FailedSourceCount int
	Error             string
	CreatedAt         time.Time
	AnalyzedAt        *time.Time
	CompletedAt       *time.Time
}

type PromptImportItem struct {
	ID                 uuid.UUID  `json:"id"`
	BatchID            uuid.UUID  `json:"batch_id"`
	SourceID           string     `json:"source_id"`
	SourceName         string     `json:"source_name"`
	SourceItemKey      string     `json:"source_item_key"`
	Title              string     `json:"title"`
	Prompt             string     `json:"prompt"`
	TaskType           string     `json:"task_type"`
	Category           string     `json:"category"`
	Tags               []string   `json:"tags"`
	CoverKey           string     `json:"cover_key"`
	ContentFingerprint string     `json:"content_fingerprint"`
	DuplicateKind      string     `json:"duplicate_kind"`
	DuplicateRefID     *uuid.UUID `json:"duplicate_ref_id"`
	DuplicateTitle     string     `json:"duplicate_title"`
	DuplicateAction    string     `json:"duplicate_action"`
	ComplianceStatus   string     `json:"compliance_status"`
	ComplianceReason   string     `json:"compliance_reason"`
	AssetOrigin        string     `json:"asset_origin"`
	AssetStatus        string     `json:"asset_status"`
	AssetNote          string     `json:"asset_note"`
	ReviewStatus       string     `json:"review_status"`
	ReviewNote         string     `json:"review_note"`
	PublishedPromptID  *uuid.UUID `json:"published_prompt_id"`
	PublishedAt        *time.Time `json:"published_at"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type PromptImportItemPatch struct {
	Category         *string
	DuplicateKind    *string
	DuplicateRefID   *uuid.UUID
	DuplicateTitle   *string
	DuplicateAction  *string
	ComplianceStatus *string
	ComplianceReason *string
	ReviewStatus     *string
	ReviewNote       *string
}

type PromptFingerprintMatch struct {
	ID            uuid.UUID
	Title         string
	SourceID      string
	SourceItemKey string
}

func PromptContentFingerprint(value string) string {
	normalized := strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

const promptImportBatchCols = `id, status, analysis_mode, source_count, fetched_count, unique_count,
	duplicate_count, approved_count, rejected_count, imported_count, updated_count,
	failed_source_count, error, created_at, analyzed_at, completed_at`

func scanPromptImportBatch(row pgx.Row) (*PromptImportBatch, error) {
	var batch PromptImportBatch
	err := row.Scan(&batch.ID, &batch.Status, &batch.AnalysisMode, &batch.SourceCount,
		&batch.FetchedCount, &batch.UniqueCount, &batch.DuplicateCount,
		&batch.ApprovedCount, &batch.RejectedCount, &batch.ImportedCount,
		&batch.UpdatedCount, &batch.FailedSourceCount, &batch.Error, &batch.CreatedAt,
		&batch.AnalyzedAt, &batch.CompletedAt)
	if err != nil {
		return nil, err
	}
	return &batch, nil
}

func CreatePromptImportBatch(ctx context.Context, q Q, mode string, sourceCount int) (*PromptImportBatch, error) {
	return scanPromptImportBatch(q.QueryRow(ctx,
		`INSERT INTO prompt_import_batches (analysis_mode, source_count)
		 VALUES ($1, $2) RETURNING `+promptImportBatchCols, mode, sourceCount))
}

func GetOpenPromptImportBatch(ctx context.Context, q Q) (*PromptImportBatch, error) {
	batch, err := scanPromptImportBatch(q.QueryRow(ctx, `SELECT `+promptImportBatchCols+`
		FROM prompt_import_batches WHERE status IN ('fetching','review','publishing')
		ORDER BY created_at DESC LIMIT 1`))
	return nilOnNoRows(batch, err)
}

func GetPromptImportBatch(ctx context.Context, q Q, id uuid.UUID) (*PromptImportBatch, error) {
	batch, err := scanPromptImportBatch(q.QueryRow(ctx,
		`SELECT `+promptImportBatchCols+` FROM prompt_import_batches WHERE id = $1`, id))
	return nilOnNoRows(batch, err)
}

func ListPromptImportBatches(ctx context.Context, q Q, limit int) ([]*PromptImportBatch, error) {
	rows, err := q.Query(ctx, `SELECT `+promptImportBatchCols+`
		FROM prompt_import_batches ORDER BY created_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*PromptImportBatch, 0)
	for rows.Next() {
		batch, err := scanPromptImportBatch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, batch)
	}
	return out, rows.Err()
}

func FindPromptFingerprintMatches(ctx context.Context, q Q, fingerprints []string) (map[string]PromptFingerprintMatch, error) {
	out := make(map[string]PromptFingerprintMatch)
	if len(fingerprints) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT ON (content_fingerprint)
		content_fingerprint, id, title, source_id, source_item_key FROM prompt_library
		WHERE content_fingerprint = ANY($1) ORDER BY content_fingerprint, created_at DESC`, fingerprints)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var fingerprint string
		var match PromptFingerprintMatch
		if err := rows.Scan(&fingerprint, &match.ID, &match.Title, &match.SourceID, &match.SourceItemKey); err != nil {
			return nil, err
		}
		out[fingerprint] = match
	}
	return out, rows.Err()
}

func InsertPromptImportItems(ctx context.Context, q Q, items []*PromptImportItem) error {
	if len(items) == 0 {
		return nil
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO prompt_import_items
		(id, batch_id, source_id, source_name, source_item_key, title, prompt, task_type,
		 category, tags, cover_key, content_fingerprint, duplicate_kind, duplicate_ref_id,
		 duplicate_title, duplicate_action, compliance_status, compliance_reason,
		 asset_origin, asset_status, asset_note, review_status, review_note)
	SELECT x.id, x.batch_id, x.source_id, x.source_name, x.source_item_key, x.title, x.prompt,
		x.task_type, x.category, COALESCE(x.tags, '[]'::jsonb), NULLIF(x.cover_key, ''),
		x.content_fingerprint, x.duplicate_kind, x.duplicate_ref_id, x.duplicate_title,
		x.duplicate_action, x.compliance_status, x.compliance_reason, x.asset_origin,
		x.asset_status, x.asset_note, x.review_status, x.review_note
	FROM jsonb_to_recordset($1::jsonb) AS x(
		id uuid, batch_id uuid, source_id text, source_name text, source_item_key text,
		title text, prompt text, task_type text, category text, tags jsonb, cover_key text,
		content_fingerprint text, duplicate_kind text, duplicate_ref_id uuid,
		duplicate_title text, duplicate_action text, compliance_status text,
		compliance_reason text, asset_origin text, asset_status text, asset_note text,
		review_status text, review_note text)`, raw)
	return err
}

func FinishPromptImportFetch(ctx context.Context, q Q, id uuid.UUID, fetched, unique, duplicates, failedSources int, batchErr string) error {
	status := "review"
	if fetched == 0 {
		status = "failed"
	}
	_, err := q.Exec(ctx, `UPDATE prompt_import_batches SET status = $2, fetched_count = $3,
		unique_count = $4, duplicate_count = $5, failed_source_count = $6, error = $7,
		analyzed_at = now() WHERE id = $1`, id, status, fetched, unique, duplicates, failedSources, batchErr)
	return err
}

const promptImportItemCols = `id, batch_id, source_id, source_name, source_item_key, title, prompt,
	task_type, category, tags, COALESCE(cover_key, ''), content_fingerprint, duplicate_kind,
	duplicate_ref_id, duplicate_title, duplicate_action, compliance_status, compliance_reason,
	asset_origin, asset_status, asset_note, review_status, review_note, published_prompt_id,
	published_at, created_at, updated_at`

func scanPromptImportItem(row pgx.Row) (*PromptImportItem, error) {
	var item PromptImportItem
	err := row.Scan(&item.ID, &item.BatchID, &item.SourceID, &item.SourceName,
		&item.SourceItemKey, &item.Title, &item.Prompt, &item.TaskType, &item.Category,
		&item.Tags, &item.CoverKey, &item.ContentFingerprint, &item.DuplicateKind,
		&item.DuplicateRefID, &item.DuplicateTitle, &item.DuplicateAction,
		&item.ComplianceStatus, &item.ComplianceReason, &item.AssetOrigin, &item.AssetStatus,
		&item.AssetNote, &item.ReviewStatus, &item.ReviewNote, &item.PublishedPromptID,
		&item.PublishedAt, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func ListPromptImportItems(ctx context.Context, q Q, batchID uuid.UUID, view string, limit int, offset int) ([]*PromptImportItem, int, error) {
	where := `batch_id = $1`
	switch view {
	case "duplicates":
		where += ` AND duplicate_kind <> 'none'`
	case "pending":
		where += ` AND (review_status = 'pending' OR compliance_status = 'pending' OR
			duplicate_action = 'pending')`
	case "approved":
		where += ` AND review_status = 'approved'`
	case "rejected":
		where += ` AND review_status = 'rejected'`
	}
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM prompt_import_items WHERE `+where, batchID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx, `SELECT `+promptImportItemCols+` FROM prompt_import_items WHERE `+where+`
		ORDER BY CASE WHEN duplicate_action = 'pending' THEN 0 ELSE 1 END,
		CASE WHEN compliance_status = 'blocked' THEN 0 ELSE 1 END, created_at ASC, id ASC
		LIMIT $2 OFFSET $3`, batchID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]*PromptImportItem, 0)
	for rows.Next() {
		item, err := scanPromptImportItem(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, total, rows.Err()
}

func GetPromptImportItem(ctx context.Context, q Q, batchID, itemID uuid.UUID) (*PromptImportItem, error) {
	item, err := scanPromptImportItem(q.QueryRow(ctx, `SELECT `+promptImportItemCols+`
		FROM prompt_import_items WHERE batch_id = $1 AND id = $2`, batchID, itemID))
	return nilOnNoRows(item, err)
}

func PatchPromptImportItem(ctx context.Context, q Q, batchID, itemID uuid.UUID, patch PromptImportItemPatch) (*PromptImportItem, error) {
	sets := []string{"updated_at = now()"}
	args := []any{batchID, itemID}
	add := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	if patch.Category != nil {
		add("category", *patch.Category)
	}
	if patch.DuplicateKind != nil {
		add("duplicate_kind", *patch.DuplicateKind)
	}
	if patch.DuplicateRefID != nil {
		add("duplicate_ref_id", *patch.DuplicateRefID)
	}
	if patch.DuplicateTitle != nil {
		add("duplicate_title", *patch.DuplicateTitle)
	}
	if patch.DuplicateAction != nil {
		add("duplicate_action", *patch.DuplicateAction)
	}
	if patch.ComplianceStatus != nil {
		add("compliance_status", *patch.ComplianceStatus)
	}
	if patch.ComplianceReason != nil {
		add("compliance_reason", *patch.ComplianceReason)
	}
	if patch.ReviewStatus != nil {
		add("review_status", *patch.ReviewStatus)
	}
	if patch.ReviewNote != nil {
		add("review_note", *patch.ReviewNote)
	}
	item, err := scanPromptImportItem(q.QueryRow(ctx, `UPDATE prompt_import_items SET `+
		strings.Join(sets, ", ")+` WHERE batch_id = $1 AND id = $2 AND published_at IS NULL RETURNING `+promptImportItemCols, args...))
	return nilOnNoRows(item, err)
}

func UpdatePromptImportItemCover(ctx context.Context, q Q, batchID, itemID uuid.UUID, coverKey, note string) (*PromptImportItem, error) {
	item, err := scanPromptImportItem(q.QueryRow(ctx, `UPDATE prompt_import_items SET
		cover_key = $3, asset_origin = 'owned_storage', asset_status = 'not_required', asset_note = $4,
		updated_at = now() WHERE batch_id = $1 AND id = $2 AND published_at IS NULL
		RETURNING `+promptImportItemCols, batchID, itemID, coverKey, note))
	return nilOnNoRows(item, err)
}

func MarkPromptImportBatchAnalyzed(ctx context.Context, q Q, batchID uuid.UUID, mode string) error {
	_, err := q.Exec(ctx, `UPDATE prompt_import_batches SET analysis_mode = $2, analyzed_at = now()
		WHERE id = $1 AND status = 'review'`, batchID, mode)
	return err
}

func BulkReviewPromptImportItems(ctx context.Context, q Q, batchID uuid.UUID, action string, itemIDs []uuid.UUID) (int64, error) {
	var sql string
	selectedOnly := len(itemIDs) > 0
	switch action {
	case "approve-selected":
		if !selectedOnly {
			return 0, errors.New("请选择需要通过的审核项")
		}
		sql = `UPDATE prompt_import_items SET compliance_status = 'safe', duplicate_action = 'keep',
			review_status = 'approved', updated_at = now()
			WHERE batch_id = $1 AND published_at IS NULL
			AND (NOT $3 OR id = ANY($2))`
	case "approve-all":
		sql = `UPDATE prompt_import_items SET compliance_status = 'safe', duplicate_action = 'keep',
			review_status = 'approved', updated_at = now()
			WHERE batch_id = $1 AND published_at IS NULL AND review_status <> 'rejected'
			AND (NOT $3 OR id = ANY($2))`
	case "reject-selected":
		if !selectedOnly {
			return 0, errors.New("请选择需要移除的审核项")
		}
		sql = `UPDATE prompt_import_items SET review_status = 'rejected', updated_at = now()
			WHERE batch_id = $1 AND published_at IS NULL AND id = ANY($2)`
	case "approve-safe":
		sql = `UPDATE prompt_import_items SET review_status = 'approved', updated_at = now()
			WHERE batch_id = $1 AND compliance_status = 'safe' AND duplicate_action = 'keep'
			AND published_at IS NULL`
	case "reject-blocked":
		sql = `UPDATE prompt_import_items SET review_status = 'rejected', updated_at = now()
			WHERE batch_id = $1 AND compliance_status = 'blocked' AND published_at IS NULL`
	case "drop-duplicates":
		sql = `UPDATE prompt_import_items SET duplicate_action = 'drop', review_status = 'rejected',
			updated_at = now() WHERE batch_id = $1 AND duplicate_kind <> 'none'
			AND duplicate_action = 'pending' AND published_at IS NULL`
	case "keep-duplicates":
		sql = `UPDATE prompt_import_items SET duplicate_action = 'keep', updated_at = now()
			WHERE batch_id = $1 AND duplicate_kind <> 'none' AND duplicate_action = 'pending'
			AND published_at IS NULL`
	default:
		return 0, fmt.Errorf("unsupported bulk review action: %s", action)
	}
	var result pgconn.CommandTag
	var err error
	if action == "approve-selected" || action == "approve-all" || action == "reject-selected" {
		result, err = q.Exec(ctx, sql, batchID, itemIDs, selectedOnly)
	} else {
		result, err = q.Exec(ctx, sql, batchID)
	}
	return result.RowsAffected(), err
}

func RefreshPromptImportBatchCounts(ctx context.Context, q Q, batchID uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE prompt_import_batches b SET
		approved_count = s.approved, rejected_count = s.rejected,
		duplicate_count = s.duplicates, unique_count = s.total - s.duplicates,
		status = CASE WHEN s.pending = 0 THEN 'completed' ELSE 'review' END,
		completed_at = CASE WHEN s.pending = 0 THEN COALESCE(b.completed_at, now()) ELSE NULL END
	FROM (SELECT count(*) FILTER (WHERE review_status = 'approved') approved,
		count(*) FILTER (WHERE review_status = 'rejected') rejected,
		count(*) FILTER (WHERE duplicate_kind <> 'none') duplicates,
		count(*) FILTER (WHERE review_status = 'pending' OR
			(review_status = 'approved' AND published_at IS NULL)) pending,
		count(*) total
		FROM prompt_import_items WHERE batch_id = $1) s WHERE b.id = $1`, batchID)
	return err
}

func PublishApprovedPromptImportItems(ctx context.Context, st *Store, batchID uuid.UUID, itemIDs []uuid.UUID) (int, int, error) {
	imported, updated := 0, 0
	err := st.Tx(ctx, func(tx pgx.Tx) error {
		maxSort, err := MaxPromptSort(ctx, tx)
		if err != nil {
			return err
		}
		selectedOnly := len(itemIDs) > 0
		if err := tx.QueryRow(ctx, `WITH eligible AS MATERIALIZED (
			SELECT i.* FROM prompt_import_items i
			WHERE i.batch_id = $1 AND i.review_status = 'approved' AND i.published_at IS NULL
				AND i.compliance_status = 'safe' AND i.duplicate_action = 'keep'
				AND (NOT $4 OR i.id = ANY($3))
			FOR UPDATE
		), upserted AS (
			INSERT INTO prompt_library (title, prompt, task_type, category, tags, cover_key, sort,
				active, source_id, source_item_key, new_until, content_fingerprint,
				asset_origin, asset_verified, asset_verified_at, asset_note)
			SELECT i.title, i.prompt, i.task_type, i.category, i.tags, i.cover_key,
				$2 + row_number() OVER (ORDER BY i.created_at, i.id), true, i.source_id,
				i.source_item_key, now() + interval '24 hours', i.content_fingerprint,
				i.asset_origin, true, now(), ''
			FROM eligible i
			ON CONFLICT (source_id, source_item_key) WHERE source_id <> '' AND source_item_key <> ''
			DO UPDATE SET title = EXCLUDED.title, prompt = EXCLUDED.prompt,
				task_type = EXCLUDED.task_type, category = EXCLUDED.category, tags = EXCLUDED.tags,
				cover_key = EXCLUDED.cover_key, content_fingerprint = EXCLUDED.content_fingerprint,
				asset_origin = EXCLUDED.asset_origin, asset_verified = EXCLUDED.asset_verified,
				asset_verified_at = EXCLUDED.asset_verified_at, asset_note = EXCLUDED.asset_note
			RETURNING id, source_id, source_item_key, (xmax = 0) AS inserted
		), marked AS (
			UPDATE prompt_import_items i SET published_prompt_id = u.id, published_at = now(),
				updated_at = now()
			FROM upserted u WHERE i.batch_id = $1 AND i.source_id = u.source_id
				AND i.source_item_key = u.source_item_key AND i.published_at IS NULL
				AND (NOT $4 OR i.id = ANY($3))
			RETURNING u.inserted
		)
		SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) FROM marked`,
			batchID, maxSort, itemIDs, selectedOnly).Scan(&imported, &updated); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE prompt_import_batches SET imported_count = imported_count + $2,
			updated_count = updated_count + $3 WHERE id = $1`, batchID, imported, updated); err != nil {
			return err
		}
		return RefreshPromptImportBatchCounts(ctx, tx, batchID)
	})
	return imported, updated, err
}

func PublishPromptImportBatch(ctx context.Context, st *Store, batchID uuid.UUID) (int, int, error) {
	return PublishApprovedPromptImportItems(ctx, st, batchID, nil)
}
