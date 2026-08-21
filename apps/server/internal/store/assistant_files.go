package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const UploadReferenceAssistantFile = "assistant_file"

const assistantFileCols = `id, user_id, object_key, name, content_type, size_bytes, sha256,
	status, parser_version, page_count, char_count, segment_count, attempt,
	lease_owner, lease_until, error_code, error_message, created_at, updated_at, finished_at`

type AssistantFile struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	ObjectKey     string
	Name          string
	ContentType   string
	SizeBytes     int64
	SHA256        string
	Status        string
	ParserVersion string
	PageCount     int
	CharCount     int
	SegmentCount  int
	Attempt       int
	LeaseOwner    *string
	LeaseUntil    *time.Time
	ErrorCode     *string
	ErrorMessage  *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	FinishedAt    *time.Time
}

type AssistantFileSegment struct {
	ID      int64
	FileID  uuid.UUID
	Ordinal int
	Locator map[string]any
	Content string
}

func scanAssistantFile(row pgx.Row) (*AssistantFile, error) {
	var item AssistantFile
	if err := row.Scan(&item.ID, &item.UserID, &item.ObjectKey, &item.Name, &item.ContentType,
		&item.SizeBytes, &item.SHA256, &item.Status, &item.ParserVersion, &item.PageCount,
		&item.CharCount, &item.SegmentCount, &item.Attempt, &item.LeaseOwner, &item.LeaseUntil,
		&item.ErrorCode, &item.ErrorMessage, &item.CreatedAt, &item.UpdatedAt, &item.FinishedAt); err != nil {
		return nil, err
	}
	return &item, nil
}

func InsertAssistantFile(ctx context.Context, q Q, item AssistantFile) (*AssistantFile, error) {
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now().UTC()
	}
	return scanAssistantFile(q.QueryRow(ctx, `INSERT INTO assistant_files
		(id, user_id, object_key, name, content_type, size_bytes, sha256, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING `+assistantFileCols,
		item.ID, item.UserID, item.ObjectKey, item.Name, item.ContentType, item.SizeBytes, item.SHA256, item.CreatedAt))
}

func GetUserAssistantFile(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantFile, error) {
	item, err := scanAssistantFile(q.QueryRow(ctx, `SELECT `+assistantFileCols+`
		FROM assistant_files WHERE id = $1 AND user_id = $2`, id, userID))
	return nilOnNoRows(item, err)
}

func GetAssistantFile(ctx context.Context, q Q, id uuid.UUID) (*AssistantFile, error) {
	item, err := scanAssistantFile(q.QueryRow(ctx, `SELECT `+assistantFileCols+`
		FROM assistant_files WHERE id = $1`, id))
	return nilOnNoRows(item, err)
}

func ListUserAssistantFilesByIDs(ctx context.Context, q Q, userID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]*AssistantFile, error) {
	out := make(map[uuid.UUID]*AssistantFile, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT `+assistantFileCols+`
		FROM assistant_files WHERE user_id = $1 AND id = ANY($2::uuid[])`, userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := scanAssistantFile(rows)
		if err != nil {
			return nil, err
		}
		out[item.ID] = item
	}
	return out, rows.Err()
}

func ListUserAssistantFiles(ctx context.Context, q Q, userID uuid.UUID, limit int) ([]*AssistantFile, error) {
	if limit <= 0 {
		return []*AssistantFile{}, nil
	}
	rows, err := q.Query(ctx, `SELECT `+assistantFileCols+`
		FROM assistant_files WHERE user_id = $1
		ORDER BY created_at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*AssistantFile, 0)
	for rows.Next() {
		item, err := scanAssistantFile(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ListPendingAssistantFileIDs(ctx context.Context, q Q, now time.Time, limit int) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT id FROM assistant_files
		WHERE status = 'queued' OR (status = 'processing' AND lease_until <= $1)
		ORDER BY created_at ASC, id ASC LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func ClaimAssistantFileIngestion(
	ctx context.Context,
	q Q,
	id uuid.UUID,
	owner string,
	now time.Time,
	lease time.Duration,
) (*AssistantFile, error) {
	item, err := scanAssistantFile(q.QueryRow(ctx, `UPDATE assistant_files
		SET status = 'processing', attempt = attempt + 1, lease_owner = $2, lease_until = $4,
			error_code = NULL, error_message = NULL, updated_at = $3
		WHERE id = $1 AND (status = 'queued' OR (status = 'processing' AND lease_until <= $3))
		RETURNING `+assistantFileCols, id, owner, now, now.Add(lease)))
	return nilOnNoRows(item, err)
}

func RenewAssistantFileIngestionLease(
	ctx context.Context,
	q Q,
	id uuid.UUID,
	attempt int,
	owner string,
	now time.Time,
	lease time.Duration,
) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE assistant_files SET lease_until = $5, updated_at = $4
		WHERE id = $1 AND status = 'processing' AND attempt = $2 AND lease_owner = $3 AND lease_until > $4`,
		id, attempt, owner, now, now.Add(lease))
	return tag.RowsAffected() > 0, err
}

func CompleteAssistantFileIngestion(
	ctx context.Context,
	tx pgx.Tx,
	file *AssistantFile,
	parserVersion string,
	pageCount int,
	charCount int,
	segments []AssistantFileSegment,
) (bool, error) {
	if file == nil || file.LeaseOwner == nil {
		return false, nil
	}
	if _, err := tx.Exec(ctx, `DELETE FROM assistant_file_segments WHERE file_id = $1`, file.ID); err != nil {
		return false, err
	}
	for index, segment := range segments {
		locator, err := json.Marshal(segment.Locator)
		if err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO assistant_file_segments (file_id, ordinal, locator, content)
			VALUES ($1,$2,$3,$4)`, file.ID, index, locator, segment.Content); err != nil {
			return false, err
		}
	}
	tag, err := tx.Exec(ctx, `UPDATE assistant_files SET status = 'ready', parser_version = $4,
		page_count = $5, char_count = $6, segment_count = $7,
		lease_owner = NULL, lease_until = NULL, error_code = NULL, error_message = NULL,
		updated_at = now(), finished_at = now()
		WHERE id = $1 AND status = 'processing' AND attempt = $2 AND lease_owner = $3 AND lease_until > now()`,
		file.ID, file.Attempt, *file.LeaseOwner, parserVersion, pageCount, charCount, len(segments))
	return tag.RowsAffected() > 0, err
}

func FailAssistantFileIngestion(ctx context.Context, q Q, file *AssistantFile, code, message string) (bool, error) {
	if file == nil || file.LeaseOwner == nil {
		return false, nil
	}
	tag, err := q.Exec(ctx, `UPDATE assistant_files SET status = 'failed', error_code = $4, error_message = $5,
		lease_owner = NULL, lease_until = NULL, updated_at = now(), finished_at = now()
		WHERE id = $1 AND status = 'processing' AND attempt = $2 AND lease_owner = $3 AND lease_until > now()`,
		file.ID, file.Attempt, *file.LeaseOwner, code, message)
	return tag.RowsAffected() > 0, err
}

func ListAssistantFileSegments(
	ctx context.Context,
	q Q,
	userID uuid.UUID,
	fileIDs []uuid.UUID,
	limit int,
) ([]AssistantFileSegment, error) {
	if len(fileIDs) == 0 || limit <= 0 {
		return []AssistantFileSegment{}, nil
	}
	rows, err := q.Query(ctx, `SELECT segment.id, segment.file_id, segment.ordinal, segment.locator, segment.content
		FROM assistant_file_segments segment
		JOIN assistant_files file ON file.id = segment.file_id
		WHERE file.user_id = $1 AND file.status = 'ready' AND file.id = ANY($2::uuid[])
		ORDER BY segment.file_id, segment.ordinal LIMIT $3`, userID, fileIDs, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	segments := make([]AssistantFileSegment, 0)
	for rows.Next() {
		var segment AssistantFileSegment
		if err := rows.Scan(&segment.ID, &segment.FileID, &segment.Ordinal, &segment.Locator, &segment.Content); err != nil {
			return nil, err
		}
		segments = append(segments, segment)
	}
	return segments, rows.Err()
}

func SearchAssistantFileSegments(
	ctx context.Context,
	q Q,
	userID uuid.UUID,
	fileIDs []uuid.UUID,
	query string,
	limit int,
) ([]AssistantFileSegment, error) {
	query = strings.TrimSpace(query)
	if len(fileIDs) == 0 || query == "" || limit <= 0 {
		return []AssistantFileSegment{}, nil
	}
	rows, err := q.Query(ctx, `SELECT segment.id, segment.file_id, segment.ordinal, segment.locator, segment.content
		FROM assistant_file_segments segment
		JOIN assistant_files file ON file.id = segment.file_id
		WHERE file.user_id = $1 AND file.status = 'ready' AND file.id = ANY($2::uuid[])
		  AND (segment.search_text @@ websearch_to_tsquery('simple', $3)
		       OR segment.content ILIKE '%' || $3 || '%'
		       OR word_similarity($3, segment.content) >= 0.3)
		ORDER BY CASE WHEN segment.content ILIKE '%' || $3 || '%' THEN 1 ELSE 0 END DESC,
			ts_rank_cd(segment.search_text, websearch_to_tsquery('simple', $3)) DESC,
			word_similarity($3, segment.content) DESC,
			segment.file_id, segment.ordinal
		LIMIT $4`, userID, fileIDs, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	segments := make([]AssistantFileSegment, 0)
	for rows.Next() {
		var segment AssistantFileSegment
		if err := rows.Scan(&segment.ID, &segment.FileID, &segment.Ordinal, &segment.Locator, &segment.Content); err != nil {
			return nil, err
		}
		segments = append(segments, segment)
	}
	return segments, rows.Err()
}

func ReadAssistantFileSegments(
	ctx context.Context,
	q Q,
	userID, fileID uuid.UUID,
	start, limit int,
) ([]AssistantFileSegment, error) {
	if start < 0 {
		start = 0
	}
	if limit <= 0 {
		return []AssistantFileSegment{}, nil
	}
	rows, err := q.Query(ctx, `SELECT segment.id, segment.file_id, segment.ordinal, segment.locator, segment.content
		FROM assistant_file_segments segment
		JOIN assistant_files file ON file.id = segment.file_id
		WHERE file.user_id = $1 AND file.status = 'ready' AND file.id = $2 AND segment.ordinal >= $3
		ORDER BY segment.ordinal LIMIT $4`, userID, fileID, start, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	segments := make([]AssistantFileSegment, 0)
	for rows.Next() {
		var segment AssistantFileSegment
		if err := rows.Scan(&segment.ID, &segment.FileID, &segment.Ordinal, &segment.Locator, &segment.Content); err != nil {
			return nil, err
		}
		segments = append(segments, segment)
	}
	return segments, rows.Err()
}

func DeleteUserAssistantFile(ctx context.Context, q Q, userID, id uuid.UUID) (*AssistantFile, bool, error) {
	file, err := GetUserAssistantFile(ctx, q, userID, id)
	if err != nil || file == nil {
		return file, false, err
	}
	if err := DeleteUserUploadReferences(ctx, q, UploadReferenceAssistantFile, id); err != nil {
		return file, false, err
	}
	tag, err := q.Exec(ctx, `DELETE FROM assistant_files WHERE id = $1 AND user_id = $2`, id, userID)
	return file, tag.RowsAffected() > 0, err
}
