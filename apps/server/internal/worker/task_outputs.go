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
	w              *Worker
	ctx            context.Context
	task           *store.Task
	mu             sync.Mutex
	outputSlots    []string
	thumbnailSlots []string
	newKeys        []string
	newIndexes     map[int]struct{}
}

func newTaskOutputCollector(w *Worker, ctx context.Context, task *store.Task) *taskOutputCollector {
	size := task.Count
	if size < len(task.OutputKeys) {
		size = len(task.OutputKeys)
	}
	if size < 1 {
		size = 1
	}
	collector := &taskOutputCollector{
		w: w, ctx: ctx, task: task,
		outputSlots: make([]string, size), thumbnailSlots: make([]string, size),
		newIndexes: make(map[int]struct{}),
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
		return fmt.Errorf("output index %d is out of range", index)
	}
	c.mu.Lock()
	if c.outputSlots[index] != "" && c.thumbnailSlots[index] != "" {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	startedAt := time.Now()
	processed := c.w.applyMaskEditComposite(c.ctx, c.task, []string{encoded})
	if len(processed) == 1 {
		encoded = processed[0]
	}
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

	key := fmt.Sprintf("tasks/%s/%s/original/%d.%s", c.task.UserID, c.task.ID, index, ext)
	thumbKey := fmt.Sprintf("tasks/%s/%s/thumb/%d.jpg", c.task.UserID, c.task.ID, index)
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
			_ = c.w.Storage.DeleteKeys(c.ctx, uploaded)
		}
		return uploadErr
	}

	c.mu.Lock()
	c.outputSlots[index] = key
	c.thumbnailSlots[index] = thumbKey
	outputKeys := compactTaskKeys(c.outputSlots)
	thumbnailKeys := compactTaskKeys(c.thumbnailSlots)
	if err := store.SetTaskPartialOutputs(c.ctx, c.w.St.Pool, c.task.ID, outputKeys, thumbnailKeys); err != nil {
		c.outputSlots[index] = ""
		c.thumbnailSlots[index] = ""
		c.mu.Unlock()
		_ = c.w.Storage.DeleteKeys(c.ctx, uploaded)
		return err
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
	_ = store.SetTaskPartialOutputs(c.ctx, c.w.St.Pool, c.task.ID, outputKeys, thumbnailKeys)
	if len(keys) > 0 {
		_ = c.w.Storage.DeleteKeys(c.ctx, keys)
	}
}

func logTaskStage(taskID, stage string, startedAt time.Time, format string, args ...any) {
	detail := ""
	if format != "" {
		detail = " " + fmt.Sprintf(format, args...)
	}
	log.Printf("task %s stage=%s duration_ms=%d%s", taskID, stage, time.Since(startedAt).Milliseconds(), detail)
}
