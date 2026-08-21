package httpapi

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantfiles"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const assistantFileListLimit = 50

func (s *Server) assistantFiles(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListUserAssistantFiles(c.Request.Context(), s.St.Pool, user.ID, assistantFileListLimit)
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(items))
	for _, item := range items {
		out = append(out, assistantFileDict(item))
	}
	ok(c, gin.H{"files": out})
}

func (s *Server) assistantFile(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "文件 ID 无效", 422))
		return
	}
	item, err := store.GetUserAssistantFile(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "文件不存在", 404))
		return
	}
	ok(c, gin.H{"file": assistantFileDict(item)})
}

func (s *Server) createAssistantFile(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	header, err := c.FormFile("file")
	if err != nil {
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", 422))
		return
	}
	if header.Size <= 0 || header.Size > s.Cfg.UploadMaxBytes {
		fail(c, apperr.E("upload_too_large", "文档大小须在 1B-15MB 之间", 413))
		return
	}
	stream, err := header.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, s.Cfg.UploadMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	if int64(len(data)) > s.Cfg.UploadMaxBytes {
		fail(c, apperr.E("upload_too_large", "文档不能超过 15MB", 413))
		return
	}
	name := strings.TrimSpace(filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/")))
	if name == "" || name == "." {
		name = "document"
	}
	nameRunes := []rune(name)
	if len(nameRunes) > 255 {
		name = string(nameRunes[:255])
	}
	format, err := assistantfiles.Detect(name, data)
	if err != nil {
		message := "仅支持 TXT、Markdown、CSV、JSON、PDF、DOCX、XLSX 和 PPTX 文件"
		if errors.Is(err, assistantfiles.ErrUnsafe) {
			message = "文档包含不安全或异常膨胀的压缩内容"
		}
		fail(c, apperr.E("unsupported_file", message, 400))
		return
	}
	if format.Extension == "psd" {
		fail(c, apperr.E("assistant_psd_unavailable", "AI 助手暂不支持 PSD 文件", 400))
		return
	}
	id := uuid.New()
	key := fmt.Sprintf("uploads/%s/original/%s.%s", user.ID, id, format.Extension)
	if err := s.Storage.UploadBytes(c.Request.Context(), key, data, format.ContentType); err != nil {
		fail(c, err)
		return
	}
	sum := sha256.Sum256(data)
	var item *store.AssistantFile
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		if err := store.RegisterUserUploadObjects(c.Request.Context(), tx, user.ID, []string{key}); err != nil {
			return err
		}
		created, err := store.InsertAssistantFile(c.Request.Context(), tx, store.AssistantFile{
			ID: id, UserID: user.ID, ObjectKey: key, Name: name, ContentType: format.ContentType,
			SizeBytes: int64(len(data)), SHA256: fmt.Sprintf("%x", sum[:]), CreatedAt: time.Now().UTC(),
		})
		if err != nil {
			return err
		}
		if err := store.AddUserUploadReferences(c.Request.Context(), tx, user.ID,
			store.UploadReferenceAssistantFile, id, []string{key}); err != nil {
			return err
		}
		item = created
		return nil
	})
	if err != nil {
		s.cleanupUploadedObjectKeys([]string{key})
		fail(c, err)
		return
	}
	if s.Queue != nil {
		_ = s.Queue.EnqueueAssistantFile(c.Request.Context(), id.String())
	}
	respondCreated(c, gin.H{"file": assistantFileDict(item)})
}

func (s *Server) deleteAssistantFile(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "文件 ID 无效", 422))
		return
	}
	var deleted *store.AssistantFile
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		item, ok, err := store.DeleteUserAssistantFile(c.Request.Context(), tx, user.ID, id)
		if err != nil {
			return err
		}
		if !ok || item == nil {
			return apperr.E("not_found", "文件不存在", 404)
		}
		deleted = item
		return store.EnqueueObjectCleanup(c.Request.Context(), tx, []string{item.ObjectKey})
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"deleted": deleted.ID.String()})
}

func assistantFileDict(item *store.AssistantFile) gin.H {
	if item == nil {
		return gin.H{}
	}
	out := gin.H{
		"id": item.ID.String(), "name": item.Name, "contentType": item.ContentType,
		"sizeBytes": item.SizeBytes, "status": item.Status, "pageCount": item.PageCount,
		"charCount": item.CharCount, "segmentCount": item.SegmentCount,
		"createdAt": iso(&item.CreatedAt), "updatedAt": iso(&item.UpdatedAt),
	}
	if item.ErrorCode != nil {
		out["errorCode"] = *item.ErrorCode
	}
	if item.ErrorMessage != nil {
		out["errorMessage"] = *item.ErrorMessage
	}
	if item.FinishedAt != nil {
		out["finishedAt"] = iso(item.FinishedAt)
	}
	return out
}
