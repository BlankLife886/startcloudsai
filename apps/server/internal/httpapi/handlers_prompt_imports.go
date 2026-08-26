package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/promptsync"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func promptImportBatchDict(batch *store.PromptImportBatch) gin.H {
	return gin.H{
		"id": batch.ID, "status": batch.Status, "analysisMode": batch.AnalysisMode,
		"sourceCount": batch.SourceCount, "fetchedCount": batch.FetchedCount,
		"uniqueCount": batch.UniqueCount, "duplicateCount": batch.DuplicateCount,
		"approvedCount": batch.ApprovedCount, "rejectedCount": batch.RejectedCount,
		"importedCount": batch.ImportedCount, "updatedCount": batch.UpdatedCount,
		"failedSourceCount": batch.FailedSourceCount, "error": batch.Error,
		"createdAt": isoValue(batch.CreatedAt), "analyzedAt": iso(batch.AnalyzedAt),
		"completedAt": iso(batch.CompletedAt),
	}
}

func promptImportItemDict(item *store.PromptImportItem) gin.H {
	return gin.H{
		"id": item.ID, "batchId": item.BatchID, "sourceId": item.SourceID,
		"sourceName": item.SourceName, "sourceItemKey": item.SourceItemKey,
		"title": item.Title, "prompt": item.Prompt, "taskType": item.TaskType,
		"category": item.Category, "tags": nonNilStrings(item.Tags),
		"coverUrl": func() string {
			if item.CoverKey == "" {
				return ""
			}
			return "/api/v1/admin/prompt-import-batches/" + item.BatchID.String() + "/items/" + item.ID.String() +
				"/cover?v=" + strconv.FormatInt(item.UpdatedAt.UnixMilli(), 10)
		}(), "duplicateKind": item.DuplicateKind,
		"duplicateRefId": item.DuplicateRefID, "duplicateTitle": item.DuplicateTitle,
		"duplicateAction":  item.DuplicateAction,
		"complianceStatus": item.ComplianceStatus, "complianceReason": item.ComplianceReason,
		"reviewStatus": item.ReviewStatus, "reviewNote": item.ReviewNote,
		"publishedPromptId": item.PublishedPromptID, "publishedAt": iso(item.PublishedAt),
		"createdAt": isoValue(item.CreatedAt), "updatedAt": isoValue(item.UpdatedAt),
	}
}

func (s *Server) adminListPromptImportBatches(c *gin.Context, _ *store.User) {
	rows, err := store.ListPromptImportBatches(c.Request.Context(), s.St.Pool, 20)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, batch := range rows {
		items = append(items, promptImportBatchDict(batch))
	}
	ok(c, gin.H{"items": items})
}

type promptImportBatchIn struct {
	Mode      string   `json:"mode"`
	SourceIDs []string `json:"sourceIds"`
}

func (s *Server) adminCreatePromptImportBatch(c *gin.Context, _ *store.User) {
	var body promptImportBatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	mode := strings.TrimSpace(body.Mode)
	if mode == "" {
		mode = "rules"
	}
	if err := promptsync.ValidateBatchMode(mode); err != nil {
		fail(c, apperr.E("validation_error", err.Error(), http.StatusUnprocessableEntity))
		return
	}
	result, err := s.PromptSync.CreateImportBatch(c.Request.Context(), body.SourceIDs, mode)
	if errors.Is(err, promptsync.ErrImportBatchPending) {
		fail(c, apperr.E("conflict", err.Error(), http.StatusConflict))
		return
	}
	if err != nil {
		fail(c, apperr.E("prompt_import_failed", "获取数据源失败："+err.Error(), 500))
		return
	}
	respondCreated(c, result)
}

func (s *Server) promptImportBatch(c *gin.Context) (*store.PromptImportBatch, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "无效的批次 ID", 422))
		return nil, false
	}
	batch, err := store.GetPromptImportBatch(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return nil, false
	}
	if batch == nil {
		fail(c, apperr.E("not_found", "导入批次不存在", 404))
		return nil, false
	}
	return batch, true
}

func (s *Server) adminGetPromptImportBatch(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	ok(c, promptImportBatchDict(batch))
}

func (s *Server) adminListPromptImportItems(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	limit := 50
	if value, err := strconv.Atoi(c.Query("limit")); err == nil && value > 0 && value <= 100 {
		limit = value
	}
	page := 1
	if value, err := strconv.Atoi(c.Query("page")); err == nil && value > 0 {
		page = value
	}
	rows, total, err := store.ListPromptImportItems(c.Request.Context(), s.St.Pool, batch.ID,
		c.DefaultQuery("view", "all"), limit, (page-1)*limit)
	if err != nil {
		fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(rows))
	for _, item := range rows {
		items = append(items, promptImportItemDict(item))
	}
	ok(c, gin.H{"items": items, "total": total, "page": page, "limit": limit})
}

func (s *Server) adminPromptImportItemCover(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	itemID, err := uuid.Parse(c.Param("itemId"))
	if err != nil {
		fail(c, apperr.E("validation_error", "无效的待审核项 ID", 422))
		return
	}
	item, err := store.GetPromptImportItem(c.Request.Context(), s.St.Pool, batch.ID, itemID)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil || item.CoverKey == "" {
		fail(c, apperr.E("not_found", "审核封面不存在", 404))
		return
	}
	if !strings.HasPrefix(item.CoverKey, "http://") && !strings.HasPrefix(item.CoverKey, "https://") {
		raw, err := s.Storage.GetBytesLimit(c.Request.Context(), item.CoverKey, promptCoverMaxBytes)
		if err != nil {
			fail(c, apperr.E("cover_fetch_failed", "本站存储中未找到该封面", 404))
			return
		}
		c.Header("Cache-Control", "private, max-age=3600")
		c.Data(http.StatusOK, http.DetectContentType(raw), raw)
		return
	}
	if !validPromptSourceURL(item.CoverKey) {
		fail(c, apperr.E("validation_error", "审核封面地址无效", 422))
		return
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, item.CoverKey, nil)
	if err != nil {
		fail(c, err)
		return
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*")
	resp, err := s.PromptSync.Client.Do(req)
	if err != nil {
		fail(c, apperr.E("cover_fetch_failed", "封面读取失败", 502))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fail(c, apperr.E("cover_fetch_failed", "封面源返回异常", 502))
		return
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, promptCoverMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	if len(raw) > promptCoverMaxBytes {
		fail(c, apperr.E("payload_too_large", "封面超过 8MB", 413))
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		contentType = http.DetectContentType(raw)
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Data(http.StatusOK, contentType, raw)
}

func (s *Server) replacePromptImportItemCover(ctx context.Context, batchID, itemID uuid.UUID, raw []byte, note string) (*store.PromptImportItem, error) {
	if len(raw) == 0 || len(raw) > promptCoverMaxBytes {
		return nil, apperr.E("upload_too_large", "封面不能为空且不能超过 8MB", 413)
	}
	ext, contentType := sniffImage(raw)
	if ext == "" {
		return nil, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", 400)
	}
	// 封面是纯展示素材：按后台图片配置压缩后落库。
	raw, ext, contentType = s.compressCoverImage(ctx, raw, ext, contentType)
	if _, _, err := media.Dimensions(raw); err != nil {
		return nil, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", 400)
	}
	current, err := store.GetPromptImportItem(ctx, s.St.Pool, batchID, itemID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, apperr.E("not_found", "待审核项不存在", 404)
	}
	if current.PublishedAt != nil {
		return nil, apperr.E("conflict", "该审核项已经加入提示词库", 409)
	}
	newKey := fmt.Sprintf("prompt-covers/import-%s.%s", itemID, ext)
	if err := s.Storage.UploadBytes(ctx, newKey, raw, contentType); err != nil {
		return nil, err
	}
	updated, err := store.UpdatePromptImportItemCover(ctx, s.St.Pool, batchID, itemID, newKey, note)
	if err != nil || updated == nil {
		if newKey != current.CoverKey {
			_ = s.Storage.DeleteKeys(ctx, []string{newKey})
		}
		if err != nil {
			return nil, err
		}
		return nil, apperr.E("conflict", "该审核项已不能修改封面", 409)
	}
	if current.CoverKey != "" && current.CoverKey != newKey && strings.HasPrefix(current.CoverKey, "prompt-covers/import-") {
		_ = s.Storage.DeleteKeys(ctx, []string{current.CoverKey})
	}
	return updated, nil
}

func (s *Server) adminUploadPromptImportItemCover(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	itemID, err := uuid.Parse(c.Param("itemId"))
	if err != nil {
		fail(c, apperr.E("validation_error", "无效的待审核项 ID", 422))
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		fail(c, apperr.E("validation_error", "file: 缺少上传图片", 422))
		return
	}
	if fileHeader.Size <= 0 || fileHeader.Size > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "封面不能为空且不能超过 8MB", 413))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, promptCoverMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	updated, err := s.replacePromptImportItemCover(c.Request.Context(), batch.ID, itemID, raw, "管理员上传替换")
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, promptImportItemDict(updated))
}

type promptImportItemPatchIn struct {
	Category         Opt[string] `json:"category"`
	DuplicateAction  Opt[string] `json:"duplicateAction"`
	ComplianceStatus Opt[string] `json:"complianceStatus"`
	ComplianceReason Opt[string] `json:"complianceReason"`
	ReviewStatus     Opt[string] `json:"reviewStatus"`
	ReviewNote       Opt[string] `json:"reviewNote"`
}

func (s *Server) adminPatchPromptImportItem(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	itemID, err := uuid.Parse(c.Param("itemId"))
	if err != nil {
		fail(c, apperr.E("validation_error", "无效的待审核项 ID", 422))
		return
	}
	var body promptImportItemPatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	patch := store.PromptImportItemPatch{}
	if body.Category.Valid {
		category := strings.TrimSpace(body.Category.Value)
		meta, err := store.GetPromptCategoryByKey(c.Request.Context(), s.St.Pool, category)
		if err != nil {
			fail(c, err)
			return
		}
		if meta == nil {
			fail(c, apperr.E("validation_error", "分类不存在", 422))
			return
		}
		patch.Category = &category
	}
	if body.DuplicateAction.Valid {
		value := body.DuplicateAction.Value
		if value != "keep" && value != "drop" {
			fail(c, apperr.E("validation_error", "重复项决定无效", 422))
			return
		}
		patch.DuplicateAction = &value
	}
	if body.ComplianceStatus.Valid {
		value := body.ComplianceStatus.Value
		if value != "safe" && value != "blocked" {
			fail(c, apperr.E("validation_error", "合规状态无效", 422))
			return
		}
		patch.ComplianceStatus = &value
	}
	if body.ComplianceReason.Valid {
		value := strings.TrimSpace(body.ComplianceReason.Value)
		patch.ComplianceReason = &value
	}
	if body.ReviewStatus.Valid {
		value := body.ReviewStatus.Value
		if value != "approved" && value != "rejected" {
			fail(c, apperr.E("validation_error", "审核状态无效", 422))
			return
		}
		patch.ReviewStatus = &value
	}
	if body.ReviewNote.Valid {
		value := strings.TrimSpace(body.ReviewNote.Value)
		patch.ReviewNote = &value
	}
	current, err := store.GetPromptImportItem(c.Request.Context(), s.St.Pool, batch.ID, itemID)
	if err != nil {
		fail(c, err)
		return
	}
	if current == nil {
		fail(c, apperr.E("not_found", "待审核项不存在", 404))
		return
	}
	if current.PublishedAt != nil {
		fail(c, apperr.E("conflict", "该审核项已经加入提示词库", 409))
		return
	}
	item, err := store.PatchPromptImportItem(c.Request.Context(), s.St.Pool, batch.ID, itemID, patch)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "待审核项不存在", 404))
		return
	}
	if item.ReviewStatus == "approved" {
		if _, _, err := store.PublishApprovedPromptImportItems(c.Request.Context(), s.St, batch.ID, []uuid.UUID{item.ID}); err != nil {
			fail(c, err)
			return
		}
		item, err = store.GetPromptImportItem(c.Request.Context(), s.St.Pool, batch.ID, item.ID)
		if err != nil {
			fail(c, err)
			return
		}
	} else {
		_ = store.RefreshPromptImportBatchCounts(c.Request.Context(), s.St.Pool, batch.ID)
	}
	ok(c, promptImportItemDict(item))
}

type promptImportBulkIn struct {
	Action  string   `json:"action"`
	ItemIDs []string `json:"itemIds"`
}

func (s *Server) adminBulkReviewPromptImportBatch(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	var body promptImportBulkIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	itemIDs := make([]uuid.UUID, 0, len(body.ItemIDs))
	for _, rawID := range body.ItemIDs {
		id, err := uuid.Parse(rawID)
		if err != nil {
			fail(c, apperr.E("validation_error", "包含无效的审核项 ID", 422))
			return
		}
		itemIDs = append(itemIDs, id)
	}
	reviewed, err := store.BulkReviewPromptImportItems(c.Request.Context(), s.St.Pool, batch.ID, body.Action, itemIDs)
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	imported, updated := 0, 0
	if body.Action == "approve-selected" || body.Action == "approve-all" || body.Action == "approve-safe" {
		imported, updated, err = store.PublishApprovedPromptImportItems(c.Request.Context(), s.St, batch.ID, itemIDs)
		if err != nil {
			fail(c, err)
			return
		}
	} else {
		if err := store.RefreshPromptImportBatchCounts(c.Request.Context(), s.St.Pool, batch.ID); err != nil {
			fail(c, err)
			return
		}
	}
	updatedBatch, err := store.GetPromptImportBatch(c.Request.Context(), s.St.Pool, batch.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"batch": promptImportBatchDict(updatedBatch), "reviewed": reviewed,
		"imported": imported, "updated": updated})
}

type promptImportAIResult struct {
	ID          string `json:"id"`
	Category    string `json:"category"`
	Compliance  string `json:"compliance"`
	Reason      string `json:"reason"`
	DuplicateOf string `json:"duplicateOf"`
}

func compactAIJSON(raw string) string {
	start, end := strings.Index(raw, "["), strings.LastIndex(raw, "]")
	if start < 0 || end < start {
		return ""
	}
	return raw[start : end+1]
}

func truncatePromptRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func (s *Server) adminAnalyzePromptImportBatch(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	if batch.Status != "review" {
		fail(c, apperr.E("conflict", "当前批次不能分析", 409))
		return
	}
	client, err := s.adminImageAnalysisClient(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	items, _, err := store.ListPromptImportItems(c.Request.Context(), s.St.Pool, batch.ID, "all", 10000, 0)
	if err != nil {
		fail(c, err)
		return
	}
	reviewItems := make([]*store.PromptImportItem, 0, len(items))
	for _, item := range items {
		if item.PublishedAt == nil {
			reviewItems = append(reviewItems, item)
		}
	}
	items = reviewItems
	categories, err := store.ListPromptCategories(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	categoryKeys := make([]string, 0, len(categories))
	validCategories := make(map[string]struct{}, len(categories))
	for _, category := range categories {
		categoryKeys = append(categoryKeys, category.Key)
		validCategories[category.Key] = struct{}{}
	}
	byID := make(map[string]*store.PromptImportItem, len(items))
	for _, item := range items {
		byID[item.ID.String()] = item
	}

	const chunkSize = 40
	analyzed := 0
	for start := 0; start < len(items); start += chunkSize {
		end := start + chunkSize
		if end > len(items) {
			end = len(items)
		}
		payload := make([]gin.H, 0, end-start)
		for _, item := range items[start:end] {
			payload = append(payload, gin.H{"id": item.ID, "title": item.Title,
				"prompt": truncatePromptRunes(item.Prompt, 700), "tags": item.Tags})
		}
		rawPayload, _ := json.Marshal(payload)
		system := `你是提示词库内容审核器。必须只输出 JSON 数组，不要 Markdown。
对每项返回 id、category、compliance、reason、duplicateOf。
category 必须从给定分类中选择；compliance 只能是 safe 或 blocked。
blocked 仅用于色情裸露、未成年人性内容、血腥肢解、极端暴力等明显风险。
duplicateOf 填本批输入中语义实质相同的另一项 id，否则为空字符串。`
		user := "可用分类：" + strings.Join(categoryKeys, ",") + "\n待分析数据：" + string(rawPayload)
		reply, err := client.ChatTextWithImages(c.Request.Context(), []sub2api.Message{
			{Role: "system", Content: system}, {Role: "user", Content: user},
		}, nil, nil)
		if err != nil {
			fail(c, apperr.E("ai_analysis_failed", "AI 检测失败："+err.Error(), 502))
			return
		}
		var results []promptImportAIResult
		if err := json.Unmarshal([]byte(compactAIJSON(reply)), &results); err != nil {
			fail(c, apperr.E("ai_analysis_failed", "AI 检测结果格式无效", 502))
			return
		}
		for _, result := range results {
			item := byID[result.ID]
			if item == nil {
				continue
			}
			patch := store.PromptImportItemPatch{}
			if _, ok := validCategories[result.Category]; ok {
				value := result.Category
				patch.Category = &value
			}
			if result.Compliance == "safe" || result.Compliance == "blocked" {
				value := result.Compliance
				patch.ComplianceStatus = &value
				reason := strings.TrimSpace(result.Reason)
				patch.ComplianceReason = &reason
			}
			if duplicate := byID[result.DuplicateOf]; duplicate != nil && duplicate.ID != item.ID {
				kind, title, action, ref := "possible", duplicate.Title, "pending", duplicate.ID
				patch.DuplicateKind, patch.DuplicateTitle = &kind, &title
				patch.DuplicateAction, patch.DuplicateRefID = &action, &ref
			}
			if _, err := store.PatchPromptImportItem(c.Request.Context(), s.St.Pool, batch.ID, item.ID, patch); err != nil {
				fail(c, err)
				return
			}
			analyzed++
		}
	}
	if err := store.MarkPromptImportBatchAnalyzed(c.Request.Context(), s.St.Pool, batch.ID, "ai"); err != nil {
		fail(c, err)
		return
	}
	if err := store.RefreshPromptImportBatchCounts(c.Request.Context(), s.St.Pool, batch.ID); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"analyzed": analyzed})
}

func (s *Server) adminPublishPromptImportBatch(c *gin.Context, _ *store.User) {
	batch, okBatch := s.promptImportBatch(c)
	if !okBatch {
		return
	}
	if batch.Status != "review" {
		fail(c, apperr.E("conflict", "当前批次不能发布", 409))
		return
	}
	imported, updated, err := store.PublishPromptImportBatch(c.Request.Context(), s.St, batch.ID)
	if err != nil {
		fail(c, apperr.E("conflict", err.Error(), 409))
		return
	}
	ok(c, gin.H{"imported": imported, "updated": updated, "newUntilHours": 24})
}
