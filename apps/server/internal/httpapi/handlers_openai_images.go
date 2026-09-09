package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

const (
	openAIImageWaitTimeout      = 240 * time.Second
	openAIImagePollInterval     = time.Second
	openAIImageOutputBytes      = 32 << 20
	openAIImageTotalOutputBytes = 64 << 20
	openAIImageFingerprintParam = "_openAIImageFingerprint"
)

type openAIModelObject struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

func openAIImageModels(cfg modelconfig.Config, key *store.UserAPIKey) []modelconfig.Model {
	models := make([]modelconfig.Model, 0)
	for _, selected := range modelconfig.PublicModelsForWorkspace(cfg, modelconfig.WorkspaceT2I, modelconfig.ModelKindImage) {
		model := selected.Model
		if !model.Available() {
			continue
		}
		if key != nil && len(key.AllowedModelIDs) > 0 && !store.Contains(key.AllowedModelIDs, model.ID) {
			continue
		}
		models = append(models, model)
	}
	return models
}

func asOpenAIModel(model modelconfig.Model) openAIModelObject {
	// This catalog has no model-created timestamp; zero explicitly denotes unknown.
	return openAIModelObject{ID: model.ID, Object: "model", Created: 0, OwnedBy: "starcloudsai"}
}

func (s *Server) openAIModels(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	items := make([]openAIModelObject, 0)
	for _, model := range openAIImageModels(cfg, openAPIKeyFromContext(c)) {
		items = append(items, asOpenAIModel(model))
	}
	c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
}

func (s *Server) openAIModel(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	for _, model := range openAIImageModels(cfg, openAPIKeyFromContext(c)) {
		if model.ID == c.Param("model") {
			c.JSON(http.StatusOK, asOpenAIModel(model))
			return
		}
	}
	failOpenAI(c, apperr.E("model_not_found", "The requested image model does not exist or is not available to this API Key.", http.StatusNotFound), "model")
}

func failOpenAIImage(c *gin.Context, err error) {
	var parameter *openAIParameterError
	if errors.As(err, &parameter) {
		failOpenAI(c, apperr.E(parameter.Code, parameter.Message, http.StatusBadRequest), parameter.Param)
		return
	}
	failOpenAI(c, err, "")
}

func (s *Server) openAIGenerateImage(c *gin.Context) { s.openAIImage(c, false) }
func (s *Server) openAIEditImage(c *gin.Context)     { s.openAIImage(c, true) }

func (s *Server) openAIImage(c *gin.Context, editing bool) {
	c.Header("Cache-Control", "no-store")
	user, err := s.requireUser(c)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	key := openAPIKeyFromContext(c)
	if key == nil {
		failOpenAI(c, apperr.E("api_key_required", "An API Key is required.", 401), "")
		return
	}
	if editing && !apiKeyHasScope(key, "files:write") {
		failOpenAI(c, apperr.E("api_key_scope_denied", "Image editing requires files:write permission.", 403), "")
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}
	originalRequest := c.Request
	ctx, cancel := context.WithTimeout(originalRequest.Context(), openAIImageWaitTimeout)
	c.Request = originalRequest.WithContext(ctx)
	// The outer API middleware still needs its live context to account for response bytes.
	defer func() { c.Request = originalRequest; cancel() }()
	defer func() {
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
	}()
	var request openAIImageRequest
	var files []*multipart.FileHeader
	if editing {
		request, files, err = decodeOpenAIImageMultipart(c.Request, s.Cfg.UploadMaxBytes)
	} else {
		request, err = decodeOpenAIImageJSON(c.Request)
	}
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	clientIdempotency := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if len(clientIdempotency) > 128 {
		failOpenAIImage(c, imageParameterError("Idempotency-Key", "Idempotency-Key must not exceed 128 bytes."))
		return
	}
	if clientIdempotency == "" {
		clientIdempotency = uuid.NewString()
	}
	c.Header("Idempotency-Key", clientIdempotency)
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	var selected *modelconfig.Model
	for _, model := range openAIImageModels(cfg, key) {
		if model.ID == request.Model {
			selected = &model
			break
		}
	}
	if selected == nil {
		failOpenAI(c, apperr.E("model_not_found", "The requested image model does not exist or is not available to this API Key.", 404), "model")
		return
	}
	params, err := openAIImageParams(request, *selected, len(files))
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	uploads := make([]*storedUserUpload, 0, len(files))
	cleanup := func() {
		if len(uploads) == 0 {
			return
		}
		if err := s.cleanupUnreferencedUploadedFiles(ctx, user.ID, uploads); err != nil {
			log.Printf("OpenAI image event=input_cleanup_deferred request_id=%s task_id=%s", c.GetString(ctxRequestIDKey), c.Writer.Header().Get("X-Task-ID"))
		}
		uploads = nil
	}
	defer cleanup()
	inputKeys := make([]string, 0, len(files))
	imageHashes := make([]string, 0, len(files))
	for _, file := range files {
		uploaded, uploadErr := s.storeOpenAIInputImage(c, user, file)
		if uploadErr != nil {
			failOpenAI(c, uploadErr, "image")
			return
		}
		uploads = append(uploads, uploaded)
		inputKeys = append(inputKeys, uploaded.Key)
		imageHashes = append(imageHashes, uploaded.SHA256)
	}
	fingerprint := openAIImageFingerprint(request, editing, imageHashes)
	input := openAIImageTaskInput(request, params, inputKeys, key.ID, clientIdempotency, fingerprint)
	task, created, err := s.createOpenAIImageTask(ctx, user.ID, input, key.ID, fingerprint)
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	c.Header("X-Task-ID", task.ID.String())
	if !created {
		cleanup()
	} else {
		uploads = nil
	} // The committed task now owns the input references.
	if task.DeletedAt != nil {
		failOpenAI(c, apperr.E("image_result_expired", "The task result has been deleted.", 410), "")
		return
	}
	if created || task.Status == "queued" {
		if s.Queue != nil {
			if err := s.Queue.EnqueueRunTask(ctx, task.ID.String()); err != nil {
				log.Printf("OpenAI image event=task_enqueue_deferred request_id=%s task_id=%s", c.GetString(ctxRequestIDKey), task.ID)
			}
		} else {
			log.Printf("OpenAI image event=task_queue_unavailable request_id=%s task_id=%s", c.GetString(ctxRequestIDKey), task.ID)
		}
	}
	task, err = waitOpenAIImageTask(ctx, task, openAIImagePollInterval, func(ctx context.Context) (*store.Task, error) {
		return store.GetUserTask(ctx, s.St.Pool, user.ID, task.ID)
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			c.Header("Retry-After", "2")
			err = apperr.E("image_generation_timeout", "Image generation is still running. Retry with the same Idempotency-Key.", 504)
		}
		failOpenAI(c, err, "")
		return
	}
	lease, err := s.beginFileEgress(c, user)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	defer lease.release()
	result, err := openAIImageResult(ctx, task, request.ResponseFormat, s.readOpenAIImageBytes, s.Storage.PresignGet)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	var encodedBytes int64
	for _, image := range result.Data {
		encodedBytes += int64(len(image.B64JSON))
	}
	if err := s.chargeFileEgress(c, user, encodedBytes); err != nil {
		failOpenAI(c, err, "")
		return
	}
	c.JSON(http.StatusOK, result)
}

func openAIImageFingerprint(request openAIImageRequest, editing bool, images []string) string {
	request.ResponseFormat = "" // Re-delivery in another format must not create another paid task.
	raw, _ := json.Marshal(struct {
		Request openAIImageRequest `json:"request"`
		Editing bool               `json:"editing"`
		Images  []string           `json:"images"`
	}{request, editing, images})
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func openAIImageTaskInput(request openAIImageRequest, params map[string]any, inputKeys []string, keyID uuid.UUID, clientIdempotency, fingerprint string) taskflow.CreateInput {
	hash := sha256.Sum256([]byte(keyID.String() + "\x00" + clientIdempotency))
	idempotency := "openai-img:" + hex.EncodeToString(hash[:])
	return taskflow.CreateInput{
		Type: "t2i", Prompt: request.Prompt, Params: params, InputKeys: inputKeys, Count: request.N,
		IdempotencyKey: &idempotency,
		TrustedParams:  map[string]any{"_apiKeyId": keyID.String(), openAIImageFingerprintParam: fingerprint},
	}
}

func checkOpenAIImageReplay(task *store.Task, keyID uuid.UUID, fingerprint string) error {
	if task == nil || task.Params["_apiKeyId"] != keyID.String() || task.Params[openAIImageFingerprintParam] != fingerprint {
		return apperr.E("idempotency_key_conflict", "This Idempotency-Key has already been used with different image parameters or files.", 409)
	}
	return nil
}

func (s *Server) createOpenAIImageTask(ctx context.Context, userID uuid.UUID, input taskflow.CreateInput, keyID uuid.UUID, fingerprint string) (*store.Task, bool, error) {
	task, created, err := taskflow.CreateTaskWithCommitHook(ctx, s.St, userID, input, func(_ context.Context, _ pgx.Tx, task *store.Task, _ bool) error {
		return checkOpenAIImageReplay(task, keyID, fingerprint)
	})
	if err != nil {
		return nil, false, err
	}
	// Also check the core's unique-constraint race recovery, which returns outside the hook.
	if err := checkOpenAIImageReplay(task, keyID, fingerprint); err != nil {
		return nil, false, err
	}
	return task, created, nil
}

func waitOpenAIImageTask(ctx context.Context, initial *store.Task, interval time.Duration, read func(context.Context) (*store.Task, error)) (*store.Task, error) {
	task := initial
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if task == nil || task.DeletedAt != nil {
			return nil, apperr.E("image_result_expired", "The image task is no longer available.", 410)
		}
		switch task.Status {
		case "succeeded":
			return task, nil
		case "failed":
			return nil, apperr.E("image_generation_failed", "Image generation failed. Inspect the task identified by X-Task-ID for details.", 502)
		case "canceled":
			return nil, apperr.E("image_generation_canceled", "Image generation was canceled.", 409)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
		var err error
		task, err = read(ctx)
		if err != nil {
			return nil, err
		}
	}
}

type openAIImageData struct {
	B64JSON string `json:"b64_json,omitempty"`
	URL     string `json:"url,omitempty"`
}
type openAIImageResponse struct {
	Created int64             `json:"created"`
	Data    []openAIImageData `json:"data"`
}

func openAIImageResult(ctx context.Context, task *store.Task, format string, read func(context.Context, string, int64) ([]byte, error), presign func(context.Context, string) (string, error)) (*openAIImageResponse, error) {
	if task.Status != "succeeded" || len(task.OutputKeys) == 0 || len(task.OutputKeys) > 10 {
		return nil, apperr.E("image_result_unavailable", "The task has no deliverable images.", 502)
	}
	response := &openAIImageResponse{Created: task.CreatedAt.Unix(), Data: make([]openAIImageData, 0, len(task.OutputKeys))}
	var total int64
	for _, key := range task.OutputKeys {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		prefix := "tasks/" + task.UserID.String() + "/" + task.ID.String() + "/"
		if !strings.HasPrefix(key, prefix) || path.Clean(key) != key {
			return nil, apperr.E("image_result_unavailable", "The image result could not be read.", 502)
		}
		item := openAIImageData{}
		if format == "url" {
			address, err := presign(ctx, key)
			if err != nil {
				return nil, err
			}
			parsed, err := url.Parse(address)
			if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
				return nil, fmt.Errorf("invalid signed image URL")
			}
			item.URL = address
		} else {
			data, err := read(ctx, key, openAIImageOutputBytes)
			if err != nil {
				return nil, err
			}
			total += int64(len(data))
			if len(data) == 0 || int64(len(data)) > openAIImageOutputBytes || total > openAIImageTotalOutputBytes {
				return nil, apperr.E("image_response_too_large", "Use response_format=url with the same Idempotency-Key to retrieve these images.", 413)
			}
			if _, contentType := sniffImage(data); contentType == "" {
				return nil, apperr.E("image_result_unavailable", "The task did not produce a supported image.", 502)
			}
			item.B64JSON = base64.StdEncoding.EncodeToString(data)
		}
		response.Data = append(response.Data, item)
	}
	return response, nil
}
