package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	storagepkg "github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var (
	errTaskImageMissing = errors.New("task image missing")
	errTaskImageFormat  = errors.New("task image unsupported")
	errTaskImageContent = errors.New("task image unreadable")
	errTaskImageTimeout = errors.New("task image timeout")
)

const taskImageHeaderBytes = 1 << 20

// mp4FtypBrands 允许的 MP4 major brand 白名单。ftyp box 可以携带任意 brand
// （如 heic、qt、3gp 等非 MP4 视频容器），只认 "ftyp" 四个字节会把它们全部
// 当成 video/mp4 放行，因此这里显式收紧到常见的 MP4 视频 brand。
var mp4FtypBrands = map[string]bool{
	"isom": true, "iso2": true, "iso4": true, "iso5": true, "iso6": true,
	"mp41": true, "mp42": true, "avc1": true, "av01": true, "dash": true,
	"M4V ": true,
	"M4A ": true,
}

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
	if len(data) >= 12 && string(data[4:8]) == "ftyp" && mp4FtypBrands[string(data[8:12])] {
		if string(data[8:12]) == "M4A " {
			return "m4a", "audio/mp4", false
		}
		return "mp4", "video/mp4", false
	}
	if len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3 {
		return "webm", "video/webm", false
	}
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE" {
		return "wav", "audio/wav", false
	}
	if len(data) >= 3 && string(data[:3]) == "ID3" {
		return "mp3", "audio/mpeg", false
	}
	if len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0 {
		return "mp3", "audio/mpeg", false
	}
	if len(data) >= 4 && string(data[:4]) == "OggS" {
		return "ogg", "audio/ogg", false
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
	for _, directory := range []string{"original/", "thumb/", "display/"} {
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
	if len(parts) != 3 || (parts[1] != "original" && parts[1] != "thumb" && parts[1] != "display") || parts[2] == "" {
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

func isOwnedTaskMediaKey(userID uuid.UUID, key string) bool {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 512 || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return false
	}
	uploadPrefix := "uploads/" + userID.String() + "/original/"
	if strings.HasPrefix(key, uploadPrefix) && !strings.Contains(strings.TrimPrefix(key, uploadPrefix), "/") {
		return true
	}
	taskPrefix := "tasks/" + userID.String() + "/"
	if !strings.HasPrefix(key, taskPrefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(key, taskPrefix), "/")
	if len(parts) != 3 || parts[1] != "original" || parts[2] == "" {
		return false
	}
	_, err := uuid.Parse(parts[0])
	return err == nil
}

func (s *Server) inspectOwnedTaskMedia(ctx context.Context, userID uuid.UUID, key string, maxBytes int64) (int64, error) {
	if !isOwnedTaskMediaKey(userID, key) {
		return 0, errors.New("object key is not an owned media file")
	}
	size, err := s.Storage.ObjectSize(ctx, key)
	if err != nil || size <= 0 || size > maxBytes {
		return 0, errors.New("media file is missing or too large")
	}
	limit := int64(taskImageHeaderBytes)
	if size < limit {
		limit = size
	}
	header, err := s.Storage.GetBytesPrefix(ctx, key, limit)
	if err != nil {
		return 0, err
	}
	if ext, _, _ := sniffUploadMedia(header); ext == "" {
		return 0, errors.New("unsupported media file")
	}
	return size, nil
}

func isPublicEcommerceCatalogImageKey(key string) bool {
	key = strings.TrimSpace(key)
	if key == "" || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return false
	}
	for _, prefix := range []string{"ecommerce-catalog/", "ecommerce-tryon/", "ecommerce-handheld/"} {
		if strings.HasPrefix(key, prefix) && len(strings.TrimPrefix(key, prefix)) > 0 {
			return true
		}
	}
	return false
}

func isAllowedTaskInputImageKey(userID uuid.UUID, key string) bool {
	return isOwnedTaskImageKey(userID, key) || isPublicEcommerceCatalogImageKey(key)
}

func mapTaskImageReadError(err error) error {
	if err == nil {
		return nil
	}
	if storagepkg.IsNotFound(err) {
		return fmt.Errorf("%w: %v", errTaskImageMissing, err)
	}
	if errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") ||
		strings.Contains(strings.ToLower(err.Error()), "timeout") {
		return fmt.Errorf("%w: %v", errTaskImageTimeout, err)
	}
	return fmt.Errorf("%w: %v", errTaskImageMissing, err)
}

// inspectOwnedUserUploadImage verifies the stored bytes instead of trusting a
// client-provided content type or a key-shaped path.
func (s *Server) inspectOwnedUserUploadImage(ctx context.Context, userID uuid.UUID, key string, maxBytes int64) (int64, string, error) {
	size, contentType, _, err := s.inspectOwnedUserUploadImageWithHash(ctx, userID, key, maxBytes)
	return size, contentType, err
}

func (s *Server) inspectOwnedUserUploadImageWithHash(ctx context.Context, userID uuid.UUID, key string, maxBytes int64) (int64, string, string, error) {
	key = strings.TrimSpace(key)
	if !isOwnedUserUploadImageKey(userID, key) {
		return 0, "", "", fmt.Errorf("object key is not an owned upload image")
	}
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		data, err := s.Storage.GetBytesLimit(ctx, key, maxBytes)
		if err == nil {
			size, contentType, inspectErr := inspectUserUploadImageData(data)
			if inspectErr != nil {
				return 0, "", "", inspectErr
			}
			return size, contentType, fmt.Sprintf("%x", sha256.Sum256(data)), nil
		}
		lastErr = err
		if ctx.Err() != nil || !storagepkg.IsNotFound(err) || attempt == 3 {
			break
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return 0, "", "", ctx.Err()
		case <-timer.C:
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("object read failed")
	}
	return 0, "", "", lastErr
}

// inspectOwnedTaskImage verifies user uploads, task outputs, and public
// ecommerce catalog images. Task input validation inspects the image header
// instead of downloading the full original, because a key-shaped path alone
// is not evidence that the object is a complete image.
func (s *Server) inspectOwnedTaskImage(ctx context.Context, userID uuid.UUID, key string, maxBytes int64) (int64, error) {
	key = strings.TrimSpace(key)
	if !isAllowedTaskInputImageKey(userID, key) {
		return 0, fmt.Errorf("%w: object key is not an allowed task image", errTaskImageMissing)
	}
	size, err := s.Storage.ObjectSize(ctx, key)
	if err != nil {
		log.Printf("inspect task image %s: %v", key, err)
		return 0, mapTaskImageReadError(err)
	}
	if size <= 0 || size > maxBytes {
		return 0, fmt.Errorf("%w: object size %d", errTaskImageContent, size)
	}
	headerLimit := int64(taskImageHeaderBytes)
	if size < headerLimit {
		headerLimit = size
	}
	header, err := s.Storage.GetBytesPrefix(ctx, key, headerLimit)
	if err != nil {
		log.Printf("inspect task image %s: %v", key, err)
		return 0, mapTaskImageReadError(err)
	}
	_, contentType := sniffImage(header)
	if contentType == "" {
		return 0, fmt.Errorf("%w: object is not a supported image", errTaskImageFormat)
	}
	if _, _, dimErr := media.Dimensions(header); dimErr != nil {
		log.Printf("inspect task image %s content: %v", key, dimErr)
		return 0, fmt.Errorf("%w: %v", errTaskImageContent, dimErr)
	}
	return size, nil
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

func (s *Server) registerUploadWithinQuota(ctx context.Context, userID uuid.UUID, objects []store.UserUploadObjectSize) error {
	incoming := int64(0)
	for _, object := range objects {
		if object.SizeBytes > 0 {
			incoming += object.SizeBytes
		}
	}
	return s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserUploadQuota(ctx, tx, userID); err != nil {
			return err
		}
		current, err := store.UserUploadStorageBytes(ctx, tx, userID)
		if err != nil {
			return err
		}
		if incoming > uploadStorageMaxBytes || current > uploadStorageMaxBytes-incoming {
			return apperr.E("upload_storage_limit", "个人素材存储空间已满，请先删除不再使用的素材", 413)
		}
		return store.RegisterUserUploadObjectSizes(ctx, tx, userID, objects)
	})
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
	if !s.enforceUsageLimit(c, "upload-count-minute", user.ID.String(), uploadRequestsPerMinute, 1, time.Minute) {
		return
	}
	if !s.enforceUsageLimit(c, "upload-bytes-day", user.ID.String(), uploadBytesPerDay, max(fileHeader.Size, 1), 24*time.Hour) {
		return
	}
	storedBytes, err := store.UserUploadStorageBytes(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if fileHeader.Size > uploadStorageMaxBytes || storedBytes > uploadStorageMaxBytes-fileHeader.Size {
		fail(c, apperr.E("upload_storage_limit", "个人素材存储空间已满，请先删除不再使用的素材", 413))
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
	contentHash := fmt.Sprintf("%x", sha256.Sum256(data))
	blocked, blockReason, err := store.IsUploadHashBlocked(c.Request.Context(), s.St.Pool, contentHash)
	if err != nil {
		fail(c, err)
		return
	}
	if blocked {
		s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &user.ID, ClientIP: c.ClientIP(),
			Category: "blocked_upload", Severity: "high", Score: 80, Action: "blocked",
			Reason: "上传内容命中安全黑名单", Metadata: map[string]any{"sha256": contentHash, "rule": blockReason}})
		fail(c, apperr.E("upload_blocked", "该文件未通过安全检查", 422))
		return
	}
	ext, contentType, isImage := sniffUploadMedia(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片、mp4 / webm 视频或 mp3 / wav / m4a / ogg 音频", 400))
		return
	}
	if address := strings.TrimSpace(s.Cfg.UploadClamAVAddr); address != "" {
		if err := scanWithClamAV(c.Request.Context(), address, data, s.Cfg.UploadScanTimeout); err != nil {
			if strings.Contains(err.Error(), "malware detected") {
				s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &user.ID, ClientIP: c.ClientIP(),
					Category: "malware_upload", Severity: "critical", Score: 100, Action: "blocked",
					Reason: "上传文件检出恶意内容", Metadata: map[string]any{"sha256": contentHash}})
				fail(c, apperr.E("upload_malware_detected", "该文件未通过安全检查", 422))
				return
			}
			fail(c, apperr.E("upload_scanner_unavailable", "文件安全检查服务暂时不可用，请稍后重试", 503))
			return
		}
	}
	if endpoint := strings.TrimSpace(s.Cfg.UploadReviewURL); endpoint != "" {
		err := reviewUploadContent(c.Request.Context(), endpoint, s.Cfg.UploadReviewKey, contentType,
			contentHash, data, s.Cfg.UploadScanTimeout, s.Cfg.AppEnv != "production")
		if err != nil {
			if strings.Contains(err.Error(), "content rejected") {
				s.recordRisk(c.Request.Context(), store.NewSecurityRiskEvent{UserID: &user.ID, ClientIP: c.ClientIP(),
					Category: "unsafe_upload", Severity: "high", Score: 90, Action: "blocked",
					Reason: "上传内容未通过独立内容审核", Metadata: map[string]any{"sha256": contentHash, "contentType": contentType}})
				fail(c, apperr.E("upload_content_rejected", "该文件未通过内容安全审核", 422))
				return
			}
			fail(c, apperr.E("upload_review_unavailable", "内容安全审核服务暂时不可用，请稍后重试", 503))
			return
		}
	}
	fileID := uuid.NewString()
	key := fmt.Sprintf("uploads/%s/original/%s.%s", user.ID, fileID, ext)
	if !isImage {
		if err := s.Storage.UploadBytes(c.Request.Context(), key, data, contentType); err != nil {
			fail(c, err)
			return
		}
		if err := s.registerUploadWithinQuota(c.Request.Context(), user.ID, []store.UserUploadObjectSize{{Key: key, SizeBytes: int64(len(data))}}); err != nil {
			s.cleanupUploadedObjectKeys([]string{key})
			fail(c, err)
			return
		}
		respondCreated(c, gin.H{
			"key": key, "url": storedFilePrefix(c) + key,
			"contentType": contentType, "sizeBytes": len(data),
		})
		return
	}
	variantCfg, err := settings.ResolveImageVariants(c.Request.Context(), s.St.Pool)
	if err != nil {
		variantCfg = settings.ImageVariantConfig{Format: "webp", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
	}
	thumbnail, err := media.EncodeVariant(data, media.VariantOptions{
		Format: variantCfg.Format, Quality: 75, MaxEdge: variantCfg.ThumbMaxEdge,
	})
	if err != nil {
		fail(c, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", 400))
		return
	}
	// 小图 key 不带扩展名：格式可在后台切换，内容类型由对象元数据提供。
	thumbnailKey := fmt.Sprintf("uploads/%s/thumb/%s", user.ID, fileID)
	displayKey := store.DisplayKeyForOriginal(key)
	type uploadResult struct {
		key       string
		sizeBytes int64
		err       error
		optional  bool
	}
	results := make(chan uploadResult, 3)
	go func() {
		results <- uploadResult{key: key, sizeBytes: int64(len(data)), err: s.Storage.UploadBytes(c.Request.Context(), key, data, contentType)}
	}()
	go func() {
		results <- uploadResult{key: thumbnailKey, sizeBytes: int64(len(thumbnail.Data)), err: s.Storage.UploadBytes(c.Request.Context(), thumbnailKey, thumbnail.Data, thumbnail.ContentType)}
	}()
	go func() {
		// 展示图失败不阻断上传，前端会回退加载原图。
		display, displayErr := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Lossless: variantCfg.Lossless,
			Quality: variantCfg.Quality, MaxEdge: variantCfg.DisplayMaxEdge,
		})
		if displayErr != nil {
			results <- uploadResult{key: displayKey, err: displayErr, optional: true}
			return
		}
		results <- uploadResult{key: displayKey, sizeBytes: int64(len(display.Data)), err: s.Storage.UploadBytes(c.Request.Context(), displayKey, display.Data, display.ContentType), optional: true}
	}()
	uploaded := make([]string, 0, 3)
	uploadedObjects := make([]store.UserUploadObjectSize, 0, 3)
	var uploadErr error
	for range 3 {
		result := <-results
		if result.err != nil {
			if result.optional {
				log.Printf("upload display variant skipped key=%s: %v", result.key, result.err)
				continue
			}
			uploadErr = result.err
			continue
		}
		uploaded = append(uploaded, result.key)
		uploadedObjects = append(uploadedObjects, store.UserUploadObjectSize{Key: result.key, SizeBytes: result.sizeBytes})
	}
	if uploadErr != nil {
		s.cleanupUploadedObjectKeys(uploaded)
		fail(c, uploadErr)
		return
	}
	if err := s.registerUploadWithinQuota(c.Request.Context(), user.ID, uploadedObjects); err != nil {
		s.cleanupUploadedObjectKeys(uploaded)
		fail(c, err)
		return
	}
	respondCreated(c, gin.H{
		"key": key, "url": storedFilePrefix(c) + key,
		"thumbnailKey": thumbnailKey, "thumbnailUrl": storedFilePrefix(c) + thumbnailKey,
		"displayKey": displayKey, "displayUrl": storedFilePrefix(c) + displayKey,
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
	case strings.HasPrefix(key, "canvas-template-covers/"):
		allowed = true // 画布生产模板封面公开可读
	case strings.HasPrefix(key, "canvas-template-assets/"):
		allowed = true // 已发布画布模板的内嵌资源公开可读
	case strings.HasPrefix(key, "announcement-images/"):
		allowed = true // 公告图片对用户端公开可读
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
		// 头像是公开展示物（画廊作者、拼团成员等都会引用其他用户的头像），
		// 对已登录用户放开；仍要求登录，防止未认证外链盗爬。
		if !allowed && user != nil && strings.HasPrefix(key, "uploads/") {
			avatar, aerr := store.IsUserAvatarKey(ctx, s.St.Pool, key)
			if aerr != nil {
				fail(c, aerr)
				return
			}
			allowed = avatar
		}
	}
	if !allowed {
		if user == nil {
			fail(c, apperr.E("auth_required", "请先登录", 401))
			return
		}
		fail(c, apperr.E("not_found", "文件不存在", 404))
		return
	}
	if c.Query("download") == "1" {
		name := filepath.Base(strings.ReplaceAll(strings.TrimSpace(c.Query("name")), "\\", "/"))
		name = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, name)
		name = strings.Trim(name, " .")
		if name == "" {
			name = filepath.Base(key)
		}
		if runes := []rune(name); len(runes) > 160 {
			name = string(runes[:160])
		}
		disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
		if disposition == "" {
			disposition = "attachment"
		}
		c.Header("Content-Disposition", disposition)
	}
	s.serveStoredObject(c, key, user, admin != nil)
}

// adminGetFile 管理后台文件访问：sc_admin_session 的 Cookie Path 是
// /api/v1/admin，浏览器不会把它带到 /api/v1/files/*，因此后台需要独立端点。
// 管理员可查看所有用户文件，跳过属主校验。
func (s *Server) adminGetFile(c *gin.Context, _ *store.User) {
	key := strings.Trim(c.Param("key"), "/")
	if key == "" || strings.Contains(key, "..") {
		fail(c, apperr.E("not_found", "文件不存在", 404))
		return
	}
	s.serveStoredObject(c, key, nil, true)
}

// compressCoverImage 按后台图片配置把纯展示封面（提示词封面等）压成展示尺寸。
// 封面不需要保留原图，压缩后直接落库；压缩失败原样返回，不阻断上传。
func (s *Server) compressCoverImage(ctx context.Context, data []byte, ext, contentType string) ([]byte, string, string) {
	cfg, err := settings.ResolveImageVariants(ctx, s.St.Pool)
	if err != nil {
		return data, ext, contentType
	}
	variant, err := media.EncodeVariant(data, media.VariantOptions{
		Format: cfg.Format, Lossless: cfg.Lossless, Quality: cfg.Quality, MaxEdge: 1280,
	})
	if err != nil {
		return data, ext, contentType
	}
	return variant.Data, variant.Ext, variant.ContentType
}

// isImmutableObjectKey 上传与任务产物 key 都带 UUID 且从不覆盖写，内容不可变，
// key 本身即内容指纹。后台可覆盖上传的素材（prompt-covers、ecommerce-* 等）不算。
func isImmutableObjectKey(key string) bool {
	if strings.HasPrefix(key, "tasks/") || strings.HasPrefix(key, "uploads/") ||
		strings.HasPrefix(key, "announcement-images/") || strings.HasPrefix(key, "canvas-template-assets/") {
		return true
	}
	for _, prefix := range []string{"prompt-covers/", "canvas-template-covers/", "ecommerce-catalog/"} {
		if remainder := strings.TrimPrefix(key, prefix); remainder != key && strings.Contains(remainder, "/") {
			return true
		}
	}
	return false
}

func objectKeyETag(key string) string {
	sum := sha256.Sum256([]byte(key))
	return `"` + hex.EncodeToString(sum[:16]) + `"`
}

func isSmallPreviewObjectKey(key string) bool {
	key = strings.Trim(strings.TrimSpace(key), "/")
	if key == "" {
		return false
	}
	// Only server-generated thumbnail layouts bypass active-download controls.
	// Original and display variants remain metered even if callers alter the query.
	parts := strings.Split(key, "/")
	if len(parts) == 5 && parts[0] == "tasks" && parts[2] == "assistant" && strings.HasSuffix(parts[4], "-thumb") {
		return true
	}
	if len(parts) == 4 && parts[0] == "uploads" && parts[2] == "thumb" {
		return true
	}
	return len(parts) == 5 && parts[0] == "tasks" && parts[3] == "thumb"
}

func shouldApplyFileEgressLimits(key string, download bool) bool {
	return download || !isSmallPreviewObjectKey(key)
}

// serveStoredObject 在权限校验完成后从对象存储流式交付内容，保持稳定的
// /files URL，并由应用统一处理下载文件名、Range、ETag 与缓存策略。
func (s *Server) serveStoredObject(c *gin.Context, key string, user *store.User, admin bool) {
	immutable := isImmutableObjectKey(key)
	cacheControl := "private, max-age=3600"
	etag := ""
	if immutable {
		cacheControl = "private, max-age=86400, immutable"
		etag = objectKeyETag(key)
	}
	writeCacheHeaders := func() {
		c.Header("Cache-Control", cacheControl)
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Accept-Ranges", "bytes")
		if etag != "" {
			c.Header("ETag", etag)
		}
	}
	// 内容不可变时 If-None-Match 命中直接 304，无需读取对象存储。
	if etag != "" {
		if match := c.GetHeader("If-None-Match"); match != "" && strings.Contains(match, etag) {
			writeCacheHeaders()
			c.Status(http.StatusNotModified)
			return
		}
	}
	limitEgress := !admin && shouldApplyFileEgressLimits(key, c.Query("download") == "1")
	var egressLease *fileEgressLease
	if limitEgress {
		var err error
		egressLease, err = s.beginFileEgress(c, user)
		if err != nil {
			fail(c, err)
			return
		}
		defer egressLease.release()
	}
	rangeSpec := strings.TrimSpace(c.GetHeader("Range"))
	openStartedAt := time.Now()
	stream, err := s.Storage.OpenObjectRange(c.Request.Context(), key, rangeSpec, 32<<20)
	openMs := time.Since(openStartedAt).Milliseconds()
	if err != nil {
		if storagepkg.IsNotFound(err) {
			if c.Query("soft_missing") == "1" && c.Query("download") != "1" {
				c.Header("Cache-Control", "private, no-store")
				c.Header("X-StarCloud-Media-Missing", "1")
				c.Status(http.StatusNoContent)
				return
			}
			fail(c, apperr.E("not_found", "文件不存在", 404))
			return
		}
		if rangeSpec != "" && storagepkg.IsInvalidRange(err) {
			c.Header("Accept-Ranges", "bytes")
			c.Status(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		fail(c, err)
		return
	}
	defer stream.Body.Close()
	if limitEgress {
		if err := s.chargeFileEgress(c, user, stream.ContentLength); err != nil {
			fail(c, err)
			return
		}
	}
	contentType := stream.ContentType
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(key))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	writeCacheHeaders()
	// 对象存储首字节耗时暴露给浏览器 DevTools（Timing 面板），便于区分
	// “对象存储慢”还是“传输/排队慢”。
	c.Header("Server-Timing", fmt.Sprintf("object_storage;dur=%d", openMs))
	status := http.StatusOK
	if stream.ContentRange != "" {
		status = http.StatusPartialContent
		c.Header("Content-Range", stream.ContentRange)
	}
	c.DataFromReader(status, stream.ContentLength, contentType, stream.Body, nil)
	if total := time.Since(openStartedAt); total > time.Second {
		log.Printf("slow file serve key=%s object_storage_open_ms=%d total_ms=%d bytes=%d", key, openMs, total.Milliseconds(), stream.ContentLength)
	}
}
