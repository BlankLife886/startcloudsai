// 同步引擎：抓取远程源 → 解析 → upsert prompt_library → 更新源统计。
// 并发安全：同步前条件 UPDATE 抢锁（sync_lock_token/sync_lock_expires_at），
// 手动触发与定时调度不会对同一源重复导入。
package promptsync

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	maxSourceBytes = 16 * 1024 * 1024
	maxSourceItems = 2000

	fetchTimeout = 30 * time.Second
	lockTTL      = 20 * time.Minute

	// schedulerBatch 单轮定时扫描最多同步的源数。
	schedulerBatch = 6
)

// Result 单源同步统计（admin sync 接口响应体）。
type Result struct {
	Imported   int   `json:"imported"`
	Updated    int   `json:"updated"`
	Unchanged  int   `json:"unchanged"`
	Failed     int   `json:"failed"`
	DurationMs int64 `json:"durationMs"`
	ItemCount  int   `json:"itemCount"`
}

// ErrSyncBusy 抢锁失败：该源正在同步中。
var ErrSyncBusy = errors.New("该源正在同步中，请稍后再试")

type Engine struct {
	St     *store.Store
	Client *http.Client
}

func New(st *store.Store, allowPrivate ...bool) *Engine {
	allow := len(allowPrivate) > 0 && allowPrivate[0]
	return &Engine{St: st, Client: netguard.NewHTTPClient(fetchTimeout, allow, true)}
}

// SyncSource 手动同步：抢锁（不要求到期）→ 执行 → 释放锁。
func (e *Engine) SyncSource(ctx context.Context, id string) (*Result, error) {
	source, err := store.GetPromptSource(ctx, e.St.Pool, id)
	if err != nil {
		return nil, err
	}
	if source == nil {
		return nil, nil
	}
	token := uuid.NewString()
	acquired, err := store.AcquirePromptSourceLock(ctx, e.St.Pool, id, token, lockTTL, false)
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, ErrSyncBusy
	}
	defer e.releaseLock(id, token)
	return e.runSync(ctx, source)
}

// SyncDue 定时调度：扫描到期源，逐个抢锁同步（抢不到跳过）。
func (e *Engine) SyncDue(ctx context.Context) error {
	ids, err := store.ListDuePromptSourceIDs(ctx, e.St.Pool, schedulerBatch)
	if err != nil {
		return err
	}
	for _, id := range ids {
		token := uuid.NewString()
		acquired, err := store.AcquirePromptSourceLock(ctx, e.St.Pool, id, token, lockTTL, true)
		if err != nil {
			return err
		}
		if !acquired {
			continue
		}
		source, err := store.GetPromptSource(ctx, e.St.Pool, id)
		if err != nil || source == nil {
			e.releaseLock(id, token)
			if err != nil {
				return err
			}
			continue
		}
		result, err := e.runSync(ctx, source)
		e.releaseLock(id, token)
		if err != nil {
			log.Printf("prompt source %s sync failed: %v", id, err)
			continue
		}
		log.Printf("prompt source %s synced: imported=%d updated=%d unchanged=%d failed=%d duration=%dms",
			id, result.Imported, result.Updated, result.Unchanged, result.Failed, result.DurationMs)
	}
	return nil
}

func (e *Engine) releaseLock(id, token string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := store.ReleasePromptSourceLock(ctx, e.St.Pool, id, token); err != nil {
		log.Printf("release prompt source lock %s: %v", id, err)
	}
}

// runSync 执行一次同步（调用方需已持锁），成功/失败都会更新源统计。
func (e *Engine) runSync(ctx context.Context, source *store.PromptSource) (*Result, error) {
	startedAt := time.Now()
	result, err := e.doSync(ctx, source)
	durationMs := time.Since(startedAt).Milliseconds()
	if err != nil {
		if merr := store.MarkPromptSourceFailed(ctx, e.St.Pool, source.ID,
			NormalizeText(err.Error(), 500), durationMs); merr != nil {
			log.Printf("mark prompt source %s failed: %v", source.ID, merr)
		}
		return nil, err
	}
	result.DurationMs = durationMs
	if err := store.MarkPromptSourceSynced(ctx, e.St.Pool, source.ID, result.ItemCount, durationMs); err != nil {
		return nil, err
	}
	return result, nil
}

func (e *Engine) doSync(ctx context.Context, source *store.PromptSource) (*Result, error) {
	text, err := e.fetch(ctx, source.SourceURL)
	if err != nil {
		return nil, err
	}
	parsed, err := Parse(text, source.Format, source.SourceURL)
	if err != nil {
		return nil, err
	}
	if len(parsed) > maxSourceItems {
		parsed = parsed[:maxSourceItems]
	}
	if len(parsed) == 0 {
		return nil, errors.New("没有从该地址解析到有效提示词")
	}

	maxSort, err := store.MaxPromptSort(ctx, e.St.Pool)
	if err != nil {
		return nil, err
	}

	result := &Result{ItemCount: len(parsed)}
	var lastErr error
	for index, item := range parsed {
		itemKey := StableItemKey(item, index)
		tags := mergeTags(source.DefaultTags, item.Tags, 12)
		outcome, uerr := store.UpsertSourcePrompt(ctx, e.St.Pool,
			source.ID, itemKey,
			NormalizeText(item.Label, 120),
			NormalizeText(item.Prompt, 8000),
			source.TaskType, tags,
			NormalizeText(item.ImageURL, 1600),
			maxSort+index+1)
		if uerr != nil {
			result.Failed++
			lastErr = uerr
			continue
		}
		switch outcome {
		case store.SourcePromptImported:
			result.Imported++
		case store.SourcePromptUpdated:
			result.Updated++
		default:
			result.Unchanged++
		}
	}
	if result.Failed > 0 && result.Failed == len(parsed) {
		return nil, fmt.Errorf("全部 %d 条词条写入失败: %w", result.Failed, lastErr)
	}
	if lastErr != nil {
		log.Printf("prompt source %s: %d 条词条写入失败（last: %v）", source.ID, result.Failed, lastErr)
	}
	return result, nil
}

// fetch 抓取源文本：30s 超时，失败重试 1 次，16MB 上限。
func (e *Engine) fetch(ctx context.Context, url string) (string, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(350 * time.Millisecond):
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		text, err := e.fetchOnce(ctx, url)
		if err == nil {
			return text, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func (e *Engine) fetchOnce(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json,text/markdown,text/html,text/plain,*/*")
	resp, err := e.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("提示词源连接失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("源站返回 HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxSourceBytes {
		return "", errors.New("提示词源超过 16MB 限制")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSourceBytes+1))
	if err != nil {
		return "", fmt.Errorf("读取提示词源失败: %w", err)
	}
	if len(data) > maxSourceBytes {
		return "", errors.New("提示词源超过 16MB 限制")
	}
	return string(data), nil
}

// mergeTags 默认标签在前 + 词条标签，去重保序，最多 limit 个（对齐旧版）。
func mergeTags(defaults, tags []string, limit int) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, list := range [][]string{defaults, tags} {
		for _, t := range list {
			if t == "" || seen[t] {
				continue
			}
			seen[t] = true
			out = append(out, t)
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}
