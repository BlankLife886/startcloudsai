package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const modelIconMaxBytes int64 = 2 << 20

func (s *Server) adminUploadModelIcon(c *gin.Context, _ *store.User) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || errors.Is(err, multipart.ErrMessageTooLarge) {
			fail(c, apperr.E("upload_too_large", "模型图标不能超过 2MB", http.StatusRequestEntityTooLarge))
			return
		}
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", http.StatusUnprocessableEntity))
		return
	}
	if fileHeader.Size <= 0 {
		fail(c, apperr.E("validation_error", "file: 上传文件不能为空", http.StatusUnprocessableEntity))
		return
	}
	if fileHeader.Size > modelIconMaxBytes {
		fail(c, apperr.E("upload_too_large", "模型图标不能超过 2MB", http.StatusRequestEntityTooLarge))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, modelIconMaxBytes+1))
	if err != nil {
		fail(c, err)
		return
	}
	if int64(len(data)) > modelIconMaxBytes {
		fail(c, apperr.E("upload_too_large", "模型图标不能超过 2MB", http.StatusRequestEntityTooLarge))
		return
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "模型图标仅支持 PNG、JPG 或 WebP", http.StatusBadRequest))
		return
	}
	data, ext, contentType = s.compressCoverImage(c.Request.Context(), data, ext, contentType)
	key := fmt.Sprintf("model-icons/%s.%s", uuid.NewString(), ext)
	if err := s.Storage.UploadBytes(c.Request.Context(), key, data, contentType); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{"key": key, "url": "/api/v1/files/" + key})
}
