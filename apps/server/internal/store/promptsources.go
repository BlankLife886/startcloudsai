// prompt_sources 提示词库数据源（v4）：CRUD、同步锁、到期扫描与同步统计。
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// PromptSource 提示词数据源行。
type PromptSource struct {
	ID                  string
	Name                string
	SourceURL           string
	Format              string
	TaskType            string
	DefaultTags         []string
	Enabled             bool
	AutoSyncEnabled     bool
	SyncIntervalMinutes int
	NextSyncAt          *time.Time
	ItemCount           int
	LastSyncedAt        *time.Time
	LastSyncDurationMs  int64
	LastError           string
	CreatedAt           time.Time
}

var PromptSourceFormats = []string{"json", "markdown", "html"}

const promptSourceCols = `id, name, source_url, format, task_type, default_tags, enabled, auto_sync_enabled,
	sync_interval_minutes, next_sync_at, item_count, last_synced_at, last_sync_duration_ms, last_error, created_at`

func scanPromptSource(row pgx.Row) (*PromptSource, error) {
	var s PromptSource
	err := row.Scan(&s.ID, &s.Name, &s.SourceURL, &s.Format, &s.TaskType, &s.DefaultTags,
		&s.Enabled, &s.AutoSyncEnabled, &s.SyncIntervalMinutes, &s.NextSyncAt,
		&s.ItemCount, &s.LastSyncedAt, &s.LastSyncDurationMs, &s.LastError, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func ListPromptSources(ctx context.Context, q Q) ([]*PromptSource, error) {
	rows, err := q.Query(ctx, `SELECT `+promptSourceCols+` FROM prompt_sources ORDER BY created_at ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*PromptSource
	for rows.Next() {
		s, err := scanPromptSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func GetPromptSource(ctx context.Context, q Q, id string) (*PromptSource, error) {
	s, err := scanPromptSource(q.QueryRow(ctx,
		`SELECT `+promptSourceCols+` FROM prompt_sources WHERE id = $1`, id))
	return nilOnNoRows(s, err)
}

func InsertPromptSource(ctx context.Context, q Q, s *PromptSource) (*PromptSource, error) {
	if s.DefaultTags == nil {
		s.DefaultTags = []string{}
	}
	return scanPromptSource(q.QueryRow(ctx,
		`INSERT INTO prompt_sources
			(id, name, source_url, format, task_type, default_tags, enabled, auto_sync_enabled,
			 sync_interval_minutes, next_sync_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		 RETURNING `+promptSourceCols,
		s.ID, s.Name, s.SourceURL, s.Format, s.TaskType, s.DefaultTags,
		s.Enabled, s.AutoSyncEnabled, s.SyncIntervalMinutes))
}

// UpdatePromptSource 更新可编辑字段；autoSyncEnabled 由关到开时把 next_sync_at
// 置为 now() 让下轮扫描立即同步（对齐旧版语义）。
func UpdatePromptSource(ctx context.Context, q Q, s *PromptSource) error {
	if s.DefaultTags == nil {
		s.DefaultTags = []string{}
	}
	_, err := q.Exec(ctx,
		`UPDATE prompt_sources SET
			name = $2, source_url = $3, format = $4, task_type = $5, default_tags = $6,
			enabled = $7, sync_interval_minutes = $8,
			next_sync_at = CASE WHEN $9 AND NOT auto_sync_enabled THEN now() ELSE next_sync_at END,
			auto_sync_enabled = $9
		 WHERE id = $1`,
		s.ID, s.Name, s.SourceURL, s.Format, s.TaskType, s.DefaultTags,
		s.Enabled, s.SyncIntervalMinutes, s.AutoSyncEnabled)
	return err
}

// DeletePromptSource 删除源；purgeItems 时连带删除该源导入的词条。
func DeletePromptSource(ctx context.Context, q Q, id string, purgeItems bool) error {
	if purgeItems {
		if _, err := q.Exec(ctx, `DELETE FROM prompt_library WHERE source_id = $1`, id); err != nil {
			return err
		}
	}
	_, err := q.Exec(ctx, `DELETE FROM prompt_sources WHERE id = $1`, id)
	return err
}

// AcquirePromptSourceLock 同步锁：条件 UPDATE 抢锁（过期锁视为空闲）。
// requireDue 供定时调度使用：额外要求 enabled+autoSync 且 next_sync_at 到期。
func AcquirePromptSourceLock(ctx context.Context, q Q, id, token string, lockTTL time.Duration, requireDue bool) (bool, error) {
	sql := `UPDATE prompt_sources
		SET sync_lock_token = $2, sync_lock_expires_at = now() + $3::interval
		WHERE id = $1
		  AND (sync_lock_expires_at IS NULL OR sync_lock_expires_at <= now())`
	if requireDue {
		sql += ` AND enabled AND auto_sync_enabled AND (next_sync_at IS NULL OR next_sync_at <= now())`
	}
	tag, err := q.Exec(ctx, sql, id, token, fmt.Sprintf("%d seconds", int(lockTTL.Seconds())))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func ReleasePromptSourceLock(ctx context.Context, q Q, id, token string) error {
	_, err := q.Exec(ctx,
		`UPDATE prompt_sources SET sync_lock_token = '', sync_lock_expires_at = NULL
		 WHERE id = $1 AND sync_lock_token = $2`, id, token)
	return err
}

// ListDuePromptSourceIDs 到期待同步源（enabled+autoSync+到期+锁空闲）。
func ListDuePromptSourceIDs(ctx context.Context, q Q, limit int) ([]string, error) {
	rows, err := q.Query(ctx,
		`SELECT id FROM prompt_sources
		 WHERE enabled AND auto_sync_enabled
		   AND (next_sync_at IS NULL OR next_sync_at <= now())
		   AND (sync_lock_expires_at IS NULL OR sync_lock_expires_at <= now())
		 ORDER BY COALESCE(next_sync_at, 'epoch'::timestamptz) ASC, created_at ASC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// MarkPromptSourceSynced 同步成功后更新统计并排下一轮（间隔下限 15 分钟）。
func MarkPromptSourceSynced(ctx context.Context, q Q, id string, itemCount int, durationMs int64) error {
	_, err := q.Exec(ctx,
		`UPDATE prompt_sources
		 SET item_count = $2, last_synced_at = now(), last_sync_duration_ms = $3, last_error = '',
		     next_sync_at = now() + make_interval(mins => GREATEST(15, sync_interval_minutes))
		 WHERE id = $1`, id, itemCount, durationMs)
	return err
}

// MarkPromptSourceFailed 同步失败：记录错误，15 分钟后重试。
func MarkPromptSourceFailed(ctx context.Context, q Q, id, lastError string, durationMs int64) error {
	_, err := q.Exec(ctx,
		`UPDATE prompt_sources
		 SET last_error = $2, last_sync_duration_ms = $3, next_sync_at = now() + interval '15 minutes'
		 WHERE id = $1`, id, lastError, durationMs)
	return err
}

// SourcePromptUpsertResult 单条源词条 upsert 结果。
type SourcePromptUpsertResult int

const (
	SourcePromptUnchanged SourcePromptUpsertResult = iota
	SourcePromptImported
	SourcePromptUpdated
)

// UpsertSourcePrompt 按 (source_id, source_item_key) upsert 源词条：
// 新增写入完整字段（category='other'、active=true）；已存在只更新
// title/prompt/tags/cover_key，保留 category/active/sort（回填分类与后台
// 手工调整不被同步覆盖）；内容一致时不落盘（unchanged）。
func UpsertSourcePrompt(ctx context.Context, q Q, sourceID, itemKey, title, prompt, taskType string,
	tags []string, coverKey string, sort int) (SourcePromptUpsertResult, error) {
	if tags == nil {
		tags = []string{}
	}
	var inserted bool
	err := q.QueryRow(ctx,
		`INSERT INTO prompt_library
			(title, prompt, task_type, category, tags, cover_key, sort, active, source_id, source_item_key)
		 VALUES ($3, $4, $5, 'other', $6, NULLIF($7, ''), $8, true, $1, $2)
		 ON CONFLICT (source_id, source_item_key) WHERE source_id <> '' AND source_item_key <> ''
		 DO UPDATE SET
			title = excluded.title,
			prompt = excluded.prompt,
			tags = excluded.tags,
			cover_key = excluded.cover_key
		 WHERE (prompt_library.title, prompt_library.prompt, prompt_library.tags, prompt_library.cover_key)
			IS DISTINCT FROM (excluded.title, excluded.prompt, excluded.tags, excluded.cover_key)
		 RETURNING (xmax = 0)`,
		sourceID, itemKey, title, prompt, taskType, tags, coverKey, sort).Scan(&inserted)
	if err == pgx.ErrNoRows {
		return SourcePromptUnchanged, nil
	}
	if err != nil {
		return SourcePromptUnchanged, err
	}
	if inserted {
		return SourcePromptImported, nil
	}
	return SourcePromptUpdated, nil
}

// MaxPromptSort 当前 prompt_library 最大 sort（新导入词条从 max+1 递增）。
func MaxPromptSort(ctx context.Context, q Q) (int, error) {
	var max int
	err := q.QueryRow(ctx, `SELECT COALESCE(MAX(sort), 0) FROM prompt_library`).Scan(&max)
	return max, err
}
