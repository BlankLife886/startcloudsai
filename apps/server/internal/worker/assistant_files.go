package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantfiles"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

const (
	assistantFileLease             = 2 * time.Minute
	assistantFileHeartbeatInterval = 30 * time.Second
	assistantFileDispatchLimit     = 100
)

func (w *Worker) handleIngestAssistantFile(ctx context.Context, task *asynq.Task) error {
	var payload taskflow.IngestAssistantFilePayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("decode assistant file task: %w", err)
	}
	id, err := uuid.Parse(payload.FileID)
	if err != nil {
		return fmt.Errorf("invalid assistant file id: %w", err)
	}
	now := time.Now().UTC()
	file, err := store.ClaimAssistantFileIngestion(ctx, w.St.Pool, id, w.workerID, now, assistantFileLease)
	if err != nil || file == nil {
		return err
	}
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go w.heartbeatAssistantFileLease(workCtx, file, cancel)

	data, err := w.Storage.GetBytesLimit(workCtx, file.ObjectKey, w.Cfg.UploadMaxBytes)
	if err != nil {
		if file.Attempt >= 3 {
			_, failErr := store.FailAssistantFileIngestion(ctx, w.St.Pool, file,
				"storage_unavailable", "文件内容暂时无法读取，请重新上传")
			return failErr
		}
		return fmt.Errorf("read assistant file object: %w", err)
	}
	format, err := assistantfiles.Detect(file.Name, data)
	if err == nil {
		var document assistantfiles.Document
		document, err = assistantfiles.Parse(format, data)
		if errors.Is(err, assistantfiles.ErrNoText) && format.Extension == "pdf" && w.Cfg.AssistantOCREnabled {
			document, err = assistantfiles.OCRPDF(workCtx, data, document.PageCount, assistantfiles.OCRConfig{
				PDFToPPMPath:  w.Cfg.AssistantPDFToPPMPath,
				TesseractPath: w.Cfg.AssistantTesseractPath,
				Languages:     w.Cfg.AssistantOCRLanguages,
				MaxPages:      w.Cfg.AssistantOCRMaxPages,
				Timeout:       w.Cfg.AssistantOCRTimeout,
			})
		}
		if err == nil {
			segments := make([]store.AssistantFileSegment, 0, len(document.Segments))
			for index, segment := range document.Segments {
				segments = append(segments, store.AssistantFileSegment{
					FileID: file.ID, Ordinal: index, Locator: segment.Locator, Content: segment.Content,
				})
			}
			var completed bool
			err = w.St.Tx(workCtx, func(tx pgx.Tx) error {
				var completeErr error
				completed, completeErr = store.CompleteAssistantFileIngestion(workCtx, tx, file,
					assistantfiles.ParserVersion, document.PageCount, document.CharCount, segments)
				if completeErr != nil {
					return completeErr
				}
				if !completed {
					return context.Canceled
				}
				return nil
			})
			if err != nil {
				return err
			}
			return nil
		}
	}
	code, message := assistantFileParseError(err)
	_, failErr := store.FailAssistantFileIngestion(ctx, w.St.Pool, file, code, message)
	return failErr
}

func assistantFileParseError(err error) (string, string) {
	switch {
	case errors.Is(err, assistantfiles.ErrUnsupported):
		return "unsupported_file", "不支持该文档格式"
	case errors.Is(err, assistantfiles.ErrUnsafe):
		return "unsafe_file", "文档结构异常或超过安全限制"
	case errors.Is(err, assistantfiles.ErrNoText):
		return "no_text", "文档中没有可提取的文字"
	case errors.Is(err, assistantfiles.ErrOCRFailed):
		return "ocr_failed", "扫描版 PDF 文字识别失败，请检查文档清晰度后重试"
	default:
		message := strings.TrimSpace(fmt.Sprint(err))
		if len([]rune(message)) > 300 {
			message = string([]rune(message)[:300])
		}
		return "parse_failed", "文档解析失败：" + message
	}
}

func (w *Worker) heartbeatAssistantFileLease(ctx context.Context, file *store.AssistantFile, cancel context.CancelFunc) {
	if file == nil || file.LeaseOwner == nil {
		return
	}
	ticker := time.NewTicker(assistantFileHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			ok, err := store.RenewAssistantFileIngestionLease(ctx, w.St.Pool, file.ID, file.Attempt,
				*file.LeaseOwner, now.UTC(), assistantFileLease)
			if err != nil {
				log.Printf("assistant file %s lease heartbeat failed: %v", file.ID, err)
			} else if !ok {
				cancel()
				return
			}
		}
	}
}

func (w *Worker) dispatchAssistantFiles(ctx context.Context) error {
	ids, err := store.ListPendingAssistantFileIDs(ctx, w.St.Pool, time.Now().UTC(), assistantFileDispatchLimit)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := w.Queue.EnqueueAssistantFileRecovery(ctx, id.String()); err != nil {
			log.Printf("assistant file %s enqueue failed: %v", id, err)
		}
	}
	return nil
}

func (w *Worker) handleDispatchAssistantFiles(ctx context.Context, _ *asynq.Task) error {
	return w.dispatchAssistantFiles(ctx)
}
