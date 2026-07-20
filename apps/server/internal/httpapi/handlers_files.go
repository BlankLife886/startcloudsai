package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// sniffImage 魔数识别 → (ext, contentType)；不支持返回 ("", "")。
func sniffImage(data []byte) (string, string) {
	if len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		return "png", "image/png"
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "jpg", "image/jpeg"
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "webp", "image/webp"
	}
	return "", ""
}

func (s *Server) upload(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", 422))
		return
	}
	if fileHeader.Size > s.Cfg.UploadMaxBytes {
		fail(c, apperr.E("upload_too_large", "文件不能超过 15MB", 413))
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return
	}
	defer f.Close()
	data := make([]byte, 0, fileHeader.Size)
	buf := make([]byte, 64*1024)
	for {
		n, rerr := f.Read(buf)
		data = append(data, buf[:n]...)
		if int64(len(data)) > s.Cfg.UploadMaxBytes {
			fail(c, apperr.E("upload_too_large", "文件不能超过 15MB", 413))
			return
		}
		if rerr != nil {
			break
		}
	}
	if len(data) == 0 {
		fail(c, apperr.E("unsupported_file", "文件为空", 400))
		return
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", 400))
		return
	}
	key := "uploads/" + user.ID.String() + "/" + uuid.NewString() + "." + ext
	if err := s.Storage.UploadBytes(c.Request.Context(), key, data, contentType); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"key": key, "url": "/api/files/" + key})
}

func (s *Server) getFile(c *gin.Context) {
	key := strings.Trim(c.Param("key"), "/")
	if key == "" || strings.Contains(key, "..") {
		fail(c, apperr.E("not_found", "文件不存在", 404))
		return
	}
	user, err := s.currentUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()

	allowed := false
	switch {
	case user != nil && user.Role == "admin":
		allowed = true
	case user != nil && (strings.HasPrefix(key, "uploads/"+user.ID.String()+"/") ||
		strings.HasPrefix(key, "tasks/"+user.ID.String()+"/")):
		allowed = true
	default:
		public, perr := store.IsPublicGalleryKey(ctx, s.St.Pool, key)
		if perr != nil {
			fail(c, perr)
			return
		}
		allowed = public
	}
	if !allowed {
		if user == nil {
			fail(c, apperr.E("auth_required", "请先登录", 401))
			return
		}
		fail(c, apperr.E("not_found", "文件不存在", 404))
		return
	}
	url, err := s.Storage.PresignGet(ctx, key)
	if err != nil {
		fail(c, err)
		return
	}
	c.Redirect(302, url)
}
