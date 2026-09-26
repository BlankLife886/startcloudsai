package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	externalCoverCacheDefaultLimit = 10
	externalCoverCacheMaxLimit     = 25
	externalCoverCacheConcurrency  = 2
)

func normalizedExternalCoverCacheLimit(value int) int {
	if value <= 0 {
		return externalCoverCacheDefaultLimit
	}
	if value > externalCoverCacheMaxLimit {
		return externalCoverCacheMaxLimit
	}
	return value
}

func (s *Server) cacheExternalPromptCover(ctx context.Context, item store.ExternalPromptCoverCandidate) error {
	if !validPromptSourceURL(item.CoverURL) {
		return errors.New("invalid external cover URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, item.CoverURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*")
	resp, err := s.PromptSync.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("external cover returned HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > promptCoverMaxBytes {
		return errors.New("external cover exceeds size limit")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, promptCoverMaxBytes+1))
	if err != nil {
		return err
	}
	if len(data) == 0 || int64(len(data)) > promptCoverMaxBytes {
		return errors.New("external cover is empty or exceeds size limit")
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		return errors.New("external cover is not a supported image")
	}
	data, ext, contentType = s.compressCoverImage(ctx, data, ext, contentType)
	width, height, err := media.Dimensions(data)
	if err != nil {
		return errors.New("external cover cannot be decoded")
	}
	key := fmt.Sprintf("prompt-covers/%s/%s.%s", item.ID, uuid.NewString(), ext)
	if err := s.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
		return err
	}
	if err := store.UpdatePromptCover(ctx, s.St.Pool, item.ID, key, width, height); err != nil {
		_ = s.Storage.DeleteKeys(ctx, []string{key})
		return err
	}
	return nil
}

func (s *Server) adminCacheExternalPromptCovers(c *gin.Context, _ *store.User) {
	var body struct {
		Limit int `json:"limit"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, apperr.E("validation_error", "请求参数无效", http.StatusUnprocessableEntity))
		return
	}
	limit := normalizedExternalCoverCacheLimit(body.Limit)
	items, err := store.ListExternalPromptCoverCandidates(c.Request.Context(), s.St.Pool, limit)
	if err != nil {
		fail(c, err)
		return
	}

	jobs := make(chan store.ExternalPromptCoverCandidate)
	type cacheResult struct {
		id  uuid.UUID
		err error
	}
	results := make(chan cacheResult, len(items))
	var workers sync.WaitGroup
	workerCount := min(externalCoverCacheConcurrency, len(items))
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for item := range jobs {
				results <- cacheResult{id: item.ID, err: s.cacheExternalPromptCover(c.Request.Context(), item)}
			}
		}()
	}
	for _, item := range items {
		jobs <- item
	}
	close(jobs)
	workers.Wait()
	close(results)

	succeeded := 0
	failed := 0
	for result := range results {
		if result.err != nil {
			failed++
			// HTTP client errors can contain the full source URL (including query
			// credentials), so logs identify the record without printing the URL.
			log.Printf("cache external prompt cover %s failed", result.id)
			continue
		}
		succeeded++
	}
	remaining, err := store.CountExternalPromptCovers(c.Request.Context(), s.St.Pool)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{
		"processed": len(items),
		"succeeded": succeeded,
		"failed":    failed,
		"remaining": remaining,
	})
}
