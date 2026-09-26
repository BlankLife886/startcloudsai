package httpapi

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// storedUserUpload describes only objects created by this upload attempt. SHA256
// identifies the original bytes independently of generated object names.
type storedUserUpload struct {
	Key, ThumbnailKey, DisplayKey, ContentType, SHA256 string
	SizeBytes                                          int64
	Objects                                            []store.UserUploadObjectSize
}

func (item *storedUserUpload) response(prefix string) gin.H {
	data := gin.H{"key": item.Key, "url": prefix + item.Key,
		"contentType": item.ContentType, "sizeBytes": item.SizeBytes}
	if item.ThumbnailKey != "" {
		data["thumbnailKey"], data["thumbnailUrl"] = item.ThumbnailKey, prefix+item.ThumbnailKey
		data["displayKey"], data["displayUrl"] = item.DisplayKey, prefix+item.DisplayKey
	}
	return data
}

type userUploadStorage interface {
	UploadBytes(context.Context, string, []byte, string) error
	DeleteKeys(context.Context, []string) error
}

type userUploadRegistration func(context.Context, uuid.UUID, []store.UserUploadObjectSize) error

// readUploadFile does not trust the supplied length or MIME type. The multipart
// request itself is bounded by the calling handler before it is parsed.
func readUploadFile(header *multipart.FileHeader, maxBytes int64) ([]byte, error) {
	if header == nil {
		return nil, apperr.E("validation_error", "file: 缺少上传文件", 422)
	}
	if maxBytes <= 0 || header.Size > maxBytes {
		return nil, apperr.E("upload_too_large", "文件超过上传大小限制", 413)
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, apperr.E("upload_too_large", "文件超过上传大小限制", 413)
	}
	if len(data) == 0 {
		return nil, apperr.E("unsupported_file", "文件为空", 400)
	}
	return data, nil
}

// storeOpenAIInputImage shares the public upload security and quota path; it
// returns errors without committing an HTTP response to the compatibility API.
func (s *Server) storeOpenAIInputImage(c *gin.Context, user *store.User, header *multipart.FileHeader) (*storedUserUpload, error) {
	return s.storeUserUpload(c, user, header, true)
}

func (s *Server) storeUserUpload(c *gin.Context, user *store.User, header *multipart.FileHeader, imageOnly bool) (*storedUserUpload, error) {
	if user == nil {
		return nil, apperr.E("auth_required", "请先登录", 401)
	}
	if header == nil {
		return nil, apperr.E("validation_error", "file: 缺少上传文件", 422)
	}
	if err := s.takeUsageLimit(c, "upload-count-minute", user.ID.String(), uploadRequestsPerMinute, 1, time.Minute); err != nil {
		return nil, err
	}
	if err := s.takeUsageLimit(c, "upload-bytes-day", user.ID.String(), uploadBytesPerDay, max(header.Size, 1), 24*time.Hour); err != nil {
		return nil, err
	}
	ctx := c.Request.Context()
	storedBytes, err := store.UserUploadStorageBytes(ctx, s.St.Pool, user.ID)
	if err != nil {
		return nil, err
	}
	if header.Size > uploadStorageMaxBytes || storedBytes > uploadStorageMaxBytes-header.Size {
		return nil, apperr.E("upload_storage_limit", "个人素材存储空间已满，请先删除不再使用的素材", 413)
	}
	data, err := readUploadFile(header, s.Cfg.UploadMaxBytes)
	if err != nil {
		return nil, err
	}
	contentHash := fmt.Sprintf("%x", sha256.Sum256(data))
	blocked, blockReason, err := store.IsUploadHashBlocked(ctx, s.St.Pool, contentHash)
	if err != nil {
		return nil, err
	}
	if blocked {
		s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &user.ID, ClientIP: c.ClientIP(),
			Category: "blocked_upload", Severity: "high", Score: 80, Action: "blocked",
			Reason: "上传内容命中安全黑名单", Metadata: map[string]any{"sha256": contentHash, "rule": blockReason}})
		return nil, apperr.E("upload_blocked", "该文件未通过安全检查", 422)
	}
	ext, contentType, isImage := sniffUploadMedia(data)
	if imageOnly && !isImage {
		return nil, apperr.E("unsupported_file", "image: 仅支持 png / jpg / webp 图片", 400)
	}
	if ext == "" {
		return nil, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片、mp4 / webm 视频或 mp3 / wav / m4a / ogg 音频", 400)
	}
	if isImage {
		if _, _, err := media.Dimensions(data); err != nil {
			return nil, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", 400)
		}
	}
	if address := strings.TrimSpace(s.Cfg.UploadClamAVAddr); address != "" {
		if err := scanWithClamAV(ctx, address, data, s.Cfg.UploadScanTimeout); err != nil {
			if strings.Contains(err.Error(), "malware detected") {
				s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &user.ID, ClientIP: c.ClientIP(),
					Category: "malware_upload", Severity: "critical", Score: 100, Action: "blocked",
					Reason: "上传文件检出恶意内容", Metadata: map[string]any{"sha256": contentHash}})
				return nil, apperr.E("upload_malware_detected", "该文件未通过安全检查", 422)
			}
			return nil, apperr.E("upload_scanner_unavailable", "文件安全检查服务暂时不可用，请稍后重试", 503)
		}
	}
	if endpoint := strings.TrimSpace(s.Cfg.UploadReviewURL); endpoint != "" {
		err := reviewUploadContent(ctx, endpoint, s.Cfg.UploadReviewKey, contentType,
			contentHash, data, s.Cfg.UploadScanTimeout, s.Cfg.AppEnv != "production")
		if err != nil {
			if strings.Contains(err.Error(), "content rejected") {
				s.recordRisk(ctx, store.NewSecurityRiskEvent{UserID: &user.ID, ClientIP: c.ClientIP(),
					Category: "unsafe_upload", Severity: "high", Score: 90, Action: "blocked",
					Reason: "上传内容未通过独立内容审核", Metadata: map[string]any{"sha256": contentHash, "contentType": contentType}})
				return nil, apperr.E("upload_content_rejected", "该文件未通过内容安全审核", 422)
			}
			return nil, apperr.E("upload_review_unavailable", "内容安全审核服务暂时不可用，请稍后重试", 503)
		}
	}
	variantCfg := settings.ImageVariantConfig{Format: "webp", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
	if isImage {
		if configured, err := settings.ResolveImageVariants(ctx, s.St.Pool); err == nil {
			variantCfg = configured
		}
	}
	return persistUserUpload(ctx, user.ID, data, variantCfg, s.Storage, s.registerUploadWithinQuota)
}

// persistUserUpload runs only after content security checks. Keeping object IO
// and quota registration injectable lets failure cleanup be tested locally.
func persistUserUpload(ctx context.Context, userID uuid.UUID, data []byte, variantCfg settings.ImageVariantConfig, storage userUploadStorage, register userUploadRegistration) (*storedUserUpload, error) {
	ext, contentType, isImage := sniffUploadMedia(data)
	if ext == "" || storage == nil || register == nil {
		return nil, apperr.E("unsupported_file", "文件内容无法读取", 400)
	}
	fileID := uuid.NewString()
	item := &storedUserUpload{
		Key:         fmt.Sprintf("uploads/%s/original/%s.%s", userID, fileID, ext),
		ContentType: contentType, SizeBytes: int64(len(data)), SHA256: fmt.Sprintf("%x", sha256.Sum256(data)),
	}
	type uploadPart struct {
		key, contentType string
		data             []byte
		optional         bool
	}
	parts := []uploadPart{{key: item.Key, contentType: contentType, data: data}}
	if isImage {
		thumbnail, err := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Quality: 75, MaxEdge: variantCfg.ThumbMaxEdge,
		})
		if err != nil {
			return nil, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", 400)
		}
		item.ThumbnailKey = fmt.Sprintf("uploads/%s/thumb/%s", userID, fileID)
		item.DisplayKey = store.DisplayKeyForOriginal(item.Key)
		parts = append(parts, uploadPart{key: item.ThumbnailKey, contentType: thumbnail.ContentType, data: thumbnail.Data})
		// Display output remains optional, as in the original upload endpoint.
		display, err := media.EncodeVariant(data, media.VariantOptions{
			Format: variantCfg.Format, Lossless: variantCfg.Lossless,
			Quality: variantCfg.Quality, MaxEdge: variantCfg.DisplayMaxEdge,
		})
		if err == nil {
			parts = append(parts, uploadPart{key: item.DisplayKey, contentType: display.ContentType, data: display.Data, optional: true})
		} else {
			log.Printf("upload display variant skipped key=%s: %v", item.DisplayKey, err)
		}
	}
	errs := make(chan struct {
		part uploadPart
		err  error
	}, len(parts))
	for _, part := range parts {
		go func(part uploadPart) {
			errs <- struct {
				part uploadPart
				err  error
			}{part, storage.UploadBytes(ctx, part.key, part.data, part.contentType)}
		}(part)
	}
	var uploadErr error
	attempted := make([]string, 0, len(parts))
	optionalFailed := make([]string, 0, 1)
	for range parts {
		result := <-errs
		attempted = append(attempted, result.part.key)
		if result.err != nil {
			if result.part.optional {
				log.Printf("upload display variant skipped key=%s: %v", result.part.key, result.err)
				optionalFailed = append(optionalFailed, result.part.key)
			} else {
				uploadErr = result.err
			}
			continue
		}
		item.Objects = append(item.Objects, store.UserUploadObjectSize{Key: result.part.key, SizeBytes: int64(len(result.part.data))})
	}
	if uploadErr == nil {
		uploadErr = register(ctx, userID, item.Objects)
	}
	if uploadErr != nil {
		// All object names are newly generated and have not escaped this helper.
		// Also remove uncertain writes whose response failed after storage saved it.
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = storage.DeleteKeys(cleanupCtx, attempted)
		return nil, uploadErr
	}
	if len(optionalFailed) > 0 {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = storage.DeleteKeys(cleanupCtx, optionalFailed)
	}
	return item, nil
}

func uploadCleanupGroups(userID uuid.UUID, uploads []*storedUserUpload) [][]string {
	groups := make([][]string, 0, len(uploads))
	for _, item := range uploads {
		if item == nil || !strings.HasPrefix(item.Key, "uploads/"+userID.String()+"/original/") || !isOwnedUserUploadImageKey(userID, item.Key) {
			continue
		}
		keys := []string{item.Key}
		seen := map[string]bool{item.Key: true}
		for _, object := range item.Objects {
			if !seen[object.Key] && isOwnedUserUploadImageKey(userID, object.Key) && (object.Key == item.ThumbnailKey || object.Key == item.DisplayKey) {
				keys = append(keys, object.Key)
				seen[object.Key] = true
			}
		}
		groups = append(groups, keys)
	}
	return groups
}

func unreferencedUploadGroupKeys(groups [][]string, claimed []string) []string {
	available := make(map[string]bool, len(claimed))
	for _, key := range claimed {
		available[key] = true
	}
	cleanable := make([]string, 0, len(claimed))
	for _, group := range groups {
		complete := true
		for _, key := range group {
			complete = complete && available[key]
		}
		if complete {
			cleanable = append(cleanable, group...)
		}
	}
	return cleanable
}

// cleanupUnreferencedUploadedFiles durably releases failed/replayed uploads.
// It shares object-reference locks with task submission. If any object in an
// upload is referenced, the whole original/preview group is preserved. Physical
// deletion uses the existing cleanup worker, which rechecks all live references.
func (s *Server) cleanupUnreferencedUploadedFiles(ctx context.Context, userID uuid.UUID, uploads []*storedUserUpload) error {
	groups := uploadCleanupGroups(userID, uploads)
	if len(groups) == 0 {
		return nil
	}
	keys := make([]string, 0, len(groups)*3)
	for _, group := range groups {
		keys = append(keys, group...)
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return s.St.Tx(cleanupCtx, func(tx pgx.Tx) error {
		if err := store.LockObjectReferenceKeys(cleanupCtx, tx, keys); err != nil {
			return err
		}
		claimed, err := store.ClaimUnreferencedUserUploadObjects(cleanupCtx, tx, keys, time.Now().UTC().Add(time.Minute))
		if err != nil {
			return err
		}
		cleanable := unreferencedUploadGroupKeys(groups, claimed)
		if _, err := store.MarkUserUploadObjectsDeleted(cleanupCtx, tx, cleanable); err != nil {
			return err
		}
		return store.EnqueueObjectCleanup(cleanupCtx, tx, cleanable)
	})
}
