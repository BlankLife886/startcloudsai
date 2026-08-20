// Package storage 封装 R2（S3 兼容）：上传 / 删除 / 下载 / presigned GET。
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"

	appconfig "github.com/BlankLife886/startcloudsai/server/internal/config"
)

const (
	objectReadAttempts       = 3
	objectReadAttemptTimeout = 7 * time.Second
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
		"R2_ENDPOINT":          cfg.R2Endpoint,
		"R2_ACCESS_KEY_ID":     cfg.R2AccessKeyID,
		"R2_SECRET_ACCESS_KEY": cfg.R2SecretAccessKey,
		"R2_BUCKET":            cfg.R2Bucket,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("对象存储配置不完整，缺少 %s", strings.Join(missing, "、"))
	}
	return nil
}

func New(cfg *appconfig.Config) (*Storage, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion("auto"),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, "")),
		awsconfig.WithRetryMaxAttempts(2),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.R2Endpoint)
		o.UsePathStyle = true
	})
	return &Storage{
		client:        client,
		presigner:     s3.NewPresignClient(client),
		bucket:        cfg.R2Bucket,
		presignExpiry: time.Duration(cfg.R2PresignExpireSecs) * time.Second,
	}, nil
}

func (s *Storage) UploadBytes(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	return err
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
// through a 7s storage timeout.
func (s *Storage) GetBytesPrefix(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("invalid prefix size")
	}
	var lastErr error
	for attempt := 0; attempt < objectReadAttempts; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, objectReadAttemptTimeout)
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
	for i := 0; i < len(keys); i += 1000 {
		end := i + 1000
		if end > len(keys) {
			end = len(keys)
		}
		objects := make([]types.ObjectIdentifier, 0, end-i)
		for _, k := range keys[i:end] {
			objects = append(objects, types.ObjectIdentifier{Key: aws.String(k)})
		}
		out, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.bucket),
			Delete: &types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return err
		}
		if err := summarizeDeleteObjectErrors(out.Errors); err != nil {
			return err
		}
	}
	return nil
}

func summarizeDeleteObjectErrors(items []types.Error) error {
	if len(items) == 0 {
		return nil
	}
	failures := make([]string, 0, len(items))
	for _, item := range items {
		code := strings.TrimSpace(aws.ToString(item.Code))
		if strings.EqualFold(code, "NoSuchKey") || strings.EqualFold(code, "NotFound") {
			continue
		}
		key := strings.TrimSpace(aws.ToString(item.Key))
		message := strings.TrimSpace(aws.ToString(item.Message))
		entry := code
		if entry == "" {
			entry = "unknown error"
		}
		if key != "" {
			entry += " for " + key
		}
		if message != "" {
			entry += ": " + message
		}
		failures = append(failures, entry)
		if len(failures) >= 8 {
			break
		}
	}
	if len(failures) == 0 {
		return nil
	}
	return fmt.Errorf("object deletion failed: %s", strings.Join(failures, "; "))
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
