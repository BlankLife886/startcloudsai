// Package storage encapsulates S3-compatible object storage operations.
package storage

import (
	"bytes"
	"context"
	"crypto/md5" // #nosec G501 -- Alibaba CDN Type A requires MD5 by protocol.
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"

	appconfig "github.com/BlankLife886/startcloudsai/server/internal/config"
)

const (
	objectReadAttempts             = 3
	objectReadAttemptTimeout       = 30 * time.Second
	objectPrefixReadAttemptTimeout = 7 * time.Second
	objectDeleteConcurrency        = 8
	objectDeleteErrorDetailLimit   = 8
)

func IsNotFound(err error) bool {
	var statusErr interface{ HTTPStatusCode() int }
	if errors.As(err, &statusErr) && statusErr.HTTPStatusCode() == 404 {
		return true
	}
	var apiErr smithy.APIError
	return errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound")
}

// IsInvalidRange 客户端 Range 头超出对象大小时 S3/R2 返回 416。
func IsInvalidRange(err error) bool {
	var statusErr interface{ HTTPStatusCode() int }
	if errors.As(err, &statusErr) && statusErr.HTTPStatusCode() == 416 {
		return true
	}
	var apiErr smithy.APIError
	return errors.As(err, &apiErr) && apiErr.ErrorCode() == "InvalidRange"
}

type Storage struct {
	client        *s3.Client
	presigner     *s3.PresignClient
	bucket        string
	presignExpiry time.Duration
	cdnBaseURL    *url.URL
	cdnAuthKey    string
	cdnAuthTTL    time.Duration
}

type limitedReadCloser struct {
	reader io.Reader
	close  func() error
}

func (r *limitedReadCloser) Read(p []byte) (int, error) { return r.reader.Read(p) }
func (r *limitedReadCloser) Close() error               { return r.close() }

func ValidateConfig(cfg *appconfig.Config) error {
	if cfg == nil {
		return errors.New("对象存储配置不能为空")
	}
	missing := make([]string, 0, 4)
	for name, value := range map[string]string{
		"OBJECT_STORAGE_ENDPOINT":          cfg.ObjectStorageEndpoint,
		"OBJECT_STORAGE_ACCESS_KEY_ID":     cfg.ObjectStorageAccessKeyID,
		"OBJECT_STORAGE_SECRET_ACCESS_KEY": cfg.ObjectStorageSecretAccessKey,
		"OBJECT_STORAGE_BUCKET":            cfg.ObjectStorageBucket,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("对象存储配置不完整，缺少 %s", strings.Join(missing, "、"))
	}
	for name, value := range map[string]string{
		"OBJECT_STORAGE_ENDPOINT":        cfg.ObjectStorageEndpoint,
		"OBJECT_STORAGE_PUBLIC_ENDPOINT": cfg.ObjectStoragePublicEndpoint,
	} {
		if strings.TrimSpace(value) == "" {
			continue
		}
		endpoint, err := url.Parse(value)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
			return fmt.Errorf("%s 必须是完整的 HTTP(S) URL", name)
		}
		if endpoint.Scheme != "http" && endpoint.Scheme != "https" {
			return fmt.Errorf("%s 只支持 HTTP 或 HTTPS", name)
		}
	}
	if cfg.ObjectStoragePresignExpireSecs <= 0 {
		return errors.New("OBJECT_STORAGE_PRESIGN_EXPIRE_SECS 必须为正整数")
	}
	if value := strings.TrimSpace(cfg.ObjectStorageCDNBaseURL); value != "" {
		cdnURL, parseErr := url.Parse(value)
		if parseErr != nil || cdnURL.Scheme != "https" || cdnURL.Host == "" || cdnURL.RawQuery != "" || cdnURL.Fragment != "" {
			return errors.New("OBJECT_STORAGE_CDN_BASE_URL 必须是不含查询参数和片段的 HTTPS URL")
		}
	}
	if cfg.ObjectStorageCDNAuthKey != "" {
		if strings.TrimSpace(cfg.ObjectStorageCDNBaseURL) == "" {
			return errors.New("OBJECT_STORAGE_CDN_AUTH_KEY 需要同时配置 OBJECT_STORAGE_CDN_BASE_URL")
		}
		if len([]byte(cfg.ObjectStorageCDNAuthKey)) < 8 || len([]byte(cfg.ObjectStorageCDNAuthKey)) > 128 {
			return errors.New("OBJECT_STORAGE_CDN_AUTH_KEY 须为 8-128 字节")
		}
		if cfg.ObjectStorageCDNAuthTTLSecs < 60 || cfg.ObjectStorageCDNAuthTTLSecs > 86400 {
			return errors.New("OBJECT_STORAGE_CDN_AUTH_TTL_SECS 须在 60-86400 之间")
		}
	}
	return nil
}

func New(cfg *appconfig.Config) (*Storage, error) {
	region := strings.TrimSpace(cfg.ObjectStorageRegion)
	if region == "" {
		region = "auto"
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.ObjectStorageAccessKeyID, cfg.ObjectStorageSecretAccessKey, "")),
		awsconfig.WithRetryMaxAttempts(2),
		// Alibaba OSS implements the S3 API but rejects the SDK's optional
		// STREAMING-UNSIGNED-PAYLOAD-TRAILER encoding. Required-only mode keeps
		// checksums for operations that mandate them without adding trailers to
		// ordinary PutObject uploads.
		awsconfig.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired),
		awsconfig.WithResponseChecksumValidation(aws.ResponseChecksumValidationWhenRequired),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.ObjectStorageEndpoint)
		o.UsePathStyle = cfg.ObjectStorageUsePathStyle
	})
	presignClient := client
	publicEndpoint := strings.TrimSpace(cfg.ObjectStoragePublicEndpoint)
	if publicEndpoint != "" && publicEndpoint != strings.TrimRight(strings.TrimSpace(cfg.ObjectStorageEndpoint), "/") {
		presignClient = s3.NewFromConfig(awsCfg, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(publicEndpoint)
			o.UsePathStyle = cfg.ObjectStorageUsePathStyle
		})
	}
	var cdnBaseURL *url.URL
	if value := strings.TrimSpace(cfg.ObjectStorageCDNBaseURL); value != "" {
		cdnBaseURL, _ = url.Parse(value)
	}
	return &Storage{
		client:        client,
		presigner:     s3.NewPresignClient(presignClient),
		bucket:        cfg.ObjectStorageBucket,
		presignExpiry: time.Duration(cfg.ObjectStoragePresignExpireSecs) * time.Second,
		cdnBaseURL:    cdnBaseURL,
		cdnAuthKey:    strings.TrimSpace(cfg.ObjectStorageCDNAuthKey),
		cdnAuthTTL:    time.Duration(cfg.ObjectStorageCDNAuthTTLSecs) * time.Second,
	}, nil
}

func immutableDeliveryObjectKey(key string) bool {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
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

func objectUploadCacheControl(key string) string {
	if immutableDeliveryObjectKey(key) {
		return "public, max-age=31536000, immutable"
	}
	return "private, max-age=300"
}

func (s *Storage) UploadBytes(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(s.bucket),
		Key:          aws.String(key),
		Body:         bytes.NewReader(data),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String(objectUploadCacheControl(key)),
	})
	return err
}

// SignedCDNURL returns an Alibaba CDN Type A authenticated URL. Timestamp is
// the URL creation time; the CDN console validity period must match cdnAuthTTL.
// The signature is calculated locally and never sends the auth key upstream.
func (s *Storage) SignedCDNURL(key string, now time.Time) (string, time.Duration, bool) {
	if s == nil || s.cdnBaseURL == nil || s.cdnAuthKey == "" || s.cdnAuthTTL <= 0 {
		return "", 0, false
	}
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if key == "" || strings.Contains(key, "..") || strings.Contains(key, "\\") {
		return "", 0, false
	}
	result := *s.cdnBaseURL
	result.RawPath = ""
	result.Path = strings.TrimRight(result.Path, "/") + "/" + key
	timestamp := now.UTC().Unix()
	const random, uid = "0", "0"
	canonical := fmt.Sprintf("%s-%d-%s-%s-%s", result.EscapedPath(), timestamp, random, uid, s.cdnAuthKey)
	digest := md5.Sum([]byte(canonical)) // #nosec G401 -- mandated by Alibaba CDN Type A.
	authKey := fmt.Sprintf("%d-%s-%s-%s", timestamp, random, uid, hex.EncodeToString(digest[:]))
	query := result.Query()
	query.Set("auth_key", authKey)
	result.RawQuery = query.Encode()
	return result.String(), s.cdnAuthTTL, true
}

func (s *Storage) GetBytes(ctx context.Context, key string) ([]byte, error) {
	return s.GetBytesLimit(ctx, key, 32<<20)
}

// OpenObject streams an object without buffering its contents in the API
// process. The size check is enforced from the object metadata when available;
// the reader is still capped for providers that omit Content-Length.
func (s *Storage) OpenObject(ctx context.Context, key string, maxBytes int64) (io.ReadCloser, int64, string, error) {
	stream, err := s.OpenObjectRange(ctx, key, "", maxBytes)
	if err != nil {
		return nil, 0, "", err
	}
	return stream.Body, stream.ContentLength, stream.ContentType, nil
}

// ObjectStream 描述一次（可能是部分内容的）对象读取。
type ObjectStream struct {
	Body          io.ReadCloser
	ContentLength int64 // -1 表示未知
	ContentType   string
	// ContentRange 非空表示上游返回了部分内容（应答 206），格式如 bytes 0-1023/4096。
	ContentRange string
}

// OpenObjectRange 与 OpenObject 相同，但把客户端的 Range 头（如 bytes=0-1023）
// 透传给对象存储，用于视频/大文件的分段拉取。rangeSpec 为空时等价于整对象读取。
func (s *Storage) OpenObjectRange(ctx context.Context, key, rangeSpec string, maxBytes int64) (*ObjectStream, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}
	if rangeSpec != "" {
		input.Range = aws.String(rangeSpec)
	}
	out, err := s.client.GetObject(ctx, input)
	if err != nil {
		return nil, err
	}
	if out.ContentLength != nil && *out.ContentLength > maxBytes {
		_ = out.Body.Close()
		return nil, fmt.Errorf("object exceeds %d byte limit", maxBytes)
	}
	stream := &ObjectStream{
		Body: &limitedReadCloser{
			reader: io.LimitReader(out.Body, maxBytes+1),
			close:  out.Body.Close,
		},
		ContentLength: -1,
		ContentType:   aws.ToString(out.ContentType),
		ContentRange:  aws.ToString(out.ContentRange),
	}
	if out.ContentLength != nil {
		stream.ContentLength = *out.ContentLength
	}
	return stream, nil
}

func (s *Storage) GetBytesLimit(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < objectReadAttempts; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, objectReadAttemptTimeout)
		data, err := s.getBytesLimitOnce(attemptCtx, key, maxBytes)
		cancel()
		if err == nil {
			return data, nil
		}
		lastErr = err
		if ctx.Err() != nil || !transientObjectReadError(err) || attempt == objectReadAttempts-1 {
			break
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

func (s *Storage) getBytesLimitOnce(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	data, err := io.ReadAll(io.LimitReader(out.Body, maxBytes+1))
	if err == nil && int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("object exceeds %d byte limit", maxBytes)
	}
	return data, err
}

// GetBytesPrefix reads the first maxBytes of an object. Task input inspection
// only needs the image header, so this avoids pulling a full 15MB original
// through the longer full-object storage timeout.
func (s *Storage) GetBytesPrefix(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("invalid prefix size")
	}
	var lastErr error
	for attempt := 0; attempt < objectReadAttempts; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, objectPrefixReadAttemptTimeout)
		data, err := s.getBytesPrefixOnce(attemptCtx, key, maxBytes)
		cancel()
		if err == nil {
			return data, nil
		}
		lastErr = err
		if ctx.Err() != nil || !transientObjectReadError(err) || attempt == objectReadAttempts-1 {
			break
		}
		timer := time.NewTimer(time.Duration(attempt+1) * 250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

func (s *Storage) getBytesPrefixOnce(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Range:  aws.String(fmt.Sprintf("bytes=0-%d", maxBytes-1)),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(io.LimitReader(out.Body, maxBytes+1))
}

func transientObjectReadError(err error) bool {
	if err == nil || IsNotFound(err) || errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary()) {
		return true
	}
	var statusErr interface{ HTTPStatusCode() int }
	if errors.As(err, &statusErr) {
		status := statusErr.HTTPStatusCode()
		return status == 429 || status >= 500
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "tls handshake timeout") ||
		strings.Contains(message, "connection reset") ||
		strings.Contains(message, "unexpected eof")
}

func (s *Storage) ObjectSize(ctx context.Context, key string) (int64, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		return 0, err
	}
	if out.ContentLength == nil {
		return 0, fmt.Errorf("object size unavailable")
	}
	return *out.ContentLength, nil
}

type ObjectInfo struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// ListObjects returns at most limit objects under prefix. Callers use this for
// bounded maintenance scans, so it deliberately does not expose pagination
// tokens to business code.
func (s *Storage) ListObjects(ctx context.Context, prefix string, limit int) ([]ObjectInfo, error) {
	items, _, _, err := s.ListObjectsPage(ctx, prefix, "", limit)
	return items, err
}

// ListObjectsPage returns one lexicographically ordered page and the last key
// as a durable cursor. Using StartAfter instead of exposing provider tokens
// lets the worker resume after a process restart.
func (s *Storage) ListObjectsPage(ctx context.Context, prefix, startAfter string, limit int) ([]ObjectInfo, string, bool, error) {
	if limit <= 0 {
		return []ObjectInfo{}, "", true, nil
	}
	if limit > 1000 {
		limit = 1000
	}
	items := make([]ObjectInfo, 0, limit)
	// #nosec G115 -- limit is clamped to [1, 1000] above.
	pageSize := int32(limit)
	out, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(prefix),
		StartAfter: func() *string {
			if startAfter == "" {
				return nil
			}
			return aws.String(startAfter)
		}(),
		MaxKeys: &pageSize,
	})
	if err != nil {
		return nil, "", false, err
	}
	for _, object := range out.Contents {
		if object.Key == nil || *object.Key == "" {
			continue
		}
		item := ObjectInfo{Key: *object.Key}
		if object.Size != nil {
			item.Size = *object.Size
		}
		if object.LastModified != nil {
			item.LastModified = object.LastModified.UTC()
		}
		items = append(items, item)
	}
	lastKey := ""
	if len(items) > 0 {
		lastKey = items[len(items)-1].Key
	}
	truncated := out.IsTruncated != nil && *out.IsTruncated
	return items, lastKey, !truncated, nil
}

func (s *Storage) DeleteKeys(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	workerCount := objectDeleteConcurrency
	if len(keys) < workerCount {
		workerCount = len(keys)
	}
	jobs := make(chan string)
	var workers sync.WaitGroup
	var failuresMu sync.Mutex
	failures := make([]error, 0)

	workers.Add(workerCount)
	for range workerCount {
		go func() {
			defer workers.Done()
			for key := range jobs {
				_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
					Bucket: aws.String(s.bucket),
					Key:    aws.String(key),
				})
				if err == nil || IsNotFound(err) {
					continue
				}
				failuresMu.Lock()
				failures = append(failures, err)
				failuresMu.Unlock()
			}
		}()
	}

	for _, key := range keys {
		select {
		case jobs <- key:
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return ctx.Err()
		}
	}
	close(jobs)
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	return summarizeDeleteErrors(failures)
}

func summarizeDeleteErrors(failures []error) error {
	if len(failures) == 0 {
		return nil
	}
	details := make([]string, 0, min(len(failures), objectDeleteErrorDetailLimit))
	for _, err := range failures {
		detail := "request failed"
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && strings.TrimSpace(apiErr.ErrorCode()) != "" {
			detail = apiErr.ErrorCode()
		}
		var statusErr interface{ HTTPStatusCode() int }
		if errors.As(err, &statusErr) {
			detail += fmt.Sprintf(" (HTTP %d)", statusErr.HTTPStatusCode())
		}
		details = append(details, detail)
		if len(details) >= objectDeleteErrorDetailLimit {
			break
		}
	}
	return fmt.Errorf("object deletion failed for %d object(s): %s", len(failures), strings.Join(details, "; "))
}

// PresignGet 生成短期可读 URL（本地签名计算，不发网络请求）。
func (s *Storage) PresignGet(ctx context.Context, key string) (string, error) {
	req, err := s.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(s.presignExpiry))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

// PublicURL returns a CDN URL only when a CDN base URL is explicitly
// configured. Callers must use this only for objects whose authorization model
// permits public immutable delivery; private inputs continue to use PresignGet.
func (s *Storage) PublicURL(key string) (string, bool) {
	if s == nil || s.cdnBaseURL == nil || strings.TrimSpace(key) == "" {
		return "", false
	}
	result := *s.cdnBaseURL
	basePath := strings.TrimRight(result.Path, "/")
	result.RawPath = ""
	result.Path = basePath + "/" + strings.TrimLeft(key, "/")
	return result.String(), true
}
