package httpapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	storagepkg "github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// sniffUploadMedia identifies supported upload formats from their signatures.
func sniffUploadMedia(data []byte) (ext string, contentType string, image bool) {
	if len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
		return "png", "image/png", true
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "jpg", "image/jpeg", true
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "webp", "image/webp", true
	}
	if len(data) >= 12 && string(data[4:8]) == "ftyp" {
		return "mp4", "video/mp4", false
	}
	if len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3 {
		return "webm", "video/webm", false
	}
	return "", "", false
}

func sniffImage(data []byte) (string, string) {
	ext, contentType, image := sniffUploadMedia(data)
	if !image {
		return "", ""
	}
	return ext, contentType
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
	ext, contentType, isImage := sniffUploadMedia(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片或 mp4 / webm 视频", 400))
		return
	}
	fileID := uuid.NewString()
	key := fmt.Sprintf("uploads/%s/original/%s.%s", user.ID, fileID, ext)
	if !isImage {
		if err := s.Storage.UploadBytes(c.Request.Context(), key, data, contentType); err != nil {
			fail(c, err)
			return
		}
		respondCreated(c, gin.H{
			"key": key, "url": "/api/v1/files/" + key,
			"contentType": contentType, "sizeBytes": len(data),
		})
		return
	}
	thumbnail, err := media.ThumbnailJPEG(data, 512)
	if err != nil {
		fail(c, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", 400))
		return
	}
	thumbnailKey := fmt.Sprintf("uploads/%s/thumb/%s.jpg", user.ID, fileID)
	type uploadResult struct {
		key string
		err error
	}
	results := make(chan uploadResult, 2)
	go func() {
		results <- uploadResult{key: key, err: s.Storage.UploadBytes(c.Request.Context(), key, data, contentType)}
	}()
	go func() {
		results <- uploadResult{key: thumbnailKey, err: s.Storage.UploadBytes(c.Request.Context(), thumbnailKey, thumbnail, "image/jpeg")}
	}()
	uploaded := make([]string, 0, 2)
	var uploadErr error
	for range 2 {
		result := <-results
		if result.err != nil {
			uploadErr = result.err
			continue
		}
		uploaded = append(uploaded, result.key)
	}
	if uploadErr != nil {
		if len(uploaded) > 0 {
			_ = s.Storage.DeleteKeys(c.Request.Context(), uploaded)
		}
		fail(c, uploadErr)
		return
	}
	respondCreated(c, gin.H{
		"key": key, "url": "/api/v1/files/" + key,
		"thumbnailKey": thumbnailKey, "thumbnailUrl": "/api/v1/files/" + thumbnailKey,
		"contentType": contentType, "sizeBytes": len(data),
	})
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
	admin, err := s.currentAdminAccount(c)
	if err != nil {
		fail(c, err)
		return
	}

	allowed := false
	switch {
	case strings.HasPrefix(key, "prompt-covers/"):
		allowed = true // 提示词封面公开可读
	case admin != nil:
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
	// 受保护文件统一由应用服务转发。此前这里 302 到 R2 的预签名地址，
	// 会把“用户是否能直连对象存储”变成图片能否展示的额外前提；在代理、
	// 企业网络或部分移动网络下，会出现任务已成功、R2 也有文件，但页面一直
	// 空白的情况。服务端本身已经能访问 R2（上传也走同一连接），因此在完成
	// 权限校验后由服务端读取并返回，交付链路会更稳定。
	data, err := s.Storage.GetBytesLimit(ctx, key, 32<<20)
	if err != nil {
		if storagepkg.IsNotFound(err) {
			fail(c, apperr.E("not_found", "文件不存在", 404))
			return
		}
		fail(c, err)
		return
	}
	if len(data) == 0 {
		fail(c, apperr.E("not_found", "文件不存在", 404))
		return
	}
	contentType := http.DetectContentType(data)
	if strings.HasSuffix(strings.ToLower(key), ".webp") {
		contentType = "image/webp"
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, data)
}
