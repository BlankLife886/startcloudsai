package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	storagepkg "github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var (
	errTaskImageMissing = errors.New("task image missing")
	errTaskImageFormat  = errors.New("task image unsupported")
	errTaskImageContent = errors.New("task image unreadable")
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

func isOwnedUserUploadImageKey(userID uuid.UUID, key string) bool {
	key = strings.TrimSpace(key)
	if key == "" || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return false
	}
	prefix := "uploads/" + userID.String() + "/"
	for _, directory := range []string{"original/", "thumb/"} {
		if !strings.HasPrefix(key, prefix+directory) {
			continue
		}
		name := strings.TrimPrefix(key, prefix+directory)
		return name != "" && !strings.Contains(name, "/")
	}
	return false
}

func isOwnedTaskOutputImageKey(userID uuid.UUID, key string) bool {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 512 || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return false
	}
	prefix := "tasks/" + userID.String() + "/"
	if !strings.HasPrefix(key, prefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(key, prefix), "/")
	if len(parts) != 3 || (parts[1] != "original" && parts[1] != "thumb") || parts[2] == "" {
		return false
	}
	_, err := uuid.Parse(parts[0])
	return err == nil
}

func isOwnedAssistantOutputImageKey(userID uuid.UUID, key string) bool {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 512 || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return false
	}
	prefix := "tasks/" + userID.String() + "/"
	if !strings.HasPrefix(key, prefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(key, prefix), "/")
	if len(parts) != 3 || parts[0] != "assistant" || parts[2] == "" {
		return false
	}
	_, err := uuid.Parse(parts[1])
	return err == nil
}

func isOwnedTaskImageKey(userID uuid.UUID, key string) bool {
	return isOwnedUserUploadImageKey(userID, key) ||
		isOwnedTaskOutputImageKey(userID, key) ||
		isOwnedAssistantOutputImageKey(userID, key)
}

// inspectOwnedUserUploadImage verifies the stored bytes instead of trusting a
// client-provided content type or a key-shaped path.
func (s *Server) inspectOwnedUserUploadImage(ctx context.Context, userID uuid.UUID, key string, maxBytes int64) (int64, string, error) {
	key = strings.TrimSpace(key)
	if !isOwnedUserUploadImageKey(userID, key) {
		return 0, "", fmt.Errorf("object key is not an owned upload image")
	}
	data, err := s.Storage.GetBytesLimit(ctx, key, maxBytes)
	if err != nil {
		return 0, "", err
	}
	return inspectUserUploadImageData(data)
}

// inspectOwnedTaskImage verifies both user uploads and task output images.
// Task input validation must inspect bytes because a key-shaped path alone is
// not evidence that the object is an image or that its contents are complete.
func (s *Server) inspectOwnedTaskImage(ctx context.Context, userID uuid.UUID, key string, maxBytes int64) (int64, error) {
	key = strings.TrimSpace(key)
	if !isOwnedTaskImageKey(userID, key) {
		return 0, fmt.Errorf("%w: object key is not an owned task image", errTaskImageMissing)
	}
	data, err := s.readOwnedTaskImageBytes(ctx, key, maxBytes)
	if err != nil {
		log.Printf("inspect task image %s: %v", key, err)
		return 0, err
	}
	size, _, err := inspectUserUploadImageData(data)
	if err != nil {
		log.Printf("inspect task image %s content: %v", key, err)
	}
	return size, err
}

func (s *Server) readOwnedTaskImageBytes(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		data, err := s.Storage.GetBytesLimit(ctx, key, maxBytes)
		if err == nil {
			return data, nil
		}
		lastErr = err
		if ctx.Err() != nil || !storagepkg.IsNotFound(err) || attempt == 3 {
			break
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("object read failed")
	}
	return nil, fmt.Errorf("%w: %v", errTaskImageMissing, lastErr)
}

func inspectUserUploadImageData(data []byte) (int64, string, error) {
	_, contentType := sniffImage(data)
	if contentType == "" {
		return 0, "", fmt.Errorf("%w: object is not a supported image", errTaskImageFormat)
	}
	if _, _, err := media.Dimensions(data); err != nil {
		return 0, "", fmt.Errorf("%w: %v", errTaskImageContent, err)
	}
	return int64(len(data)), contentType, nil
}

func (s *Server) cleanupUploadedObjectKeys(keys []string) {
	if len(keys) == 0 || s.Storage == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = s.Storage.DeleteKeys(cleanupCtx, keys)
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
		if errors.Is(rerr, io.EOF) {
			break
		}
		if rerr != nil {
			fail(c, rerr)
			return
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
		if err := store.RegisterUserUploadObjects(c.Request.Context(), s.St.Pool, user.ID, []string{key}); err != nil {
			s.cleanupUploadedObjectKeys([]string{key})
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
		s.cleanupUploadedObjectKeys(uploaded)
		fail(c, uploadErr)
		return
	}
	if err := store.RegisterUserUploadObjects(c.Request.Context(), s.St.Pool, user.ID, []string{key, thumbnailKey}); err != nil {
		s.cleanupUploadedObjectKeys([]string{key, thumbnailKey})
		fail(c, err)
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
	case strings.HasPrefix(key, "ecommerce-catalog/"),
		strings.HasPrefix(key, "ecommerce-tryon/"),
		strings.HasPrefix(key, "ecommerce-handheld/"):
		allowed = true // 后台上架的电商通用素材公开可读
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
	body, contentLength, contentType, err := s.Storage.OpenObject(ctx, key, 32<<20)
	if err != nil {
		if storagepkg.IsNotFound(err) {
			fail(c, apperr.E("not_found", "文件不存在", 404))
			return
		}
		fail(c, err)
		return
	}
	defer body.Close()
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(key))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("X-Content-Type-Options", "nosniff")
	c.DataFromReader(http.StatusOK, contentLength, contentType, body, nil)
}
