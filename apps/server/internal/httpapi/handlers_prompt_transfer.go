package httpapi

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/promptsync"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const promptTransferMaxBytes = 10 << 20

func (s *Server) adminExportPrompts(c *gin.Context, _ *store.User) {
	items, err := store.ListPromptArchiveItems(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	format := strings.ToLower(strings.TrimSpace(c.DefaultQuery("format", "json")))
	stamp := time.Now().UTC().Format("20060102-150405")
	if format == "csv" {
		var output bytes.Buffer
		output.WriteString("\xEF\xBB\xBF")
		writer := csv.NewWriter(&output)
		_ = writer.Write([]string{"id", "title", "prompt", "taskType", "category", "tags", "coverKey",
			"sort", "active", "sourceId", "sourceItemKey", "createdAt"})
		for _, item := range items {
			_ = writer.Write([]string{item.ID.String(), item.Title, item.Prompt, item.TaskType,
				item.Category, strings.Join(item.Tags, "|"), item.CoverKey, strconv.Itoa(item.Sort),
				strconv.FormatBool(item.Active), item.SourceID, item.SourceItemKey,
				item.CreatedAt.UTC().Format(time.RFC3339Nano)})
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			fail(c, err)
			return
		}
		c.Header("Content-Disposition", `attachment; filename="prompt-library-`+stamp+`.csv"`)
		c.Data(http.StatusOK, "text/csv; charset=utf-8", output.Bytes())
		return
	}
	if format != "json" {
		fail(c, apperr.E("validation_error", "format 仅支持 json 或 csv", 422))
		return
	}
	payload := struct {
		SchemaVersion int                        `json:"schemaVersion"`
		ExportedAt    string                     `json:"exportedAt"`
		Items         []*store.PromptArchiveItem `json:"items"`
	}{1, time.Now().UTC().Format(time.RFC3339Nano), items}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="prompt-library-`+stamp+`.json"`)
	c.Data(http.StatusOK, "application/json; charset=utf-8", raw)
}

type promptTransferItem struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Prompt        string   `json:"prompt"`
	TaskType      string   `json:"taskType"`
	Category      string   `json:"category"`
	Tags          []string `json:"tags"`
	CoverKey      string   `json:"coverKey"`
	CoverURL      string   `json:"coverUrl"`
	SourceItemKey string   `json:"sourceItemKey"`
}

func parsePromptTransferJSON(raw []byte) ([]promptTransferItem, error) {
	var wrapper struct {
		Items []promptTransferItem `json:"items"`
	}
	if err := json.Unmarshal(raw, &wrapper); err == nil && wrapper.Items != nil {
		return wrapper.Items, nil
	}
	var items []promptTransferItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("JSON 格式无效: %w", err)
	}
	return items, nil
}

func parsePromptTransferCSV(raw []byte) ([]promptTransferItem, error) {
	raw = bytes.TrimPrefix(raw, []byte("\xEF\xBB\xBF"))
	reader := csv.NewReader(bytes.NewReader(raw))
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("CSV 格式无效: %w", err)
	}
	if len(rows) < 2 {
		return nil, errors.New("CSV 没有数据行")
	}
	headers := make(map[string]int, len(rows[0]))
	for index, header := range rows[0] {
		headers[strings.ToLower(strings.TrimSpace(header))] = index
	}
	value := func(row []string, names ...string) string {
		for _, name := range names {
			if index, ok := headers[strings.ToLower(name)]; ok && index < len(row) {
				return strings.TrimSpace(row[index])
			}
		}
		return ""
	}
	items := make([]promptTransferItem, 0, len(rows)-1)
	for _, row := range rows[1:] {
		tagsText := value(row, "tags", "标签")
		separator := "|"
		if !strings.Contains(tagsText, "|") {
			separator = ","
		}
		tags := make([]string, 0)
		for _, tag := range strings.Split(tagsText, separator) {
			if tag = strings.TrimSpace(tag); tag != "" {
				tags = append(tags, tag)
			}
		}
		items = append(items, promptTransferItem{
			ID: value(row, "id"), Title: value(row, "title", "标题"),
			Prompt: value(row, "prompt", "提示词"), TaskType: value(row, "tasktype", "task_type", "功能"),
			Category: value(row, "category", "分类"), Tags: tags,
			CoverKey:      value(row, "coverkey", "cover_key", "封面"),
			SourceItemKey: value(row, "sourceitemkey", "source_item_key"),
		})
	}
	return items, nil
}

func (s *Server) adminUploadPromptImport(c *gin.Context, _ *store.User) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		fail(c, apperr.E("validation_error", "请选择 JSON 或 CSV 文件", 422))
		return
	}
	if fileHeader.Size > promptTransferMaxBytes {
		fail(c, apperr.E("payload_too_large", "导入文件不能超过 10MB", 413))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, promptTransferMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	if len(raw) > promptTransferMaxBytes {
		fail(c, apperr.E("payload_too_large", "导入文件不能超过 10MB", 413))
		return
	}
	var parsed []promptTransferItem
	switch strings.ToLower(filepath.Ext(fileHeader.Filename)) {
	case ".csv":
		parsed, err = parsePromptTransferCSV(raw)
	case ".json":
		parsed, err = parsePromptTransferJSON(raw)
	default:
		err = errors.New("仅支持 .json 或 .csv 文件")
	}
	if err != nil {
		fail(c, apperr.E("validation_error", err.Error(), 422))
		return
	}
	input := make([]promptsync.FilePrompt, 0, len(parsed))
	for _, item := range parsed {
		coverKey := item.CoverKey
		if coverKey == "" {
			coverKey = item.CoverURL
		}
		input = append(input, promptsync.FilePrompt{ID: item.ID, Title: item.Title, Prompt: item.Prompt,
			TaskType: item.TaskType, Category: item.Category, Tags: item.Tags, CoverKey: coverKey,
			SourceItemKey: item.SourceItemKey})
	}
	mode := strings.TrimSpace(c.PostForm("mode"))
	result, err := s.PromptSync.CreateFileImportBatch(c.Request.Context(), input, mode)
	if errors.Is(err, promptsync.ErrImportBatchPending) {
		fail(c, apperr.E("conflict", err.Error(), 409))
		return
	}
	if err != nil {
		fail(c, apperr.E("prompt_import_failed", "文件导入失败："+err.Error(), 422))
		return
	}
	respondCreated(c, result)
}
