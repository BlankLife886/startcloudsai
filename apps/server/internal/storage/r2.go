// Package storage 封装 R2（S3 兼容）：上传 / 删除 / 下载 / presigned GET。
package storage

import (
	"bytes"
	"context"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	appconfig "github.com/BlankLife886/startcloudsai/server/internal/config"
)

type Storage struct {
	client        *s3.Client
	presigner     *s3.PresignClient
	bucket        string
	presignExpiry time.Duration
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
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
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
		_, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.bucket),
			Delete: &types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return err
		}
	}
	return nil
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
