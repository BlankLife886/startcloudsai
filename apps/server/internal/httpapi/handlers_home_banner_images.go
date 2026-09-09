package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const homeBannerOriginalPrefix = "announcement-images/home-banners/"

func (s *Server) adminUploadHomeBannerImage(c *gin.Context, _ *store.User) {
	// This is a memory budget, not an upload limit. Larger originals spill to
	// multipart temporary files and stream from disk to object storage.
	if err := c.Request.ParseMultipartForm(1 << 20); err != nil {
		if errors.Is(err, io.ErrUnexpectedEOF) {
			fail(c, apperr.E("invalid_upload", "图片上传数据不完整，请重新选择后重试", http.StatusBadRequest))
			return
		}
		fail(c, apperr.E("validation_error", "file: 缺少或无效的上传文件", http.StatusUnprocessableEntity))
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
	fileHeader, err := c.FormFile("file")
	if err != nil {
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", http.StatusUnprocessableEntity))
		return
	}
	if fileHeader.Size == 0 {
		fail(c, apperr.E("unsupported_file", "文件为空", http.StatusBadRequest))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer file.Close()
	var header [512]byte
	n, err := io.ReadFull(file, header[:])
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		fail(c, err)
		return
	}
	ext, contentType := sniffImage(header[:n])
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", http.StatusBadRequest))
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		fail(c, err)
		return
	}
	key := fmt.Sprintf("%s%s.%s", homeBannerOriginalPrefix, uuid.NewString(), ext)
	if err := s.Storage.UploadReader(c.Request.Context(), key, file, fileHeader.Size, contentType); err != nil {
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{"key": key, "url": "/api/v1/files/" + key})
}
