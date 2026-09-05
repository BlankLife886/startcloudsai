package worker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/taskstream"
)

const maxMediaToolOutputBytes = 256 << 20

func taskParamObject(params map[string]any, key string) map[string]any {
	value, _ := params[key].(map[string]any)
	return value
}

func taskParamFileMap(params map[string]any, key string) map[string][]string {
	result := map[string][]string{}
	for field, raw := range taskParamObject(params, key) {
		switch values := raw.(type) {
		case []string:
			result[field] = append([]string(nil), values...)
		case []any:
			for _, item := range values {
				if value, ok := item.(string); ok && strings.TrimSpace(value) != "" {
					result[field] = append(result[field], strings.TrimSpace(value))
				}
			}
		}
	}
	return result
}

func mediaKeyMatchesField(key, field string) bool {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(key)))
	switch modelconfig.MediaInputKind(field) {
	case "image":
		return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp"
	case "video":
		return ext == ".mp4" || ext == ".webm"
	case "audio":
		return ext == ".mp3" || ext == ".wav" || ext == ".m4a" || ext == ".ogg"
	case "media":
		return ext != ""
	default:
		return false
	}
}

func (w *Worker) createCRUNMediaToolTask(ctx context.Context, task *store.Task, client *crun.Client, model modelconfig.Model) (string, error) {
	existing := taskParamStrings(task.Params, "_crunTaskIds")
	if len(existing) > 0 && strings.TrimSpace(existing[0]) != "" {
		return strings.TrimSpace(existing[0]), nil
	}
	allowed := map[string]bool{}
	for _, field := range model.UpstreamInputFields {
		allowed[field] = true
	}
	input := map[string]any{}
	for field, value := range taskParamObject(task.Params, "toolInput") {
		if allowed[field] && !modelconfig.IsMediaInputField(field) {
			input[field] = value
		}
	}
	for field, keys := range taskParamFileMap(task.Params, "toolFiles") {
		if !allowed[field] || !modelconfig.IsMediaInputField(field) {
			return "", fmt.Errorf("media tool file field %s is not allowed by schema", field)
		}
		urls := make([]string, 0, len(keys))
		for _, key := range keys {
			if !mediaKeyMatchesField(key, field) {
				return "", fmt.Errorf("media tool file type does not match field %s", field)
			}
			presigned, err := w.Storage.PresignGet(ctx, key)
			if err != nil {
				return "", err
			}
			urls = append(urls, presigned)
		}
		property, _ := modelconfig.ToolInputProperties(model)[field].(map[string]any)
		if property["type"] == "array" || len(urls) != 1 || strings.HasSuffix(field, "s") {
			input[field] = urls
		} else {
			input[field] = urls[0]
		}
	}
	estimate, err := client.EstimateMediaTask(ctx, crun.MediaTaskRequest{Model: model.UpstreamModel, Input: input})
	if err != nil {
		return "", fmt.Errorf("CRUN task estimate failed: %w", err)
	}
	if !estimate.Affordable {
		return "", errors.New("CRUN account balance is insufficient for this task")
	}
	created, err := client.CreateMediaTask(ctx, crun.MediaTaskRequest{Model: model.UpstreamModel, Input: input})
	if err != nil {
		return "", err
	}
	taskID := strings.TrimSpace(created.TaskID)
	if err := store.SetTaskCRUNTaskIDsOwned(ctx, w.St.Pool, task.ID, []string{taskID}, taskLeaseOwner(task)); err != nil {
		return "", err
	}
	if task.Params == nil {
		task.Params = map[string]any{}
	}
	task.Params["_crunTaskIds"] = []string{taskID}
	return taskID, nil
}

func mediaSignature(data []byte) (string, string) {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "png", "image/png"
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "jpg", "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "webp", "image/webp"
	case len(data) >= 12 && string(data[4:8]) == "ftyp" && string(data[8:12]) == "M4A ":
		return "m4a", "audio/mp4"
	case len(data) >= 12 && string(data[4:8]) == "ftyp":
		return "mp4", "video/mp4"
	case len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3:
		return "webm", "video/webm"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE":
		return "wav", "audio/wav"
	case len(data) >= 3 && string(data[:3]) == "ID3":
		return "mp3", "audio/mpeg"
	case len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0:
		return "mp3", "audio/mpeg"
	case len(data) >= 4 && string(data[:4]) == "OggS":
		return "ogg", "audio/ogg"
	default:
		return "", ""
	}
}

func mediaTypeFromResponse(source, header string, data []byte) (string, string) {
	if ext, contentType := mediaSignature(data); ext != "" {
		return ext, contentType
	}
	contentType, _, _ := mime.ParseMediaType(header)
	ext := ""
	if parsed, err := url.Parse(source); err == nil {
		ext = strings.ToLower(filepath.Ext(parsed.Path))
	}
	byExt := map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
		".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
		".m4a": "audio/mp4", ".ogg": "audio/ogg",
	}
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = byExt[ext]
	}
	if ext == "" {
		for candidate, candidateType := range byExt {
			if candidateType == contentType {
				ext = candidate
				break
			}
		}
	}
	if contentType == "" || ext == "" {
		return "", ""
	}
	return strings.TrimPrefix(ext, "."), contentType
}

func downloadMediaToolOutput(ctx context.Context, source string) ([]byte, string, string, error) {
	if err := netguard.ValidateURL(source, false, false); err != nil {
		return nil, "", "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, "", "", err
	}
	resp, err := netguard.NewHTTPClient(5*time.Minute, false, false).Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("download media tool output: status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxMediaToolOutputBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxMediaToolOutputBytes {
		return nil, "", "", errors.New("media tool output is unavailable or too large")
	}
	ext, contentType := mediaTypeFromResponse(source, resp.Header.Get("Content-Type"), data)
	if ext == "" {
		return nil, "", "", errors.New("media tool returned an unsupported output type")
	}
	return data, contentType, ext, nil
}

func (w *Worker) completePolledMediaTool(ctx context.Context, task *store.Task, urls []string, claimID string) error {
	defer w.releaseUpstreamAttemptPoll(ctx, task)
	keys := make([]string, 0, len(urls))
	thumbnailKeys := make([]string, 0, len(urls))
	uploadedKeys := make([]string, 0, len(urls)*3)
	cleanupFailedCompletion := func(releaseClaim bool) {
		if len(uploadedKeys) > 0 {
			_ = w.Storage.DeleteKeys(context.Background(), uploadedKeys)
		}
		if releaseClaim {
			_, _ = store.ReleaseTaskCompletionClaim(ctx, w.St.Pool, task.ID, claimID)
		}
	}
	for index, source := range urls {
		data, contentType, ext, err := downloadMediaToolOutput(ctx, source)
		if err != nil {
			cleanupFailedCompletion(true)
			return err
		}
		objectIndex := fmt.Sprintf("%d-%s", index+1, claimID)
		key := fmt.Sprintf("tasks/%s/%s/original/%s.%s", task.UserID, task.ID, objectIndex, ext)
		if strings.HasPrefix(contentType, "image/") {
			memoryWeight := min(max(int64(len(data))*6, 1<<20), w.imageMemoryBytes)
			releaseMemory := func() {}
			if w.imageMemory != nil && memoryWeight > 0 {
				if err := w.imageMemory.Acquire(ctx, memoryWeight); err != nil {
					cleanupFailedCompletion(true)
					return err
				}
				releaseMemory = func() { w.imageMemory.Release(memoryWeight) }
			}
			if detectedExt, _ := media.Detect(data); detectedExt == "" {
				releaseMemory()
				cleanupFailedCompletion(true)
				return errors.New("media tool returned unreadable image data")
			}
			thumbnailKey := fmt.Sprintf("tasks/%s/%s/thumb/%s", task.UserID, task.ID, objectIndex)
			uploaded, uploadErr := w.uploadImageOutputVariants(ctx, task.ID.String(), key, thumbnailKey, data, contentType)
			releaseMemory()
			uploadedKeys = append(uploadedKeys, uploaded...)
			if uploadErr != nil {
				cleanupFailedCompletion(true)
				return uploadErr
			}
			thumbnailKeys = append(thumbnailKeys, thumbnailKey)
		} else {
			if err := w.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
				cleanupFailedCompletion(true)
				return err
			}
			uploadedKeys = append(uploadedKeys, key)
		}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return errors.New("CRUN media tool completed without output")
	}
	var succeeded *store.Task
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		dbTask, err := store.GetTask(ctx, tx, task.ID)
		if err != nil || dbTask == nil {
			return err
		}
		won, err := taskflow.MarkSucceededClaimed(ctx, tx, dbTask, keys, thumbnailKeys, time.Now().UTC(), claimID)
		if err != nil || !won {
			return err
		}
		attemptID := upstreamAttemptID(task)
		if attemptID != uuid.Nil {
			finishedAt := time.Now().UTC()
			if _, err := store.FinishTaskUpstreamAttempt(ctx, tx, attemptID, store.UpstreamAttemptSucceeded, "", finishedAt); err != nil {
				return err
			}
			if err := store.SupersedeOtherTaskUpstreamAttempts(ctx, tx, task.ID, attemptID, finishedAt); err != nil {
				return err
			}
		}
		succeeded = dbTask
		return nil
	})
	if err != nil || succeeded == nil {
		cleanupFailedCompletion(false)
		return err
	}
	taskflow.NotifyTaskSucceeded(ctx, w.St.Pool, succeeded, len(keys))
	w.publishTaskEvent(ctx, succeeded, taskstream.Event{Stage: "complete", Status: "succeeded", ImageCount: len(keys), Done: true})
	return nil
}
