package promptsync

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type BatchResult struct {
	BatchID           string `json:"batchId"`
	SourceCount       int    `json:"sourceCount"`
	FetchedCount      int    `json:"fetchedCount"`
	UniqueCount       int    `json:"uniqueCount"`
	DuplicateCount    int    `json:"duplicateCount"`
	FailedSourceCount int    `json:"failedSourceCount"`
}

var ErrImportBatchPending = errors.New("已有待审核批次，请处理完成后再获取新数据")

type fetchedSource struct {
	source *store.PromptSource
	items  []ParsedPrompt
	err    error
	took   time.Duration
}

type FilePrompt struct {
	ID            string
	Title         string
	Prompt        string
	TaskType      string
	Category      string
	Tags          []string
	CoverKey      string
	SourceItemKey string
}

func (e *Engine) CreateFileImportBatch(ctx context.Context, input []FilePrompt, mode string) (*BatchResult, error) {
	openBatch, err := store.GetOpenPromptImportBatch(ctx, e.St.Pool)
	if err != nil {
		return nil, err
	}
	if openBatch != nil {
		return nil, ErrImportBatchPending
	}
	if len(input) == 0 {
		return nil, errors.New("导入文件中没有有效提示词")
	}
	if len(input) > 5000 {
		return nil, errors.New("单次最多导入 5000 条提示词")
	}
	if mode != "manual" && mode != "ai" {
		mode = "rules"
	}
	categories, err := store.ListPromptCategories(ctx, e.St.Pool, true)
	if err != nil {
		return nil, err
	}
	validCategories := make(map[string]struct{}, len(categories))
	for _, category := range categories {
		validCategories[category.Key] = struct{}{}
	}
	batch, err := store.CreatePromptImportBatch(ctx, e.St.Pool, mode, 1)
	if err != nil {
		return nil, err
	}
	items := make([]*store.PromptImportItem, 0, len(input))
	for index, raw := range input {
		promptText := NormalizeText(raw.Prompt, 8000)
		if len([]rune(promptText)) < 8 {
			continue
		}
		title := NormalizeText(raw.Title, 120)
		if title == "" {
			title = fmt.Sprintf("导入提示词 %d", index+1)
		}
		taskType := strings.TrimSpace(raw.TaskType)
		if !store.Contains(store.PromptTaskTypes, taskType) {
			taskType = "t2i"
		}
		tags := mergeTags(nil, raw.Tags, 12)
		category := strings.TrimSpace(raw.Category)
		if _, ok := validCategories[category]; !ok {
			category = store.ClassifyPromptCategory(title, promptText, tags)
		}
		coverKey := NormalizeText(raw.CoverKey, 1600)
		assetOrigin, assetStatus, assetNote := promptAssetStatus(coverKey)
		fingerprint := store.PromptContentFingerprint(promptText)
		itemKey := strings.TrimSpace(raw.SourceItemKey)
		if itemKey == "" {
			itemKey = fmt.Sprintf("%s-%d", fingerprint[:20], index+1)
		}
		compliance, reason := promptCompliance(promptText, title, tags)
		items = append(items, &store.PromptImportItem{
			ID: uuid.New(), BatchID: batch.ID, SourceID: "file-import:" + batch.ID.String(),
			SourceName: "文件导入", SourceItemKey: NormalizeText(itemKey, 200),
			Title: title, Prompt: promptText, TaskType: taskType, Category: category,
			Tags: tags, CoverKey: coverKey, ContentFingerprint: fingerprint,
			DuplicateKind: "none", DuplicateAction: "keep",
			ComplianceStatus: compliance, ComplianceReason: reason,
			AssetOrigin: assetOrigin, AssetStatus: assetStatus, AssetNote: assetNote,
			ReviewStatus: "pending",
		})
	}
	return e.stagePromptImportItems(ctx, batch, items, nil, 1)
}

// CreateImportBatch fetches all selected sources and stages review items.
// Each eligible item is published immediately after an administrator approves it.
func (e *Engine) CreateImportBatch(ctx context.Context, sourceIDs []string, mode string) (*BatchResult, error) {
	openBatch, err := store.GetOpenPromptImportBatch(ctx, e.St.Pool)
	if err != nil {
		return nil, err
	}
	if openBatch != nil {
		return nil, ErrImportBatchPending
	}
	all, err := store.ListPromptSources(ctx, e.St.Pool)
	if err != nil {
		return nil, err
	}
	selected := make(map[string]struct{}, len(sourceIDs))
	for _, id := range sourceIDs {
		selected[id] = struct{}{}
	}
	sources := make([]*store.PromptSource, 0, len(all))
	for _, source := range all {
		if !source.Enabled {
			continue
		}
		if len(selected) > 0 {
			if _, ok := selected[source.ID]; !ok {
				continue
			}
		}
		sources = append(sources, source)
	}
	if len(sources) == 0 {
		return nil, errors.New("没有可获取的已启用数据源")
	}
	if mode != "manual" && mode != "ai" {
		mode = "rules"
	}
	batch, err := store.CreatePromptImportBatch(ctx, e.St.Pool, mode, len(sources))
	if err != nil {
		return nil, err
	}

	results := e.fetchBatchSources(ctx, sources)
	items := make([]*store.PromptImportItem, 0)
	failedMessages := make([]string, 0)
	for _, result := range results {
		if result.err != nil {
			failedMessages = append(failedMessages, result.source.Name+": "+NormalizeText(result.err.Error(), 160))
			_ = store.MarkPromptSourceFailed(ctx, e.St.Pool, result.source.ID,
				NormalizeText(result.err.Error(), 500), result.took.Milliseconds())
			continue
		}
		_ = store.MarkPromptSourceSynced(ctx, e.St.Pool, result.source.ID, len(result.items), result.took.Milliseconds())
		for index, parsed := range result.items {
			promptText := NormalizeText(parsed.Prompt, 8000)
			status, reason := promptCompliance(promptText, parsed.Label, parsed.Tags)
			coverKey := NormalizeText(parsed.ImageURL, 1600)
			assetOrigin, assetStatus, assetNote := promptAssetStatus(coverKey)
			items = append(items, &store.PromptImportItem{
				ID: uuid.New(), BatchID: batch.ID, SourceID: result.source.ID,
				SourceName: result.source.Name, SourceItemKey: StableItemKey(parsed, index),
				Title: NormalizeText(parsed.Label, 120), Prompt: promptText,
				TaskType:           result.source.TaskType,
				Category:           store.ClassifyPromptCategory(parsed.Label, promptText, parsed.Tags),
				Tags:               mergeTags(result.source.DefaultTags, parsed.Tags, 12),
				CoverKey:           coverKey,
				ContentFingerprint: store.PromptContentFingerprint(promptText),
				DuplicateKind:      "none", DuplicateAction: "keep",
				ComplianceStatus: status, ComplianceReason: reason,
				AssetOrigin: assetOrigin, AssetStatus: assetStatus, AssetNote: assetNote,
				ReviewStatus: "pending",
			})
		}
	}

	return e.stagePromptImportItems(ctx, batch, items, failedMessages, len(sources))
}

func (e *Engine) stagePromptImportItems(ctx context.Context, batch *store.PromptImportBatch,
	items []*store.PromptImportItem, failedMessages []string, sourceCount int) (*BatchResult, error) {
	fingerprints := make([]string, 0, len(items))
	for _, item := range items {
		fingerprints = append(fingerprints, item.ContentFingerprint)
	}
	libraryMatches, err := store.FindPromptFingerprintMatches(ctx, e.St.Pool, fingerprints)
	if err != nil {
		_ = store.FinishPromptImportFetch(ctx, e.St.Pool, batch.ID, 0, 0, 0, len(failedMessages), err.Error())
		return nil, err
	}
	seen := make(map[string]*store.PromptImportItem, len(items))
	duplicates := 0
	for _, item := range items {
		if previous := seen[item.ContentFingerprint]; previous != nil {
			item.DuplicateKind = "batch"
			item.DuplicateRefID = &previous.ID
			item.DuplicateTitle = previous.Title
			item.DuplicateAction = "pending"
			duplicates++
			continue
		}
		seen[item.ContentFingerprint] = item
		if match, ok := libraryMatches[item.ContentFingerprint]; ok &&
			(match.SourceID != item.SourceID || match.SourceItemKey != item.SourceItemKey) {
			item.DuplicateKind = "library"
			item.DuplicateRefID = &match.ID
			item.DuplicateTitle = match.Title
			item.DuplicateAction = "pending"
			duplicates++
		}
	}
	if err := store.InsertPromptImportItems(ctx, e.St.Pool, items); err != nil {
		_ = store.FinishPromptImportFetch(ctx, e.St.Pool, batch.ID, 0, 0, 0, len(failedMessages), err.Error())
		return nil, err
	}
	batchErr := strings.Join(failedMessages, "；")
	if err := store.FinishPromptImportFetch(ctx, e.St.Pool, batch.ID, len(items), len(items)-duplicates,
		duplicates, len(failedMessages), batchErr); err != nil {
		return nil, err
	}
	return &BatchResult{BatchID: batch.ID.String(), SourceCount: sourceCount, FetchedCount: len(items),
		UniqueCount: len(items) - duplicates, DuplicateCount: duplicates,
		FailedSourceCount: len(failedMessages)}, nil
}

func promptAssetStatus(coverKey string) (origin, status, note string) {
	coverKey = strings.TrimSpace(coverKey)
	if coverKey == "" {
		return "missing", "not_required", ""
	}
	if strings.HasPrefix(coverKey, "http://") || strings.HasPrefix(coverKey, "https://") {
		return "external", "not_required", ""
	}
	return "owned_storage", "not_required", ""
}

func (e *Engine) fetchBatchSources(ctx context.Context, sources []*store.PromptSource) []fetchedSource {
	results := make([]fetchedSource, len(sources))
	jobs := make(chan int)
	var wg sync.WaitGroup
	workers := 4
	if len(sources) < workers {
		workers = len(sources)
	}
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				source := sources[index]
				started := time.Now()
				text, err := e.fetch(ctx, source.SourceURL)
				var parsed []ParsedPrompt
				if err == nil {
					parsed, err = Parse(text, source.Format, source.SourceURL)
					if len(parsed) > maxSourceItems {
						parsed = parsed[:maxSourceItems]
					}
					if err == nil && len(parsed) == 0 {
						err = errors.New("没有解析到有效提示词")
					}
				}
				results[index] = fetchedSource{source: source, items: parsed, err: err, took: time.Since(started)}
			}
		}()
	}
	for index := range sources {
		select {
		case jobs <- index:
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return results
		}
	}
	close(jobs)
	wg.Wait()
	return results
}

var blockedPromptTerms = []struct {
	reason string
	terms  []string
}{
	{"疑似色情或裸露内容", []string{"porn", "pornographic", "explicit sex", "sexual intercourse", "genitals", "nude minor", "裸体未成年", "色情", "性交", "性器官", "强奸"}},
	{"疑似血腥或极端暴力内容", []string{"gore", "dismemberment", "decapitation", "severed head", "torture", "graphic violence", "血腥肢解", "斩首", "断肢", "酷刑", "虐杀"}},
}

func promptCompliance(prompt, title string, tags []string) (string, string) {
	text := strings.ToLower(strings.Join([]string{title, prompt, strings.Join(tags, " ")}, " "))
	for _, group := range blockedPromptTerms {
		for _, term := range group.terms {
			if strings.Contains(text, term) {
				return "blocked", group.reason + "（命中：" + term + "）"
			}
		}
	}
	return "safe", "规则检测未发现高风险内容"
}

func ValidateBatchMode(mode string) error {
	if mode != "manual" && mode != "rules" && mode != "ai" {
		return fmt.Errorf("无效的处理模式")
	}
	return nil
}
