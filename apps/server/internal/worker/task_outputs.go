package worker

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

type taskOutputCollector struct {
	w                 *Worker
	ctx               context.Context
	task              *store.Task
	mu                sync.Mutex
	outputSlots       []string
	thumbnailSlots    []string
	newKeys           []string
	newIndexes        map[int]struct{}
	completionClaimID string
	leaseOwner        string
}

type taskOutputProcessingError struct {
	stage string
	err   error
}

func (e *taskOutputProcessingError) Error() string {
	return fmt.Sprintf("task output %s: %v", e.stage, e.err)
}

func (e *taskOutputProcessingError) Unwrap() error { return e.err }

func newClaimedTaskOutputCollector(w *Worker, ctx context.Context, task *store.Task, claimID string) *taskOutputCollector {
	collector := newTaskOutputCollector(w, ctx, task)
	collector.completionClaimID = claimID
	return collector
}

func newTaskOutputCollector(w *Worker, ctx context.Context, task *store.Task) *taskOutputCollector {
	size := task.Count
	if size < len(task.OutputKeys) {
		size = len(task.OutputKeys)
	}
	if size < 1 {
		size = 1
	}
	leaseOwner := ""
	if task.LeaseOwner != nil {
		leaseOwner = *task.LeaseOwner
	}
	collector := &taskOutputCollector{
		w: w, ctx: ctx, task: task,
		outputSlots: make([]string, size), thumbnailSlots: make([]string, size),
		newIndexes: make(map[int]struct{}), leaseOwner: leaseOwner,
	}
	copy(collector.outputSlots, task.OutputKeys)
	copy(collector.thumbnailSlots, task.ThumbnailKeys)
	return collector
}

func compactTaskKeys(slots []string) []string {
	keys := make([]string, 0, len(slots))
	for _, key := range slots {
		if key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}

func (c *taskOutputCollector) persist(index int, encoded string) error {
	if index < 0 || index >= len(c.outputSlots) {
		log.Printf("task %s ignored unexpected upstream output index=%d expected=%d", c.task.ID, index, len(c.outputSlots))
		return nil
	}
	c.mu.Lock()
	if c.outputSlots[index] != "" && c.thumbnailSlots[index] != "" {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	startedAt := time.Now()
	processed, err := c.w.applyMaskEditComposite(c.ctx, c.task, []string{encoded})
	if err != nil {
		return &taskOutputProcessingError{stage: "mask composite", err: err}
	}
	if len(processed) == 1 {
		encoded = processed[0]
	}
	processed, err = c.w.applyPreservedSourceCanvas(c.ctx, c.task, []string{encoded})
	if err != nil {
		return &taskOutputProcessingError{stage: "source canvas restore", err: err}
	}
	if len(processed) == 1 {
		encoded = processed[0]
	}
	decodedBytes := base64.StdEncoding.DecodedLen(len(encoded))
	if decodedBytes <= 0 || decodedBytes > 20<<20 {
		return fmt.Errorf("output image exceeds 20 MiB limit")
	}
	width, height, err := media.Base64Dimensions(encoded)
	if err != nil {
		return err
	}
	// Decode + source image + RGBA destination dominate memory. Weight by pixels
	// and compressed buffers, then clamp so a valid large image can make progress.
	memoryWeight := int64(width)*int64(height)*8 + int64(decodedBytes)*2
	memoryWeight = min(max(memoryWeight, 1<<20), c.w.imageMemoryBytes)
	if err := c.w.imageMemory.Acquire(c.ctx, memoryWeight); err != nil {
		return err
	}
	defer c.w.imageMemory.Release(memoryWeight)
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > 20<<20 {
		return fmt.Errorf("output image exceeds 20 MiB limit")
	}
	ext, contentType := media.Detect(data)
	if ext == "" {
		return fmt.Errorf("upstream returned unsupported image data")
	}
	thumb, err := media.ThumbnailJPEG(data, 512)
	if err != nil {
		return err
	}

	objectIndex := fmt.Sprintf("%d", index)
	if c.completionClaimID != "" {
		// Claimed async completions use attempt-unique keys. A stale lease holder
		// can then clean up only its own objects, never the winning result.
		objectIndex += "-" + c.completionClaimID
	} else if c.leaseOwner != "" {
		// Sync workers also use attempt-unique keys. Lease fencing protects the
		// database row; unique keys additionally stop stale uploads from replacing
		// the winning object's bytes in storage.
		token := c.leaseOwner
		if len(token) > 36 {
			token = token[len(token)-36:]
		}
		objectIndex += "-" + token
	}
	key := fmt.Sprintf("tasks/%s/%s/original/%s.%s", c.task.UserID, c.task.ID, objectIndex, ext)
	thumbKey := fmt.Sprintf("tasks/%s/%s/thumb/%s.jpg", c.task.UserID, c.task.ID, objectIndex)
	type uploadResult struct {
		key string
		err error
	}
	results := make(chan uploadResult, 2)
	go func() {
		results <- uploadResult{key: key, err: c.w.Storage.UploadBytes(c.ctx, key, data, contentType)}
	}()
	go func() {
		results <- uploadResult{key: thumbKey, err: c.w.Storage.UploadBytes(c.ctx, thumbKey, thumb, "image/jpeg")}
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
			c.deleteUploadedKeys(uploaded)
		}
		return uploadErr
	}

	c.mu.Lock()
	c.outputSlots[index] = key
	c.thumbnailSlots[index] = thumbKey
	outputKeys := compactTaskKeys(c.outputSlots)
	thumbnailKeys := compactTaskKeys(c.thumbnailSlots)
	var persistErr error
	if c.completionClaimID == "" {
		if c.leaseOwner == "" {
			persistErr = store.SetTaskPartialOutputs(c.ctx, c.w.St.Pool, c.task.ID, outputKeys, thumbnailKeys)
		} else {
			persistErr = store.SetTaskPartialOutputsOwned(c.ctx, c.w.St.Pool, c.task.ID, outputKeys, thumbnailKeys, c.leaseOwner)
		}
	} else {
		persistErr = store.SetTaskPartialOutputsClaimed(c.ctx, c.w.St.Pool, c.task.ID, outputKeys, thumbnailKeys, c.completionClaimID)
	}
	if persistErr != nil {
		c.outputSlots[index] = ""
		c.thumbnailSlots[index] = ""
		c.mu.Unlock()
		c.deleteUploadedKeys(uploaded)
		return persistErr
	}
	c.newKeys = append(c.newKeys, uploaded...)
	c.newIndexes[index] = struct{}{}
	count := len(outputKeys)
	c.mu.Unlock()

	c.w.publishTaskEvent(c.ctx, c.task, taskstream.Event{
		Stage: "image-ready", Status: "running", ImageIndex: index, ImageCount: count,
	})
	logTaskStage(c.task.ID.String(), "image_persist", startedAt, "index=%d image_count=%d", index, count)
	return nil
}

func (c *taskOutputCollector) completed() (outputKeys, thumbnailKeys []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return compactTaskKeys(c.outputSlots), compactTaskKeys(c.thumbnailSlots)
}

func (c *taskOutputCollector) cleanup() {
	c.mu.Lock()
	keys := append([]string(nil), c.newKeys...)
	for index := range c.newIndexes {
		c.outputSlots[index] = ""
		c.thumbnailSlots[index] = ""
	}
	outputKeys := compactTaskKeys(c.outputSlots)
	thumbnailKeys := compactTaskKeys(c.thumbnailSlots)
	c.mu.Unlock()
	if c.w == nil || c.w.St == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.ClearTaskPartialOutputsAndEnqueueCleanup(cleanupCtx, c.w.St, c.task.ID,
		outputKeys, thumbnailKeys, keys, c.completionClaimID, c.leaseOwner); err != nil {
		log.Printf("task %s partial output cleanup transaction failed: %v", c.task.ID, err)
	}
}

func (c *taskOutputCollector) enqueueCleanup(keys []string) {
	if len(keys) == 0 || c.w == nil || c.w.St == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.EnqueueObjectCleanup(cleanupCtx, c.w.St.Pool, keys); err != nil {
		log.Printf("task %s object cleanup enqueue failed: %v", c.task.ID, err)
	}
}

func (c *taskOutputCollector) deleteUploadedKeys(keys []string) {
	if len(keys) == 0 {
		return
	}
	c.enqueueCleanup(keys)
	if c.w == nil || c.w.Storage == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := c.w.Storage.DeleteKeys(cleanupCtx, keys); err != nil {
		log.Printf("task %s uploaded object cleanup failed: %v", c.task.ID, err)
		return
	}
	if c.w.St != nil {
		if _, err := store.DeleteObjectCleanupJobs(cleanupCtx, c.w.St.Pool, keys); err != nil {
			log.Printf("task %s object cleanup job removal failed: %v", c.task.ID, err)
		}
	}
}

func logTaskStage(taskID, stage string, startedAt time.Time, format string, args ...any) {
	detail := ""
	if format != "" {
		detail = " " + fmt.Sprintf(format, args...)
	}
	log.Printf("task %s stage=%s duration_ms=%d%s", taskID, stage, time.Since(startedAt).Milliseconds(), detail)
}
